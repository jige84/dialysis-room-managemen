/**
 * CQI（持续质量改进）REST 路由
 * 修复：静态路由 /defects/list 放在 /:id 通配之前；PUT 加 rbac。
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const auth = require('../middleware/auth');
const { rbac } = require('../middleware/rbac');
const auditLog = require('../middleware/audit');
const { success, created, error, notFound } = require('../utils/response');

// GET /api/cqi - CQI 记录列表
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

// ── 静态路由（必须在 /:id 通配之前） ────────────────────

// GET /api/cqi/defects/list - 缺陷上报列表
router.get('/defects/list', auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT dr.*, u.real_name as reported_by_name
       FROM defect_reports dr
       LEFT JOIN users u ON dr.reported_by = u.id
       ORDER BY dr.event_time DESC LIMIT 100`
    );
    return success(res, rows);
  } catch (err) { next(err); }
});

// POST /api/cqi/defects - 上报缺陷/不良事件
router.post('/defects', auth, auditLog('defect_reports', 'CREATE'), async (req, res, next) => {
  try {
    const {
      event_time, event_type, severity, description,
      involved_patient_ids, immediate_action, anonymous
    } = req.body;
    if (!event_time || !event_type) return error(res, '事件时间和事件类型为必填项');

    const { rows } = await pool.query(
      `INSERT INTO defect_reports
         (event_time, event_type, severity, description,
          involved_patient_ids, immediate_action, is_anonymous, reported_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, event_type, event_time`,
      [event_time, event_type, severity || 'minor', description,
       involved_patient_ids || null, immediate_action, anonymous || false, req.user.id]
    );
    return created(res, rows[0], '缺陷事件已上报');
  } catch (err) { next(err); }
});

// ── 通配路由 ────────────────────────────────────────────

// GET /api/cqi/:id - 单条 CQI 记录
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

// POST /api/cqi - 新建 CQI 项目
router.post('/', auth, rbac(['admin','head_nurse','quality']),
  auditLog('cqi_records', 'CREATE'),
  async (req, res, next) => {
  try {
    const {
      project_type, title, problem_found, measures,
      start_date, target_description, target_value, target_unit, notes,
    } = req.body;
    if (!title || !project_type) return error(res, '标题和项目类型为必填项');

    const { rows } = await pool.query(
      `INSERT INTO cqi_records
         (project_type, title, problem_found, measures,
          start_date, target_description, target_value, target_unit,
          notes, leader_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [project_type, title, problem_found || '', measures || '',
       start_date || new Date().toISOString().slice(0, 10),
       target_description, target_value, target_unit, notes, req.user.id]
    );
    return created(res, rows[0], 'CQI项目已创建');
  } catch (err) { next(err); }
});

// PUT /api/cqi/:id - 更新 CQI 进展
router.put('/:id', auth, rbac(['admin','head_nurse','quality']),
  auditLog('cqi_records', 'UPDATE'),
  async (req, res, next) => {
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

module.exports = router;
