/**
 * 预警管理 REST 路由
 * 主要作用：为前端预警中心提供查询与处理接口，对接系统生成的各类临床预警。
 * 主要功能：预警列表与筛选；感染筛查/Kt/V/化验等类型展示；状态更新（依实现与 RBAC）。
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const auth = require('../middleware/auth');
const { rbac } = require('../middleware/rbac');
const { success } = require('../utils/response');

// GET /api/alerts - 获取当前用户相关的所有预警
router.get('/', auth, async (req, res, next) => {
  try {
    const { type, status = 'pending', page = 1, page_size = 50 } = req.query;
    // 纯 JS：req.query 在 JS 中无法做 TS 类型断言
    const offset = (parseInt(page) - 1) * parseInt(page_size);

    const conditions = ['(a.assigned_to IS NULL OR a.assigned_to = $1)'];
    const params = [req.user.id];
    let idx = 2;

    if (status !== 'all') {
      conditions.push(`a.status = $${idx++}`);
      params.push(status);
    }
    if (type) {
      conditions.push(`a.alert_type = $${idx++}`);
      params.push(type);
    }

    const where = conditions.join(' AND ');
    const { rows } = await pool.query(
      `SELECT a.*, p.name as patient_name
       FROM alerts a
       LEFT JOIN patients p ON a.patient_id = p.id
       WHERE ${where}
       ORDER BY a.priority DESC, a.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, parseInt(page_size), offset]
    );

    const countRes = await pool.query(
      `SELECT COUNT(*) FROM alerts a WHERE ${where}`,
      params
    );

    return success(res, { data: rows, total: parseInt(countRes.rows[0].count) });
  } catch (e) { next(e); }
});

// GET /api/alerts/summary - 预警汇总数量（首页徽标用）
router.get('/summary', auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT alert_type, COUNT(*) as count
       FROM alerts
       WHERE status = 'pending'
       GROUP BY alert_type`
    );
    const summary = { total: 0 };
    for (const row of rows) {
      summary[row.alert_type] = parseInt(row.count);
      summary.total += parseInt(row.count);
    }
    return success(res, summary);
  } catch (err) { next(err); }
});

// PATCH /api/alerts/:id/ack - 确认处理预警
router.patch('/:id/ack', auth, async (req, res, next) => {
  try {
    const { action_note } = req.body;
    const { rows } = await pool.query(
      `UPDATE alerts
       SET status = 'acknowledged', ack_by = $1, ack_at = NOW(), action_note = $2, updated_at = NOW()
       WHERE id = $3 RETURNING id, alert_type, status`,
      [req.user.id, action_note, req.params.id]
    );
    return success(res, rows[0], '预警已确认处理');
  } catch (err) { next(err); }
});

// POST /api/alerts/run-checks - 手动触发全科预警扫描（仅管理员）
router.post('/run-checks', auth, rbac(['admin']), async (req, res, next) => {
  try {
    const AlertEngine = require('../services/AlertEngine');
    const result = await AlertEngine.runAll();
    return success(res, result, `预警扫描完成，共生成 ${result.generated} 条新预警`);
  } catch (err) { next(err); }
});

module.exports = router;
