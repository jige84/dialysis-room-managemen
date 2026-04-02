/**
 * 预警管理 REST 路由
 * 字段与 migrations/021_create_audit_alerts.sql 完全对齐：
 *   severity（不是 priority）、status=active/dismissed/handled/auto_closed
 *   handled_by/handled_at/handle_notes（不是 ack_by/ack_at/action_note）
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const auth = require('../middleware/auth');
const { rbac } = require('../middleware/rbac');
const { success } = require('../utils/response');

// GET /api/alerts - 预警列表（支持筛选）
router.get('/', auth, async (req, res, next) => {
  try {
    const { type, severity, status = 'active', page = 1, page_size = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(page_size);

    const conditions = [];
    const params = [];
    let idx = 1;

    if (status && status !== 'all') {
      conditions.push(`a.status = $${idx++}`);
      params.push(status);
    }
    if (type) {
      conditions.push(`a.alert_type = $${idx++}`);
      params.push(type);
    }
    if (severity) {
      conditions.push(`a.severity = $${idx++}`);
      params.push(severity);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const { rows } = await pool.query(
      `SELECT a.id, a.patient_id, a.alert_rule_id, a.alert_type, a.severity,
              a.title, a.message, a.status, a.handled_by, a.handled_at,
              a.handle_notes, a.notified_roles, a.created_at,
              p.name as patient_name
       FROM alerts a
       LEFT JOIN patients p ON a.patient_id = p.id
       ${where}
       ORDER BY
         CASE a.severity WHEN 'emergency' THEN 1 WHEN 'critical' THEN 2 WHEN 'warning' THEN 3 WHEN 'info' THEN 4 ELSE 5 END,
         a.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, parseInt(page_size), offset]
    );

    const countRes = await pool.query(
      `SELECT COUNT(*) FROM alerts a ${where}`,
      params
    );

    return success(res, { data: rows, total: parseInt(countRes.rows[0].count) });
  } catch (e) { next(e); }
});

// GET /api/alerts/summary - 按 severity 分组计数（首页徽标用）
router.get('/summary', auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT severity, COUNT(*) as count
       FROM alerts
       WHERE status = 'active'
       GROUP BY severity`
    );
    const summary = { total: 0, emergency: 0, critical: 0, warning: 0, info: 0 };
    for (const row of rows) {
      summary[row.severity] = parseInt(row.count);
      summary.total += parseInt(row.count);
    }
    return success(res, summary);
  } catch (err) { next(err); }
});

// PATCH /api/alerts/:id/ack - 确认/处理预警
router.patch('/:id/ack', auth, async (req, res, next) => {
  try {
    const { handle_notes, new_status = 'handled' } = req.body;
    const validStatuses = ['handled', 'dismissed'];
    const targetStatus = validStatuses.includes(new_status) ? new_status : 'handled';

    const { rows } = await pool.query(
      `UPDATE alerts
       SET status = $1, handled_by = $2, handled_at = NOW(), handle_notes = $3
       WHERE id = $4 AND status = 'active'
       RETURNING id, alert_type, severity, status`,
      [targetStatus, req.user.id, handle_notes, req.params.id]
    );

    if (rows.length === 0) {
      return success(res, null, '预警不存在或已处理');
    }
    return success(res, rows[0], '预警已处理');
  } catch (err) { next(err); }
});

// POST /api/alerts/run-checks - 手动触发全科预警扫描
router.post('/run-checks', auth, rbac(['admin']), async (req, res, next) => {
  try {
    const AlertEngine = require('../services/AlertEngine');
    const result = await AlertEngine.runAll();
    return success(res, result, `预警扫描完成，共生成 ${result.generated} 条新预警`);
  } catch (err) { next(err); }
});

module.exports = router;
