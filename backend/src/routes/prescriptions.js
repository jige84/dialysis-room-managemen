/**
 * 透析处方路由（医生端）
 * 开具新处方时会自动归档旧处方，并联动已关联的长期医嘱
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const auth = require('../middleware/auth');
const { rbac } = require('../middleware/rbac');
const auditLog = require('../middleware/audit');
const { success, created, error, notFound } = require('../utils/response');

// GET /api/prescriptions/:patientId/current
router.get('/:patientId/current', auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*, u.real_name as prescribed_by_name
       FROM prescriptions p
       LEFT JOIN users u ON p.prescribed_by = u.id
       WHERE p.patient_id = $1 AND p.is_current = true
       LIMIT 1`,
      [req.params.patientId]
    );
    return success(res, rows[0] || null);
  } catch (err) { next(err); }
});

// GET /api/prescriptions/:patientId/history
router.get('/:patientId/history', auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*, u.real_name as prescribed_by_name
       FROM prescriptions p
       LEFT JOIN users u ON p.prescribed_by = u.id
       WHERE p.patient_id = $1
       ORDER BY p.created_at DESC`,
      [req.params.patientId]
    );
    return success(res, rows);
  } catch (err) { next(err); }
});

// POST /api/prescriptions/:patientId - 开具新处方
// prescriptions:write 权限：admin, doctor（规范不含 head_nurse）
router.post('/:patientId', auth, rbac(['admin','doctor']),
  auditLog('prescriptions', 'CREATE'),
  async (req, res, next) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const {
        frequency_per_week, duration_hours, dialyzer_model, dialyzer_area, dialyzer_flux,
        anticoagulant, heparin_prime_dose, heparin_maintain,
        dry_weight, dry_weight_date, dry_weight_reason,
        dialysate_na, dialysate_ca, dialysate_k, dialysate_temp,
        blood_flow_rate, dialysate_flow_rate, notes
      } = req.body;

      if (!dry_weight || !dry_weight_date) {
        return error(res, '干体重和评估日期为必填项');
      }

      // 1. 归档旧处方
      await client.query(
        `UPDATE prescriptions SET is_current = false, valid_until = CURRENT_DATE
         WHERE patient_id = $1 AND is_current = true`,
        [req.params.patientId]
      );

      // 2. 创建新处方
      const { rows } = await client.query(
        `INSERT INTO prescriptions (
           patient_id, frequency_per_week, duration_hours,
           dialyzer_model, dialyzer_area, dialyzer_flux,
           anticoagulant, heparin_prime_dose, heparin_maintain,
           dry_weight, dry_weight_date, dry_weight_reason,
           dialysate_na, dialysate_ca, dialysate_k, dialysate_temp,
           blood_flow_rate, dialysate_flow_rate, notes,
           prescribed_by, valid_from, is_current
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,CURRENT_DATE,true
         ) RETURNING *`,
        [
          req.params.patientId, frequency_per_week || 3, duration_hours || 4.0,
          dialyzer_model, dialyzer_area, dialyzer_flux,
          anticoagulant || 'heparin', heparin_prime_dose, heparin_maintain,
          dry_weight, dry_weight_date, dry_weight_reason,
          dialysate_na || 138, dialysate_ca || 1.5, dialysate_k || 2.0, dialysate_temp || 36.5,
          blood_flow_rate || 250, dialysate_flow_rate || 500, notes,
          req.user.id
        ]
      );

      const newRx = rows[0];

      // 3. 将当前活跃医嘱关联到新处方（不终止医嘱，只更新外键）
      await client.query(
        `UPDATE long_term_orders SET prescription_id = $1
         WHERE patient_id = $2 AND status = 'active'`,
        [newRx.id, req.params.patientId]
      );

      await client.query('COMMIT');
      return created(res, newRx, '透析处方开具成功');
    } catch (err) {
      await client.query('ROLLBACK');
      next(err);
    } finally {
      client.release();
    }
  }
);

// PATCH /api/prescriptions/:id/dry-weight - 仅更新干体重（常用操作）
// prescriptions:write 权限：admin, doctor
router.patch('/:id/dry-weight', auth, rbac(['admin','doctor']),
  auditLog('prescriptions', 'UPDATE'),
  async (req, res, next) => {
    try {
      const { dry_weight, dry_weight_date, dry_weight_reason } = req.body;
      if (!dry_weight) return error(res, '干体重为必填项');

      const { rows } = await pool.query(
        `UPDATE prescriptions
         SET dry_weight = $1, dry_weight_date = $2, dry_weight_reason = $3, updated_at = NOW()
         WHERE id = $4 RETURNING id, dry_weight, dry_weight_date`,
        [dry_weight, dry_weight_date || new Date().toISOString().slice(0,10), dry_weight_reason, req.params.id]
      );
      if (rows.length === 0) return notFound(res, '处方不存在');
      return success(res, rows[0], '干体重更新成功');
    } catch (err) { next(err); }
  }
);

module.exports = router;
