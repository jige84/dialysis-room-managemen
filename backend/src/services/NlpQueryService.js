/**
 * 自然语言查询编排：不让大模型直接生成 SQL，而是由后端基于白名单模板取数
 * 当前先覆盖高频问法，未命中的问题返回明确提示，避免“假查询、真编造”。
 */
const { pool } = require('../config/database');

function makeError(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function parseMonths(query) {
  const q = String(query || '');
  const numMatch = q.match(/近\s*(\d{1,2})\s*个?月/);
  if (numMatch) {
    const n = Number.parseInt(numMatch[1], 10);
    return Math.min(12, Math.max(1, n));
  }
  if (q.includes('一个月') || q.includes('最近一个月') || q.includes('近一月')) return 1;
  if (q.includes('三个月') || q.includes('近三月')) return 3;
  if (q.includes('六个月') || q.includes('近半年')) return 6;
  return 3;
}

function detectTrendMetric(query) {
  const q = String(query || '').toLowerCase();
  if (q.includes('kt/v') || q.includes('ktv')) {
    return { key: 'ktv', label: 'Kt/V', field: 'ktv' };
  }
  if (q.includes('urr')) {
    return { key: 'urr', label: 'URR', field: 'urr' };
  }
  if (String(query || '').includes('超滤')) {
    return { key: 'uf', label: '超滤量', field: 'uf_volume' };
  }
  return null;
}

function extractPatientKeyword(query) {
  const raw = String(query || '').trim();
  const uuidMatch = raw.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  if (uuidMatch) return { type: 'id', value: uuidMatch[0] };

  const anchored =
    raw.match(/^([\u4e00-\u9fa5A-Za-z0-9·]{2,20}?)(最近|近|上月|本月|近\d)/) ||
    raw.match(/患者([\u4e00-\u9fa5A-Za-z0-9·]{2,20})/) ||
    raw.match(/([\u4e00-\u9fa5A-Za-z0-9·]{2,20})的(kt\/v|ktv|urr|超滤)/i);
  if (!anchored) return null;
  return { type: 'name', value: anchored[1].trim() };
}

async function resolvePatient(query) {
  const keyword = extractPatientKeyword(query);
  if (!keyword) {
    throw makeError('当前自然语言查询需包含明确患者姓名或患者 ID');
  }
  if (keyword.type === 'id') {
    const { rows } = await pool.query(
      `SELECT id, name FROM patients WHERE id = $1 LIMIT 1`,
      [keyword.value],
    );
    if (!rows.length) throw makeError('未找到对应患者', 404);
    return rows[0];
  }

  const { rows } = await pool.query(
    `SELECT id, name
     FROM patients
     WHERE name = $1 OR name ILIKE $2
     ORDER BY CASE WHEN name = $1 THEN 0 ELSE 1 END, name ASC
     LIMIT 5`,
    [keyword.value, `%${keyword.value}%`],
  );
  if (!rows.length) {
    throw makeError(`未找到患者“${keyword.value}”`, 404);
  }
  if (rows.length > 1) {
    throw makeError(`患者“${keyword.value}”匹配到多条记录，请改用更完整姓名或患者 ID`);
  }
  return rows[0];
}

async function buildPatientTrendQueryContext(question, metric) {
  const patient = await resolvePatient(question);
  const months = parseMonths(question);
  const sql = `
    SELECT session_date, ktv, urr, uf_volume, uf_pct_of_dry_weight,
           pre_weight, post_weight, actual_duration, blood_flow_rate
    FROM dialysis_records
    WHERE patient_id = $1
      AND session_date >= (CURRENT_DATE - ($2::int * INTERVAL '1 month'))
    ORDER BY session_date DESC
    LIMIT 60
  `;
  const { rows } = await pool.query(sql, [patient.id, months]);
  if (!rows.length) {
    throw makeError(`患者“${patient.name}”近 ${months} 个月暂无可用透析记录`, 404);
  }

  const metricValues = rows
    .map((r) => r[metric.field])
    .filter((v) => v !== null && v !== undefined)
    .map((v) => Number(v));

  return {
    context: {
      query_execution: {
        planner: 'template_sql',
        query_type: 'patient_metric_trend',
        question,
        patient,
        metric: metric.label,
        period_months: months,
        sql_scope: ['patients', 'dialysis_records'],
        result_count: rows.length,
      },
      result_summary: {
        latest_value: metricValues[0] ?? null,
        min_value: metricValues.length ? Math.min(...metricValues) : null,
        max_value: metricValues.length ? Math.max(...metricValues) : null,
        values_count: metricValues.length,
      },
      result_rows: rows,
    },
    meta: {
      planner: 'template_sql',
      query_type: 'patient_metric_trend',
      sql_scope: ['patients', 'dialysis_records'],
      result_count: rows.length,
      summary: `患者 ${patient.name} 近 ${months} 个月 ${metric.label} 趋势`,
    },
  };
}

async function readUfPctLimit() {
  const { rows } = await pool.query(
    `SELECT config_value FROM system_configs WHERE config_key = 'uf_pct_limit' LIMIT 1`,
  );
  const raw = rows[0]?.config_value;
  const parsed = Number.parseFloat(String(raw || '5'));
  return Number.isFinite(parsed) ? parsed : 5;
}

async function buildUfExceedContext(question) {
  const threshold = await readUfPctLimit();
  const isPreviousMonth = String(question || '').includes('上月');
  const dateFilter = isPreviousMonth
    ? `d.session_date >= date_trunc('month', CURRENT_DATE) - INTERVAL '1 month'
       AND d.session_date < date_trunc('month', CURRENT_DATE)`
    : `d.session_date >= CURRENT_DATE - INTERVAL '30 day'`;
  const { rows } = await pool.query(
    `SELECT p.id, p.name,
            COUNT(*)::int AS exceed_sessions,
            MAX(d.uf_pct_of_dry_weight) AS max_uf_pct,
            MAX(d.session_date) AS latest_session_date
     FROM dialysis_records d
     JOIN patients p ON p.id = d.patient_id
     WHERE ${dateFilter}
       AND COALESCE(d.uf_pct_of_dry_weight, 0) > $1
     GROUP BY p.id, p.name
     ORDER BY exceed_sessions DESC, max_uf_pct DESC NULLS LAST, p.name ASC
     LIMIT 50`,
    [threshold],
  );

  return {
    context: {
      query_execution: {
        planner: 'template_sql',
        query_type: 'uf_exceed_patient_list',
        question,
        threshold_pct: threshold,
        period: isPreviousMonth ? 'previous_calendar_month' : 'rolling_30_days',
        sql_scope: ['patients', 'dialysis_records', 'system_configs'],
        result_count: rows.length,
      },
      result_rows: rows,
    },
    meta: {
      planner: 'template_sql',
      query_type: 'uf_exceed_patient_list',
      sql_scope: ['patients', 'dialysis_records', 'system_configs'],
      result_count: rows.length,
      summary: `${isPreviousMonth ? '上月' : '近30天'}超滤占干体重比例超过 ${threshold}% 的患者名单`,
    },
  };
}

async function executeQuery(question) {
  const q = String(question || '').trim();
  if (!q) throw makeError('query 为必填参数');

  if (/超滤.*超标|超标.*超滤/.test(q)) {
    return buildUfExceedContext(q);
  }

  const metric = detectTrendMetric(q);
  if (metric && /趋势|最近|近|变化/.test(q)) {
    return buildPatientTrendQueryContext(q, metric);
  }

  throw makeError(
    '当前自然语言查询暂支持：1）带患者姓名/ID的 Kt/V、URR、超滤趋势；2）上月/近30天超滤量超标患者名单。其余问法请先补充结构化查询能力。',
  );
}

module.exports = {
  executeQuery,
};
