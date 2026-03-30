/**
 * CQI（持续质量改进）REST 路由
 * 主要作用：管理科室质量改进记录，供护士长、管理员与质控协同使用。
 * 主要功能：CQI 列表与详情；创建与更新；按角色限制写权限。
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const auth = require('../middleware/auth');
const { rbac } = require('../middleware/rbac');
const { success, created, error, notFound } = require('../utils/response');

// GET /api/cqi - 获取CQI记录列表
router.get('/', auth, async (req, res, next) => {
  try {
    const { status, page = 1, page_size = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(page_size);
    const conditions = [];
    const params = [];
    let idx = 1;
    if (status) { conditions.push(`status = $${idx++}`); params.push(status); }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const countRes = await pool.query(`SELECT COUNT(*) FROM cqi_records ${where}`, params);
    const { rows } = await pool.query(
      `SELECT cr.*, u.real_name as created_by_name
       FROM cqi_records cr
       LEFT JOIN users u ON cr.created_by = u.id
       ${where}
       ORDER BY cr.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, parseInt(page_size), offset]
    );

    return success(res, { data: rows, total: parseInt(countRes.rows[0].count) });
  } catch (err) { next(err); }
});

// GET /api/cqi/:id - 获取单条CQI记录
router.get('/:id', auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT cr.*, u.real_name as created_by_name
       FROM cqi_records cr LEFT JOIN users u ON cr.created_by = u.id
       WHERE cr.id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return notFound(res, 'CQI记录不存在');
    return success(res, rows[0]);
  } catch (err) { next(err); }
});

// POST /api/cqi - 新建CQI项目
router.post('/', auth, rbac(['admin','head_nurse','quality']), async (req, res, next) => {
  try {
    const {
      title, problem_description, target_indicator,
      responsible_person, plan_start_date, plan_end_date,
    } = req.body;
    if (!title) return error(res, '标题为必填项');

    const { rows } = await pool.query(
      `INSERT INTO cqi_records
         (title, problem_description, target_indicator,
          responsible_person, plan_start_date, plan_end_date,
          status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,'planning',$7) RETURNING *`,
      [title, problem_description, target_indicator,
       responsible_person, plan_start_date, plan_end_date, req.user.id]
    );
    return created(res, rows[0], 'CQI项目已创建');
  } catch (err) { next(err); }
});

// PUT /api/cqi/:id - 更新CQI项目进展
router.put('/:id', auth, async (req, res, next) => {
  try {
    const allowed = [
      'status','measures','implementation_notes',
      'outcome','actual_end_date','summary',
    ];
    const updates = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) updates[k] = req.body[k];
    }
    if (Object.keys(updates).length === 0) return error(res, '无可更新字段');

    const sets = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`).join(', ');
    const { rows } = await pool.query(
      `UPDATE cqi_records SET ${sets}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id, ...Object.values(updates)]
    );
    if (rows.length === 0) return notFound(res, 'CQI记录不存在');
    return success(res, rows[0], 'CQI项目已更新');
  } catch (err) { next(err); }
});

// GET /api/cqi/defects/list - 缺陷上报列表
router.get('/defects/list', auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT dr.*, u.real_name as reported_by_name
       FROM defect_reports dr
       LEFT JOIN users u ON dr.reported_by = u.id
       ORDER BY dr.reported_at DESC LIMIT 100`
    );
    return success(res, rows);
  } catch (err) { next(err); }
});

// POST /api/cqi/defects - 上报缺陷/不良事件
router.post('/defects', auth, async (req, res, next) => {
  try {
    const {
      event_date, defect_type, severity, description,
      patient_id, immediate_action, anonymous
    } = req.body;
    if (!event_date || !defect_type) return error(res, '日期和缺陷类型为必填项');

    const { rows } = await pool.query(
      `INSERT INTO defect_reports
         (event_date, defect_type, severity, description,
          patient_id, immediate_action, is_anonymous, reported_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, defect_type, reported_at`,
      [event_date, defect_type, severity || 'minor', description,
       patient_id || null, immediate_action, anonymous || false, req.user.id]
    );
    return created(res, rows[0], '缺陷事件已上报');
  } catch (err) { next(err); }
});

module.exports = router;
