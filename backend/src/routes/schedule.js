/**
 * 排班管理路由
 * 为每位患者分配上机时间（班次：AM/PM/EV x 周一二三四五六日）
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const auth = require('../middleware/auth');
const { rbac } = require('../middleware/rbac');
const { success, created, error } = require('../utils/response');

// GET /api/schedule/week?date=2026-03-24 - 获取当周排班
router.get('/week', auth, async (req, res, next) => {
  try {
    const { date } = req.query;
    const startDate = date || new Date().toISOString().slice(0, 10);

    // 以weekday维度查询
    const { rows } = await pool.query(
      `SELECT s.*, p.name as patient_name, p.isolation_zone,
              p.status as patient_status,
              va.access_type, va.location as access_location
       FROM schedules s
       JOIN patients p ON s.patient_id = p.id
       LEFT JOIN vascular_accesses va ON va.patient_id = p.id AND va.is_current = true
       WHERE s.effective_from <= $1 AND (s.effective_to IS NULL OR s.effective_to >= $1)
       ORDER BY s.shift, s.machine_no NULLS LAST, p.name`,
      [startDate]
    );
    return success(res, rows);
  } catch (err) { next(err); }
});

// GET /api/schedule/today - 今日上机患者快速列表
router.get('/today', auth, async (req, res, next) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const dayOfWeek = new Date().getDay(); // 0=周日,1=周一...

    const { rows } = await pool.query(
      `SELECT s.*, p.name as patient_name, p.isolation_zone,
              va.access_type, va.location as access_location
       FROM schedules s
       JOIN patients p ON s.patient_id = p.id
       LEFT JOIN vascular_accesses va ON va.patient_id = p.id AND va.is_current = true
       WHERE $1 = ANY(s.weekdays)
         AND s.effective_from <= $2
         AND (s.effective_to IS NULL OR s.effective_to >= $2)
         AND p.status = 'active'
       ORDER BY s.shift, s.machine_no`,
      [dayOfWeek, today]
    );
    return success(res, rows);
  } catch (err) { next(err); }
});

// GET /api/schedule/:patientId - 某患者的排班
router.get('/:patientId', auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM schedules WHERE patient_id = $1
       ORDER BY effective_from DESC`,
      [req.params.patientId]
    );
    return success(res, rows);
  } catch (err) { next(err); }
});

// POST /api/schedule - 设置/更新排班（护士长权限）
router.post('/', auth, rbac(['admin','head_nurse']), async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const {
      patient_id, shift, weekdays, machine_no,
      effective_from, effective_to, notes
    } = req.body;

    if (!patient_id || !shift || !weekdays?.length) {
      return error(res, '患者、班次和透析日为必填项');
    }

    // 将原排班到期
    await client.query(
      `UPDATE schedules SET effective_to = $1, updated_at = NOW()
       WHERE patient_id = $2 AND effective_to IS NULL`,
      [new Date(new Date(effective_from).getTime() - 86400000).toISOString().slice(0, 10),
       patient_id]
    );

    const { rows } = await client.query(
      `INSERT INTO schedules
         (patient_id, shift, weekdays, machine_no, effective_from, effective_to, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [patient_id, shift, weekdays, machine_no, effective_from, effective_to, notes, req.user.id]
    );

    await client.query('COMMIT');
    return created(res, rows[0], '排班已设置');
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally { client.release(); }
});

// GET /api/schedule/overview/current - 全科当前排班总览（机号分布）
router.get('/overview/current', auth, async (req, res, next) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { rows } = await pool.query(
      `SELECT s.shift, s.machine_no, s.weekdays,
              p.id as patient_id, p.name as patient_name,
              p.isolation_zone, va.access_type
       FROM schedules s
       JOIN patients p ON s.patient_id = p.id
       LEFT JOIN vascular_accesses va ON va.patient_id = p.id AND va.is_current = true
       WHERE s.effective_from <= $1 AND (s.effective_to IS NULL OR s.effective_to >= $1)
         AND p.status = 'active'
       ORDER BY s.machine_no NULLS LAST, s.shift`,
      [today]
    );
    return success(res, rows);
  } catch (err) { next(err); }
});

module.exports = router;
