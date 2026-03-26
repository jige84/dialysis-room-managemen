/**
 * 长期医嘱路由
 * 开具/修改/停止医嘱 + 护士执行确认
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const auth = require('../middleware/auth');
const { rbac } = require('../middleware/rbac');
const auditLog = require('../middleware/audit');
const OrderAutoFill = require('../services/OrderAutoFill');
const { success, created, paginated, error, notFound } = require('../utils/response');

// ── 静态路由（必须在通配符路由之前）────────────────────────

// POST /api/orders/execute - 护士确认执行医嘱
// orders:execute 权限：admin, nurse, head_nurse
router.post('/execute', auth, rbac(['admin','head_nurse','nurse']),
  async (req, res, next) => {
    try {
      const { order_id, dialysis_id, status = 'executed', actual_dose, notes, execution_date } = req.body;
      if (!order_id) return error(res, 'order_id 为必填项');

      const { rows: orderRows } = await pool.query(
        'SELECT patient_id FROM long_term_orders WHERE id = $1',
        [order_id]
      );
      if (orderRows.length === 0) return error(res, '医嘱不存在');

      const { rows } = await pool.query(
        `INSERT INTO order_executions (
           long_term_order_id, patient_id, dialysis_record_id,
           execution_date, executed_by, status, actual_dose, notes
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id, execution_date, status`,
        [
          order_id, orderRows[0].patient_id, dialysis_id || null,
          execution_date || new Date().toISOString().slice(0, 10),
          req.user.id, status, actual_dose, notes
        ]
      );

      return created(res, rows[0], '医嘱执行确认成功');
    } catch (err) { next(err); }
  }
);

// GET /api/orders/executions?dialysisId=xxx - 某次透析的全部执行记录
router.get('/executions', auth, async (req, res, next) => {
  try {
    const { dialysisId, patientId, page = 1, page_size = 30 } = req.query;
    const offset = (page - 1) * page_size;

    const conditions = [];
    const params = [];
    let idx = 1;

    if (dialysisId) { conditions.push(`oe.dialysis_record_id = $${idx++}`); params.push(dialysisId); }
    if (patientId)  { conditions.push(`oe.patient_id = $${idx++}`); params.push(patientId); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const { rows } = await pool.query(
      `SELECT oe.*, lto.drug_name, lto.dose, lto.route, lto.order_type,
              u.real_name as executed_by_name
       FROM order_executions oe
       JOIN long_term_orders lto ON oe.long_term_order_id = lto.id
       JOIN users u ON oe.executed_by = u.id
       ${where}
       ORDER BY oe.execution_date DESC, oe.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, page_size, offset]
    );

    return success(res, rows);
  } catch (err) { next(err); }
});

// ── 通配符路由 ────────────────────────────────────────────

// GET /api/orders/:patientId/active - 当前有效医嘱
router.get('/:patientId/active', auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT lto.*, u.real_name as ordered_by_name
       FROM long_term_orders lto
       LEFT JOIN users u ON lto.ordered_by = u.id
       WHERE lto.patient_id = $1
         AND lto.status = 'active'
         AND lto.valid_from <= CURRENT_DATE
         AND (lto.valid_until IS NULL OR lto.valid_until >= CURRENT_DATE)
       ORDER BY lto.order_type, lto.created_at`,
      [req.params.patientId]
    );
    return success(res, rows);
  } catch (err) { next(err); }
});

// GET /api/orders/:patientId/history - 医嘱历史
router.get('/:patientId/history', auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT lto.*, u.real_name as ordered_by_name, u2.real_name as stopped_by_name
       FROM long_term_orders lto
       LEFT JOIN users u  ON lto.ordered_by = u.id
       LEFT JOIN users u2 ON lto.stopped_by = u2.id
       WHERE lto.patient_id = $1
       ORDER BY lto.created_at DESC`,
      [req.params.patientId]
    );
    return success(res, rows);
  } catch (err) { next(err); }
});

// GET /api/orders/:patientId/today-tasks - 今日应执行的医嘱
router.get('/:patientId/today-tasks', auth, async (req, res, next) => {
  try {
    const { date } = req.query;
    const data = await OrderAutoFill.prepareForDialysis(req.params.patientId, date);
    return success(res, data.ordersToday);
  } catch (err) { next(err); }
});

// POST /api/orders/:patientId - 开具新医嘱
// orders:write 权限：admin, doctor（规范不含 head_nurse）
router.post('/:patientId', auth, rbac(['admin','doctor']),
  auditLog('long_term_orders', 'CREATE'),
  async (req, res, next) => {
    try {
      const {
        order_type, drug_name, drug_spec, dose, dose_unit, route,
        frequency, frequency_detail, execute_timing,
        valid_from, valid_until, notes
      } = req.body;

      if (!drug_name || !order_type || !frequency) {
        return error(res, '医嘱内容、类型、频次为必填项');
      }

      const { rows: rxRows } = await pool.query(
        'SELECT id FROM prescriptions WHERE patient_id = $1 AND is_current = true LIMIT 1',
        [req.params.patientId]
      );

      const { rows } = await pool.query(
        `INSERT INTO long_term_orders (
           patient_id, prescription_id, order_type, drug_name, drug_spec,
           dose, dose_unit, route, frequency, frequency_detail, execute_timing,
           valid_from, valid_until, notes, ordered_by, ordered_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
         RETURNING *`,
        [
          req.params.patientId, rxRows[0]?.id || null,
          order_type, drug_name, drug_spec, dose, dose_unit, route,
          frequency, frequency_detail || null, execute_timing || null,
          valid_from || new Date().toISOString().slice(0, 10),
          valid_until || null, notes, req.user.id
        ]
      );
      return created(res, rows[0], '医嘱开具成功');
    } catch (err) { next(err); }
  }
);

// PUT /api/orders/:orderId - 修改医嘱（内部实现：停旧开新）
// orders:write 权限：admin, doctor
router.put('/:orderId', auth, rbac(['admin','doctor']),
  auditLog('long_term_orders', 'UPDATE'),
  async (req, res, next) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: oldRows } = await client.query(
        'SELECT * FROM long_term_orders WHERE id = $1',
        [req.params.orderId]
      );
      if (oldRows.length === 0) return notFound(res, '医嘱不存在');
      const old = oldRows[0];

      await client.query(
        `UPDATE long_term_orders SET status = 'stopped', stopped_by = $1, stopped_at = NOW(),
         stop_reason = '修改医嘱', updated_at = NOW() WHERE id = $2`,
        [req.user.id, req.params.orderId]
      );

      const { rows } = await client.query(
        `INSERT INTO long_term_orders (
           patient_id, prescription_id, order_type, drug_name, drug_spec,
           dose, dose_unit, route, frequency, frequency_detail, execute_timing,
           valid_from, valid_until, notes, ordered_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,CURRENT_DATE,$12,$13,$14)
         RETURNING *`,
        [
          old.patient_id, old.prescription_id,
          req.body.order_type || old.order_type,
          req.body.drug_name || old.drug_name,
          req.body.drug_spec || old.drug_spec,
          req.body.dose || old.dose,
          req.body.dose_unit || old.dose_unit,
          req.body.route || old.route,
          req.body.frequency || old.frequency,
          req.body.frequency_detail || old.frequency_detail,
          req.body.execute_timing || old.execute_timing,
          req.body.valid_until || null,
          req.body.notes || old.notes,
          req.user.id
        ]
      );

      await client.query('COMMIT');
      return success(res, rows[0], '医嘱修改成功（旧医嘱已归档）');
    } catch (err) {
      await client.query('ROLLBACK');
      next(err);
    } finally {
      client.release();
    }
  }
);

// PATCH /api/orders/:orderId/stop - 停止医嘱
// orders:write 权限：admin, doctor
router.patch('/:orderId/stop', auth, rbac(['admin','doctor']),
  auditLog('long_term_orders', 'UPDATE'),
  async (req, res, next) => {
    try {
      const { stop_reason } = req.body;
      const { rows } = await pool.query(
        `UPDATE long_term_orders
         SET status = 'stopped', stopped_by = $1, stopped_at = NOW(),
             stop_reason = $2, updated_at = NOW()
         WHERE id = $3 RETURNING id, drug_name, status`,
        [req.user.id, stop_reason || '医嘱停止', req.params.orderId]
      );
      if (rows.length === 0) return notFound(res, '医嘱不存在');
      return success(res, rows[0], `医嘱【${rows[0].drug_name}】已停止`);
    } catch (err) { next(err); }
  }
);

module.exports = router;
