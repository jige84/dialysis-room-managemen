/**
 * 上线后稳定观察：每日快照生成器
 *
 * 输出：
 * - docs/qa/release-hardening/generated/post-release-observation/<run-id>-daily-snapshot.json
 * - docs/qa/release-hardening/generated/post-release-observation/<run-id>-daily-snapshot.md
 *
 * 说明：
 * - 指标以“可获取优先”为原则，遇到表/字段不存在时记录为 null 并给出 caveat。
 * - 不改业务数据，仅做只读查询与日志统计。
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { pool } = require('../src/config/database');

dotenv.config({ path: path.join(__dirname, '../.env') });

const repoRoot = path.resolve(__dirname, '../..');
const logsDir = path.join(repoRoot, 'backend', 'logs');
const outDir = path.join(
  repoRoot,
  'docs',
  'qa',
  'release-hardening',
  'generated',
  'post-release-observation'
);

function nowIso() {
  return new Date().toISOString();
}

function runId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function queryValue(sql, params = []) {
  try {
    const { rows } = await pool.query(sql, params);
    if (!rows.length) return null;
    const first = rows[0];
    const key = Object.keys(first)[0];
    return first[key];
  } catch {
    return null;
  }
}

async function tableExists(tableName) {
  const reg = await queryValue('SELECT to_regclass($1) AS reg', [`public.${tableName}`]);
  return Boolean(reg);
}

async function pickExistingColumn(tableName, candidates) {
  for (const col of candidates) {
    const exists = await queryValue(
      `SELECT 1
       FROM information_schema.columns
       WHERE table_schema='public' AND table_name=$1 AND column_name=$2
       LIMIT 1`,
      [tableName, col]
    );
    if (exists === 1) return col;
  }
  return null;
}

async function countTable(tableName, whereSql = '', params = []) {
  const exists = await tableExists(tableName);
  if (!exists) return null;
  const clause = whereSql ? ` WHERE ${whereSql}` : '';
  const val = await queryValue(`SELECT COUNT(*)::bigint AS c FROM ${tableName}${clause}`, params);
  if (val == null) return null;
  return Number(val);
}

async function countLast24h(tableName, timeColumns) {
  const exists = await tableExists(tableName);
  if (!exists) return { count: null, timeColumn: null };
  const col = await pickExistingColumn(tableName, timeColumns);
  if (!col) return { count: null, timeColumn: null };
  const c = await countTable(tableName, `${col} >= NOW() - INTERVAL '24 hours'`);
  return { count: c, timeColumn: col };
}

function parseLatestLogMetrics() {
  const result = {
    logFile: null,
    logDate: null,
    requestTotal: 0,
    status2xx: 0,
    status4xx: 0,
    status5xx: 0,
    errorLines: 0,
    unauthorizedEvents: 0,
    forbiddenEvents: 0,
    scheduledTaskSuccess: 0,
    scheduledTaskFailure: 0,
  };

  if (!fs.existsSync(logsDir)) return result;

  const files = fs
    .readdirSync(logsDir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.log$/.test(f))
    .sort();
  if (!files.length) return result;

  const file = files[files.length - 1];
  const abs = path.join(logsDir, file);
  const text = fs.readFileSync(abs, 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);

  result.logFile = abs;
  result.logDate = file.replace('.log', '');

  for (const line of lines) {
    if (line.includes('[ERROR]')) result.errorLines += 1;

    const statusMatch = line.match(/"\s(\d{3})\s/);
    if (statusMatch) {
      result.requestTotal += 1;
      const status = Number(statusMatch[1]);
      if (status >= 500) result.status5xx += 1;
      else if (status >= 400) result.status4xx += 1;
      else if (status >= 200) result.status2xx += 1;
      if (status === 401) result.unauthorizedEvents += 1;
      if (status === 403) result.forbiddenEvents += 1;
    }

    if (line.includes('[定时任务]')) {
      if (line.includes('失败')) result.scheduledTaskFailure += 1;
      if (line.includes('完成') || line.includes('已生成') || line.includes('已注册')) {
        result.scheduledTaskSuccess += 1;
      }
    }
  }

  return result;
}

function calc5xxRate(logMetrics) {
  if (!logMetrics.requestTotal) return null;
  return Number(((logMetrics.status5xx / logMetrics.requestTotal) * 100).toFixed(3));
}

function deriveOverallStatus(snapshot) {
  const rate = snapshot.metrics.api5xxRatePct;
  const errors = snapshot.metrics.errorLines;
  if (rate == null) return '关注';
  if (rate < 0.2 && errors <= 10) return '稳定';
  if (rate < 1.0 && errors <= 30) return '关注';
  return '风险';
}

function buildCaveats(snapshot) {
  const notes = [];
  if (snapshot.metrics.backingLogFile == null) {
    notes.push('未发现后端日志文件，API 错误率统计不可用。');
  }
  if (snapshot.db.last24h.dialysisRecords.timeColumn == null) {
    notes.push('dialysis_records 缺少可识别时间字段，近24小时计数不可得。');
  }
  if (snapshot.db.last24h.infectionScreenings.timeColumn == null) {
    notes.push('infection_screenings 缺少可识别时间字段，近24小时计数不可得。');
  }
  if (snapshot.db.last24h.auditLogs.timeColumn == null) {
    notes.push('audit_logs 缺少可识别时间字段，近24小时计数不可得。');
  }
  return notes;
}

function toMarkdown(snapshot) {
  const lines = [];
  lines.push('# 上线后稳定观察日报快照');
  lines.push('');
  lines.push(`- Run ID: \`${snapshot.runId}\``);
  lines.push(`- 生成时间: ${snapshot.generatedAt}`);
  lines.push(`- 总体状态: **${snapshot.overallStatus}**`);
  lines.push('');
  lines.push('## 指标摘要');
  lines.push('');
  lines.push('| 指标 | 值 |');
  lines.push('|---|---:|');
  lines.push(`| API 请求总量（日志样本） | ${snapshot.metrics.requestTotal ?? 'N/A'} |`);
  lines.push(`| API 5xx 数 | ${snapshot.metrics.status5xx ?? 'N/A'} |`);
  lines.push(`| API 5xx 比率（%） | ${snapshot.metrics.api5xxRatePct ?? 'N/A'} |`);
  lines.push(`| 日志 ERROR 行数 | ${snapshot.metrics.errorLines ?? 'N/A'} |`);
  lines.push(`| 401 次数 | ${snapshot.metrics.unauthorizedEvents ?? 'N/A'} |`);
  lines.push(`| 403 次数 | ${snapshot.metrics.forbiddenEvents ?? 'N/A'} |`);
  lines.push(`| 定时任务成功日志数 | ${snapshot.metrics.scheduledTaskSuccess ?? 'N/A'} |`);
  lines.push(`| 定时任务失败日志数 | ${snapshot.metrics.scheduledTaskFailure ?? 'N/A'} |`);
  lines.push(`| 活跃预警数 | ${snapshot.db.activeAlerts ?? 'N/A'} |`);
  lines.push(`| 患者总数 | ${snapshot.db.patientsTotal ?? 'N/A'} |`);
  lines.push(`| 近24h透析记录数 | ${snapshot.db.last24h.dialysisRecords.count ?? 'N/A'} |`);
  lines.push(`| 近24h传染筛查记录数 | ${snapshot.db.last24h.infectionScreenings.count ?? 'N/A'} |`);
  lines.push(`| 近24h审计日志数 | ${snapshot.db.last24h.auditLogs.count ?? 'N/A'} |`);
  lines.push('');
  lines.push('## 日报建议');
  lines.push('');
  lines.push('- 报表口径抽检：_____');
  lines.push('- 权限异常抽检结论：_____');
  lines.push('- 当日风险与处置：_____');
  lines.push('');
  lines.push('## Caveats');
  lines.push('');
  if (!snapshot.caveats.length) lines.push('- 无');
  else snapshot.caveats.forEach((n) => lines.push(`- ${n}`));
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const id = runId();
  const jsonPath = path.join(outDir, `${id}-daily-snapshot.json`);
  const mdPath = path.join(outDir, `${id}-daily-snapshot.md`);

  const logMetrics = parseLatestLogMetrics();

  const patientsTotal = await countTable('patients');
  const activeAlerts = await countTable('alerts', `status = 'active'`);
  const dialysisRecords24h = await countLast24h('dialysis_records', ['created_at', 'dialysis_date', 'recorded_at']);
  const infectionScreenings24h = await countLast24h('infection_screenings', ['created_at', 'test_date', 'updated_at']);
  const auditLogs24h = await countLast24h('audit_logs', ['created_at']);

  const snapshot = {
    runId: id,
    generatedAt: nowIso(),
    metrics: {
      backingLogFile: logMetrics.logFile,
      requestTotal: logMetrics.requestTotal,
      status2xx: logMetrics.status2xx,
      status4xx: logMetrics.status4xx,
      status5xx: logMetrics.status5xx,
      api5xxRatePct: calc5xxRate(logMetrics),
      errorLines: logMetrics.errorLines,
      unauthorizedEvents: logMetrics.unauthorizedEvents,
      forbiddenEvents: logMetrics.forbiddenEvents,
      scheduledTaskSuccess: logMetrics.scheduledTaskSuccess,
      scheduledTaskFailure: logMetrics.scheduledTaskFailure,
    },
    db: {
      patientsTotal,
      activeAlerts,
      last24h: {
        dialysisRecords: dialysisRecords24h,
        infectionScreenings: infectionScreenings24h,
        auditLogs: auditLogs24h,
      },
    },
    caveats: [],
    overallStatus: '关注',
  };

  snapshot.caveats = buildCaveats(snapshot);
  snapshot.overallStatus = deriveOverallStatus(snapshot);

  fs.writeFileSync(jsonPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  fs.writeFileSync(mdPath, toMarkdown(snapshot), 'utf8');

  console.log(`Generated:\n- ${jsonPath}\n- ${mdPath}`);
}

main()
  .catch((err) => {
    console.error('generate-post-release-observation failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });

