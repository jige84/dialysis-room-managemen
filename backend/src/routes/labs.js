/**
 * 检验结果管理路由
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const auth = require('../middleware/auth');
const { rbac } = require('../middleware/rbac');
const { success, created, paginated, error, notFound } = require('../utils/response');

// 检验项目目标范围配置（透析患者）
const LAB_TARGETS = {
  hb:      { low: 110, high: 130, unit: 'g/L',      critical_low: 70 },
  hct:     { low: 33,  high: 39,  unit: '%' },
  k:       { low: 3.5, high: 5.5, unit: 'mmol/L',   critical_low: 3.0, critical_high: 6.5 },
  na:      { low: 135, high: 145, unit: 'mmol/L' },
  ca:      { low: 2.10,high: 2.50,unit: 'mmol/L' },
  p:       { low: 1.13,high: 1.78,unit: 'mmol/L' },
  hco3:    { low: 22,  high: 26,  unit: 'mmol/L' },
  alb:     { low: 35,  high: 55,  unit: 'g/L' },
  sf:      { low: 200, high: 500, unit: 'ng/mL' },
  tsat:    { low: 20,  high: 50,  unit: '%' },
  ipth:    { low: 150, high: 600, unit: 'pg/mL' },
  b2mg:    { high: 25, unit: 'mg/L' },
};

// ── 静态路由（必须在通配符路由之前）────────────────────────

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
router.get('/overdue', auth, async (req, res, next) => {
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
          test_date || new Date().toISOString().slice(0, 10),
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
