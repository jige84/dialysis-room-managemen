/**
 * 设备耗材管理路由
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const auth = require('../middleware/auth');
const { rbac } = require('../middleware/rbac');
const { success, created, error, notFound } = require('../utils/response');

// ── 透析机管理 ─────────────────────────────────────────────

router.get('/machines', auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT m.*,
         COUNT(dr.id) FILTER (WHERE DATE(dr.session_date) = CURRENT_DATE) as today_sessions
       FROM machines m
       LEFT JOIN dialysis_records dr ON dr.machine_no = m.machine_no
       GROUP BY m.id ORDER BY m.machine_no`
    );
    return success(res, rows);
  } catch (err) { next(err); }
});

router.patch('/machines/:id/status', auth, rbac(['admin','head_nurse']), async (req, res, next) => {
  try {
    const { status, notes } = req.body;
    const { rows } = await pool.query(
      `UPDATE machines SET status = $1, notes = $2, updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [status, notes, req.params.id]
    );
    if (rows.length === 0) return notFound(res, '设备不存在');
    return success(res, rows[0], '设备状态已更新');
  } catch (err) { next(err); }
});

// ── 设备维护记录 ──────────────────────────────────────────

router.get('/maintenance', auth, async (req, res, next) => {
  try {
    const { machine_id, page = 1, page_size = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(page_size);
    const conditions = [];
    const params = [];
    let idx = 1;
    if (machine_id) { conditions.push(`device_id = $${idx++}`); params.push(machine_id); }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const { rows } = await pool.query(
      `SELECT dm.*, m.machine_no, m.model,
              u.real_name as maintained_by_name
       FROM device_maintenance dm
       LEFT JOIN machines m ON dm.device_id = m.id
       LEFT JOIN users u ON dm.maintained_by = u.id
       ${where}
       ORDER BY dm.maintenance_date DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, parseInt(page_size), offset]
    );
    return success(res, rows);
  } catch (err) { next(err); }
});

router.post('/maintenance', auth, rbac(['admin','head_nurse']), async (req, res, next) => {
  try {
    const { device_id, maintenance_type, maintenance_date, content, result, next_due, notes } = req.body;
    if (!device_id || !maintenance_date) return error(res, '设备和维护日期为必填项');

    const { rows } = await pool.query(
      `INSERT INTO device_maintenance
         (device_id, maintenance_type, maintenance_date, content, result, next_due, notes, maintained_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [device_id, maintenance_type, maintenance_date, content, result, next_due, notes, req.user.id]
    );
    return created(res, rows[0], '维护记录已保存');
  } catch (err) { next(err); }
});

// ── 水质检测记录 ──────────────────────────────────────────

router.get('/water-quality', auth, async (req, res, next) => {
  try {
    const { start_date, end_date, page = 1, page_size = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(page_size);
    const conditions = [];
    const params = [];
    let idx = 1;
    if (start_date) { conditions.push(`test_date >= $${idx++}`); params.push(start_date); }
    if (end_date)   { conditions.push(`test_date <= $${idx++}`); params.push(end_date); }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const { rows } = await pool.query(
      `SELECT wq.*, u.real_name as tested_by_name
       FROM water_quality_records wq
       LEFT JOIN users u ON wq.tested_by = u.id
       ${where}
       ORDER BY wq.test_date DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, parseInt(page_size), offset]
    );
    return success(res, rows);
  } catch (err) { next(err); }
});

router.post('/water-quality', auth, rbac(['admin','head_nurse','nurse']), async (req, res, next) => {
  try {
    const {
      test_date, test_type, sample_point,
      bacteria_count, endotoxin_value, conductivity,
      hardness, chlorine, result, notes
    } = req.body;
    if (!test_date) return error(res, '检测日期为必填项');

    const { rows } = await pool.query(
      `INSERT INTO water_quality_records
         (test_date, test_type, sample_point, bacteria_count, endotoxin_value,
          conductivity, hardness, chlorine, result, notes, tested_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [test_date, test_type || 'routine', sample_point, bacteria_count,
       endotoxin_value, conductivity, hardness, chlorine, result, notes, req.user.id]
    );
    return created(res, rows[0], '水质检测记录已保存');
  } catch (err) { next(err); }
});

// ── 耗材库存 ──────────────────────────────────────────────

router.get('/consumables', auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT cs.*, u.real_name as updated_by_name
       FROM consumable_stocks cs
       LEFT JOIN users u ON cs.updated_by = u.id
       ORDER BY cs.category, cs.name`
    );
    return success(res, rows);
  } catch (err) { next(err); }
});

router.patch('/consumables/:id/stock', auth, rbac(['admin','head_nurse','nurse']), async (req, res, next) => {
  try {
    const { quantity, notes, operation } = req.body;  // operation: 'in' | 'out' | 'set'
    if (quantity === undefined) return error(res, '数量为必填项');

    let sql;
    if (operation === 'in')  sql = `current_stock = current_stock + $1`;
    else if (operation === 'out') sql = `current_stock = GREATEST(0, current_stock - $1)`;
    else                     sql = `current_stock = $1`;

    const { rows } = await pool.query(
      `UPDATE consumable_stocks SET ${sql}, notes = $2, updated_by = $3, updated_at = NOW()
       WHERE id = $4 RETURNING *`,
      [quantity, notes, req.user.id, req.params.id]
    );
    if (rows.length === 0) return notFound(res, '耗材记录不存在');
    return success(res, rows[0], '库存已更新');
  } catch (err) { next(err); }
});

module.exports = router;
