/**
 * 检验结果 REST 路由
 * 主要作用：管理患者化验单与关键指标，供医生评估与透析充分性等模块使用。
 * 主要功能：检验结果录入与查询；目标范围配置；分页列表与按患者筛选。
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const auth = require('../middleware/auth');
const { rbac } = require('../middleware/rbac');
const { success, created, paginated, error, notFound } = require('../utils/response');
const { addDaysToDate, formatDate, getMonthRange } = require('../utils/dateUtils');

// 检验项目目标范围配置（透析患者）
const LAB_TARGETS = {
  hb:      { low: 110, high: 130, unit: 'g/L',      critical_low: 70 },
  hct:     { low: 33,  high: 39,  unit: '%' },
  k:       { low: 3.5, high: 5.5, unit: 'mmol/L',   critical_low: 3.0, critical_high: 6.5 },
  na:      { low: 135, high: 145, unit: 'mmol/L' },
  ca:      { low: 2.10,high: 2.50,unit: 'mmol/L' },
  p:       { low: 1.13,high: 1.78,unit: 'mmol/L' },
  // PDF 中 CO2CP/HCO3- 控制目标为 >=20 且 <26（此处用于化验项目 HCO3- 目标范围）
  hco3:    { low: 20,  high: 26,  unit: 'mmol/L' },
  // PDF 中白蛋白给出下限（>=35g/L），不在系统内对“偏高”做自动告警
  alb:     { low: 35,  unit: 'g/L' },
  sf:      { low: 200, high: 500, unit: 'ng/mL' },
  tsat:    { low: 20,  high: 50,  unit: '%' },
  // PDF 中 iPTH 控制目标常用范围：150～300pg/mL
  ipth:    { low: 150, high: 300, unit: 'pg/mL' },
  b2mg:    { high: 25, unit: 'mg/L' },
};

// 化验项目复查周期（用于“下次复查时间”的默认值）
const LAB_REVIEW_CYCLE_DAYS = {
  hb:   30,
  hct:  30,
  k:    30,
  na:   30,
  ca:   30,
  p:    30,
  ipth: 90,
  alb:  90,
  b2mg: 180,
  sf:   90,
  tsat: 90,
  hco3: 30,
  bun:  90,
  cr:   90,
  // 传染病筛查：每6个月复查（约180天）
  hbsag: 180,
  hcv:   180,
  hiv:   180,
  tp:    180,
};

const DEFAULT_REVIEW_CYCLE_DAYS = 90;

// ── 静态路由（必须在通配符路由之前）────────────────────────

// GET /api/labs - 全科检验结果分页（检验列表页）
router.get('/', auth, rbac(['admin', 'doctor', 'nurse', 'head_nurse', 'quality']), async (req, res, next) => {
  try {
    const {
      page = 1,
      page_size = 30,
      keyword,
      test_type,
      is_critical,
      is_abnormal,
    } = req.query;
    const offset = (page - 1) * page_size;

    const conditions = ['1=1'];
    const params = [];
    let idx = 1;

    if (keyword) {
      conditions.push(`p.name ILIKE $${idx++}`);
      params.push(`%${String(keyword).trim()}%`);
    }
    if (test_type) {
      conditions.push(`lr.test_type = $${idx++}`);
      params.push(String(test_type).trim());
    }
    if (is_critical === 'true') {
      conditions.push('lr.is_critical = true');
    }
    if (is_abnormal === 'true') {
      conditions.push('lr.is_abnormal = true');
    }
    if (req.query.result_normal === 'true') {
      conditions.push('lr.is_abnormal = false AND lr.is_critical = false');
    }

    const where = conditions.join(' AND ');

    const countRes = await pool.query(
      `SELECT COUNT(*) FROM lab_results lr
       JOIN patients p ON lr.patient_id = p.id
       WHERE ${where}`,
      params
    );
    const total = parseInt(countRes.rows[0].count);

    const { rows } = await pool.query(
      `SELECT lr.*, p.name AS patient_name, p.gender AS patient_gender
       FROM lab_results lr
       JOIN patients p ON lr.patient_id = p.id
       WHERE ${where}
       ORDER BY lr.test_date DESC, lr.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, page_size, offset]
    );

    return paginated(res, rows, total, page, page_size);
  } catch (err) { next(err); }
});

// GET /api/labs/critical/unconfirmed - 全科未确认危急值
router.get('/critical/unconfirmed', auth, rbac(['admin','head_nurse','doctor']), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT lr.*, p.name as patient_name, u.real_name as entered_by_name
       FROM lab_results lr
       JOIN patients p ON lr.patient_id = p.id
       LEFT JOIN users u ON lr.entered_by = u.id
       WHERE lr.is_critical = true AND lr.critical_confirmed = false
       ORDER BY lr.test_date DESC, lr.created_at DESC`
    );
    return success(res, rows);
  } catch (err) { next(err); }
});

// GET /api/labs/overdue - 复查到期患者列表
router.get('/overdue', auth, rbac(['admin', 'doctor', 'nurse', 'head_nurse', 'quality']), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (p.id, lr.test_type)
         p.id as patient_id, p.name as patient_name,
         lr.test_type, lr.test_date,
         EXTRACT(DAY FROM NOW() - lr.test_date) as days_since
       FROM patients p
       JOIN lab_results lr ON lr.patient_id = p.id
       WHERE p.status = 'active'
       ORDER BY p.id, lr.test_type, lr.test_date DESC
       LIMIT 500`
    );
    const overdue = rows.filter(r => parseInt(r.days_since) > 180);
    return success(res, overdue);
  } catch (err) { next(err); }
});

// GET /api/labs/recent?days=7 - 近一周最新一条/患者/项目
router.get('/recent', auth, rbac(['admin', 'doctor', 'nurse', 'head_nurse', 'quality']), async (req, res, next) => {
  try {
    const days = parseInt(req.query.days || '7');
    const page = parseInt(req.query.page || '1');
    const pageSize = parseInt(req.query.page_size || '200');

    if (!Number.isFinite(days) || days <= 0) return error(res, 'days 参数无效', 400);
    if (!Number.isFinite(page) || page <= 0) return error(res, 'page 参数无效', 400);
    if (!Number.isFinite(pageSize) || pageSize <= 0) return error(res, 'page_size 参数无效', 400);

    const endDate = new Date();
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - days);
    const startStr = formatDate(startDate);
    const endStr = formatDate(endDate);

    const offset = (page - 1) * pageSize;

    const { rows } = await pool.query(
      `WITH latest AS (
         SELECT DISTINCT ON (lr.patient_id, lr.test_type)
           lr.*
         FROM lab_results lr
         JOIN patients p0 ON p0.id = lr.patient_id
         WHERE p0.status = 'active'
           AND lr.test_date >= $1
           AND lr.test_date <= $2
         ORDER BY lr.patient_id, lr.test_type, lr.test_date DESC, lr.created_at DESC, lr.id DESC
       )
       SELECT
         latest.*,
         p.name AS patient_name,
         p.gender AS patient_gender,
         al.id AS recheck_alert_id,
         al.message AS recheck_alert_message
       FROM latest
       JOIN patients p ON p.id = latest.patient_id
       LEFT JOIN LATERAL (
         SELECT a2.id, a2.message
         FROM alerts a2
         WHERE a2.patient_id = latest.patient_id
           AND a2.alert_type = 'lab_review_due'
           AND a2.alert_rule_id = latest.test_type
           AND a2.status = 'active'
         ORDER BY a2.created_at DESC
         LIMIT 1
       ) al ON true
       ORDER BY latest.test_date DESC, latest.created_at DESC, latest.id DESC
       LIMIT $3 OFFSET $4`,
      [startStr, endStr, pageSize, offset]
    );
    const withNext = rows.map((r) => {
      const extractDueDateFromMessage = (msg) => {
        if (!msg) return null;
        const m = String(msg).match(/\b(\d{4}-\d{2}-\d{2})\b/);
        return m ? m[1] : null;
      };

      const cycleDays = LAB_REVIEW_CYCLE_DAYS[r.test_type] ?? DEFAULT_REVIEW_CYCLE_DAYS;
      const defaultDue = addDaysToDate(r.test_date, cycleDays);

      // 优先使用医生“设定复查日期”的 due_date（当前通过 message 内标记存储）。
      const dueFromAlert = extractDueDateFromMessage(r.recheck_alert_message);
      const nextReviewDate = dueFromAlert || defaultDue;

      // 不把 message 回传到前端，避免不必要的数据暴露/体积。
      const { recheck_alert_message, ...rest } = r;
      return { ...rest, next_review_date: nextReviewDate };
    });

    return success(res, withNext, '近一周化验结果查询成功');
  } catch (err) { next(err); }
});

// GET /api/labs/review-due-soon?days=7 - 复查到期提醒（到期/逾期不超过 days）
router.get('/review-due-soon', auth, rbac(['admin', 'doctor', 'nurse', 'head_nurse', 'quality']), async (req, res, next) => {
  try {
    const days = parseInt(req.query.days || '7');
    if (!Number.isFinite(days) || days <= 0) return error(res, 'days 参数无效', 400);

    const now = new Date();
    const lower = new Date(now);
    lower.setDate(lower.getDate() - days);
    const upper = new Date(now);
    upper.setDate(upper.getDate() + days);

    const maxCycleDays = Math.max(...Object.values(LAB_REVIEW_CYCLE_DAYS), DEFAULT_REVIEW_CYCLE_DAYS);
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - (maxCycleDays + days));
    const startStr = formatDate(startDate);

    const { rows } = await pool.query(
      `SELECT DISTINCT ON (lr.patient_id, lr.test_type)
         lr.patient_id,
         p.name AS patient_name,
         lr.test_type,
         lr.test_date
       FROM lab_results lr
       JOIN patients p ON lr.patient_id = p.id
       WHERE p.status = 'active'
         AND lr.test_date >= $1
       ORDER BY lr.patient_id, lr.test_type, lr.test_date DESC
       LIMIT 5000`,
      [startStr]
    );

    const list = [];
    for (const row of rows) {
      const cycleDays = LAB_REVIEW_CYCLE_DAYS[row.test_type] ?? DEFAULT_REVIEW_CYCLE_DAYS;
      const dueStr = addDaysToDate(row.test_date, cycleDays);
      const due = new Date(`${dueStr}T00:00:00`);
      if (due >= lower && due <= upper) {
        list.push({
          patient_id: row.patient_id,
          patient_name: row.patient_name,
          test_type: row.test_type,
          test_date: formatDate(row.test_date),
          due_date: dueStr,
        });
      }
    }

    list.sort((a, b) => a.due_date.localeCompare(b.due_date));
    return success(res, list, '复查到期提醒查询成功');
  } catch (err) { next(err); }
});

// GET /api/labs/month-completion?year=2026&month=3 - 当月化验完成率 / 未化验名单
router.get('/month-completion', auth, rbac(['admin', 'doctor', 'nurse', 'head_nurse', 'quality']), async (req, res, next) => {
  try {
    const now = new Date();
    const year = parseInt(String(req.query.year || now.getFullYear()), 10);
    const month = parseInt(String(req.query.month || now.getMonth() + 1), 10);

    if (!Number.isFinite(year) || year < 2000 || year > 2100) return error(res, 'year 参数无效', 400);
    if (!Number.isFinite(month) || month < 1 || month > 12) return error(res, 'month 参数无效', 400);

    const { startDate: startStr } = getMonthRange(year, month);
    const endStr = month === 12
      ? `${year + 1}-01-01`
      : `${year}-${String(month + 1).padStart(2, '0')}-01`;

    const totalRes = await pool.query(`SELECT COUNT(*)::int as total FROM patients WHERE status = 'active'`);
    const total = parseInt(totalRes.rows[0].total, 10);

    const completedRes = await pool.query(
      `SELECT COUNT(*)::int as completed
       FROM patients p
       WHERE p.status = 'active'
         AND EXISTS (
           SELECT 1
           FROM lab_results lr
           WHERE lr.patient_id = p.id
             AND lr.test_date >= $1
             AND lr.test_date < $2
         )`,
      [startStr, endStr]
    );
    const completed = parseInt(completedRes.rows[0].completed, 10);

    const uncompletedRes = await pool.query(
      `SELECT p.id as patient_id, p.name as patient_name
       FROM patients p
       WHERE p.status = 'active'
         AND NOT EXISTS (
           SELECT 1
           FROM lab_results lr
           WHERE lr.patient_id = p.id
             AND lr.test_date >= $1
             AND lr.test_date < $2
         )
       ORDER BY p.name
       LIMIT 5000`,
      [startStr, endStr]
    );

    const completion_rate = total > 0 ? completed / total : 0;
    return success(res, {
      completion_rate,
      total_patients: total,
      completed_patients: completed,
      uncompleted_patients: uncompletedRes.rows.map(r => ({ patient_id: r.patient_id, patient_name: r.patient_name })),
    }, '当月化验完成率查询成功');
  } catch (err) { next(err); }
});

// PATCH /api/labs/recheck - 医生/管理员设置某化验项目下次复查日期（存入 alerts）
router.patch('/recheck', auth, rbac(['admin', 'doctor']), async (req, res, next) => {
  try {
    const { patient_id, test_type, due_date } = req.body || {};
    if (!patient_id || !test_type || !due_date) return error(res, 'patient_id、test_type、due_date 为必填项', 400);

    const due = new Date(due_date);
    if (Number.isNaN(due.getTime())) return error(res, 'due_date 格式无效（需为 YYYY-MM-DD）', 400);
    const dueStr = formatDate(due);

    const { rows: pRows } = await pool.query('SELECT name FROM patients WHERE id=$1', [patient_id]);
    const pname = pRows[0]?.name || patient_id;

      const cycleDays = LAB_REVIEW_CYCLE_DAYS[test_type] ?? DEFAULT_REVIEW_CYCLE_DAYS;
    const daysFromNow = Math.floor((due.getTime() - Date.now()) / 86400000);
    // 当前 alerts 表结构使用 severity（且限制了枚举值），这里把原先的 low/medium 映射到允许值。
    const severity = daysFromNow < 0 ? 'critical' : daysFromNow <= 7 ? 'warning' : 'info';

    const title = `化验复查计划：${pname}`;
    // 在 message 内嵌入可解析标记，供 `GET /recent` 覆盖默认复查周期。
      const message = `患者 ${pname} 的 ${String(test_type).toUpperCase()} 计划复查于 ${dueStr}（周期${cycleDays}天），due_date=${dueStr}`;

    const { rows: aRows } = await pool.query(
      `SELECT id
       FROM alerts
       WHERE patient_id = $1
         AND alert_type = 'lab_review_due'
         AND alert_rule_id = $2
         AND status = 'active'
       LIMIT 1`,
      [patient_id, test_type]
    );

    let updated;
    if (aRows[0]?.id) {
      const { rows: uRows } = await pool.query(
        `UPDATE alerts
         SET severity = $1,
             title = $2,
             message = $3,
             status = 'active'
         WHERE id = $4
         RETURNING id`,
        [severity, title, message, aRows[0].id]
      );
      updated = uRows;
    } else {
      const { rows: iRows } = await pool.query(
        `INSERT INTO alerts (
           patient_id, alert_rule_id, alert_type,
           severity, title, message,
           status
         ) VALUES ($1, $2, 'lab_review_due', $3, $4, $5, 'active')
         RETURNING id`,
        [patient_id, test_type, severity, title, message]
      );
      updated = iRows;
    }

    return success(res, updated?.[0] ?? null, '复查时间已更新');
  } catch (err) { next(err); }
});

// ── 通配符路由 ────────────────────────────────────────────

// GET /api/labs/:patientId
router.get('/:patientId', auth, async (req, res, next) => {
  try {
    const { test_type, start_date, end_date, page = 1, page_size = 30 } = req.query;
    const offset = (page - 1) * page_size;

    const conditions = ['patient_id = $1'];
    const params = [req.params.patientId];
    let idx = 2;

    if (test_type)   { conditions.push(`test_type = $${idx++}`);            params.push(test_type); }
    if (start_date)  { conditions.push(`test_date >= $${idx++}`);           params.push(start_date); }
    if (end_date)    { conditions.push(`test_date <= $${idx++}`);           params.push(end_date); }

    const where = conditions.join(' AND ');

    const countRes = await pool.query(`SELECT COUNT(*) FROM lab_results WHERE ${where}`, params);
    const total = parseInt(countRes.rows[0].count);

    const { rows } = await pool.query(
      `SELECT lr.*, u.real_name as entered_by_name
       FROM lab_results lr LEFT JOIN users u ON lr.entered_by = u.id
       WHERE ${where}
       ORDER BY test_date DESC, test_type
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, page_size, offset]
    );

    return paginated(res, rows, total, page, page_size);
  } catch (err) { next(err); }
});

// GET /api/labs/:patientId/latest - 最新各项检验
router.get('/:patientId/latest', auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (test_type)
         id, test_type, value, unit, test_date,
         is_abnormal, is_critical, is_above_target, target_low, target_high
       FROM lab_results
       WHERE patient_id = $1
       ORDER BY test_type, test_date DESC`,
      [req.params.patientId]
    );
    return success(res, rows);
  } catch (err) { next(err); }
});

// GET /api/labs/:patientId/trends?types=k,hb
router.get('/:patientId/trends', auth, async (req, res, next) => {
  try {
    const { types } = req.query;
    if (!types) return error(res, '请提供 types 参数（如：k,hb,p）');

    const typeList = String(types).split(',').map(t => t.trim());
    const { rows } = await pool.query(
      `SELECT test_type, test_date, value, unit, target_low, target_high
       FROM lab_results
       WHERE patient_id = $1 AND test_type = ANY($2)
       ORDER BY test_date DESC
       LIMIT 200`,
      [req.params.patientId, typeList]
    );

    const grouped = {};
    for (const row of rows) {
      if (!grouped[row.test_type]) grouped[row.test_type] = [];
      grouped[row.test_type].push(row);
    }
    return success(res, grouped);
  } catch (err) { next(err); }
});

// POST /api/labs/:patientId - 录入检验结果（支持批量）
// labs:write 权限：admin, doctor, head_nurse
router.post('/:patientId', auth, rbac(['admin','doctor','head_nurse']), async (req, res, next) => {
  try {
    const items = Array.isArray(req.body) ? req.body : [req.body];
    if (items.length === 0) return error(res, '请提供检验数据');

    const results = [];
    for (const item of items) {
      /* eslint-disable no-await-in-loop */
      const { test_type, value, unit, test_date, notes } = item;
      if (!test_type || value === undefined) continue;

      const target = LAB_TARGETS[test_type] || {};
      const is_abnormal = (target.low && value < target.low) || (target.high && value > target.high);
      const is_critical = (target.critical_low && value < target.critical_low) ||
                          (target.critical_high && value > target.critical_high);
      const is_above_target = is_abnormal;

      const { rows } = await pool.query(
        `INSERT INTO lab_results (
           patient_id, test_type, value, unit, test_date,
           reference_low, reference_high, target_low, target_high,
           is_abnormal, is_critical, is_above_target,
           entered_by, notes
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING id, test_type, value, is_critical`,
        [
          req.params.patientId, test_type, value,
          unit || target.unit || '',
          test_date || formatDate(new Date()),
          target.low || null, target.high || null,
          target.low || null, target.high || null,
          is_abnormal, is_critical, is_above_target,
          req.user.id, notes
        ]
      );
      results.push(rows[0]);
    }

    return created(res, results, `${results.length}条检验结果录入成功`);
  } catch (err) { next(err); }
});

// PATCH /api/labs/:id/critical-confirm - 确认危急值
router.patch('/:id/critical-confirm', auth, rbac(['admin','head_nurse','doctor','nurse']), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE lab_results
       SET critical_confirmed = true, critical_confirmed_by = $1, critical_confirmed_at = NOW()
       WHERE id = $2 RETURNING id, test_type, value, unit`,
      [req.user.id, req.params.id]
    );
    if (rows.length === 0) return notFound(res, '检验记录不存在');
    return success(res, rows[0], '危急值已确认处理');
  } catch (err) { next(err); }
});

module.exports = router;
