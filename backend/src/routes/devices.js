/**
 * 透析机与耗材 REST 路由
 * 主要作用：透析机台账、machine_maintenance、耗材批次与出入库。
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const auth = require('../middleware/auth');
const { rbac } = require('../middleware/rbac');
const { success, created, error, notFound } = require('../utils/response');

// ── 透析机 ────────────────────────────────────────────────

router.get('/machines', auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT m.*,
        COUNT(dr.id)::bigint AS total_sessions,
        COALESCE(SUM(dr.actual_duration), 0)::bigint AS total_runtime_minutes,
        COUNT(dr.id) FILTER (WHERE dr.session_date = CURRENT_DATE)::bigint AS today_sessions,
        lm.last_maintenance_date,
        lm.next_maintenance_due,
        COALESCE(aa.alert_count, 0)::int AS active_alert_count
      FROM machines m
      LEFT JOIN dialysis_records dr ON dr.machine_id = m.id
      LEFT JOIN LATERAL (
        SELECT maintenance_date AS last_maintenance_date, next_due AS next_maintenance_due
        FROM machine_maintenance mm
        WHERE mm.machine_id = m.id
        ORDER BY mm.maintenance_date DESC NULLS LAST
        LIMIT 1
      ) lm ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS alert_count FROM alerts al
        WHERE al.machine_id = m.id AND al.status = 'active'
      ) aa ON true
      GROUP BY m.id, lm.last_maintenance_date, lm.next_maintenance_due, aa.alert_count
      ORDER BY m.machine_no`
    );
    return success(res, rows);
  } catch (err) { next(err); }
});

router.post('/machines', auth, rbac(['admin', 'head_nurse']), async (req, res, next) => {
  try {
    const {
      machine_no, model, brand, zone, status, serial_no, purchase_date, notes,
      bacterial_filter_installed_at, bacterial_filter_max_days, last_dialysate_lab_at, last_disinfection_at,
    } = req.body;
    if (!machine_no) return error(res, '机器编号为必填项');

    const { rows } = await pool.query(
      `INSERT INTO machines (
        machine_no, model, brand, zone, status, serial_no, purchase_date, notes,
        bacterial_filter_installed_at, bacterial_filter_max_days, last_dialysate_lab_at, last_disinfection_at
      ) VALUES ($1,$2,$3,COALESCE($4,'normal'),COALESCE($5,'active'),$6,$7,$8,$9,$10,$11,$12)
      RETURNING *`,
      [
        machine_no, model || null, brand || null, zone, status, serial_no || null,
        purchase_date || null, notes || null,
        bacterial_filter_installed_at || null, bacterial_filter_max_days ?? null,
        last_dialysate_lab_at || null, last_disinfection_at || null,
      ]
    );
    return created(res, rows[0], '透析机已登记');
  } catch (err) { next(err); }
});

router.patch('/machines/:id', auth, rbac(['admin', 'head_nurse']), async (req, res, next) => {
  try {
    const allowed = [
      'model', 'brand', 'zone', 'status', 'serial_no', 'purchase_date', 'notes',
      'bacterial_filter_installed_at', 'bacterial_filter_max_days', 'last_dialysate_lab_at', 'last_disinfection_at',
    ];
    const updates = [];
    const vals = [];
    let i = 1;
    for (const k of allowed) {
      if (req.body[k] !== undefined) {
        updates.push(`${k} = $${i++}`);
        vals.push(req.body[k]);
      }
    }
    if (updates.length === 0) return error(res, '无有效更新字段');
    updates.push(`updated_at = NOW()`);
    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE machines SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`,
      vals
    );
    if (rows.length === 0) return notFound(res, '设备不存在');
    return success(res, rows[0], '已更新');
  } catch (err) { next(err); }
});

router.patch('/machines/:id/status', auth, rbac(['admin', 'head_nurse']), async (req, res, next) => {
  try {
    const { status, notes } = req.body;
    const { rows } = await pool.query(
      `UPDATE machines SET status = $1, notes = COALESCE($2, notes), updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [status, notes, req.params.id]
    );
    if (rows.length === 0) return notFound(res, '设备不存在');
    return success(res, rows[0], '设备状态已更新');
  } catch (err) { next(err); }
});

router.get('/machines/:id/maintenance', auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT mm.*, u.real_name AS maintained_by_name
       FROM machine_maintenance mm
       LEFT JOIN users u ON mm.maintained_by = u.id
       WHERE mm.machine_id = $1
       ORDER BY mm.maintenance_date DESC`,
      [req.params.id]
    );
    return success(res, rows);
  } catch (err) { next(err); }
});

router.post('/machines/:id/maintenance', auth, rbac(['admin', 'head_nurse']), async (req, res, next) => {
  try {
    const {
      maintenance_type, maintenance_date, next_due, content, result, notes,
    } = req.body;
    if (!maintenance_type || !maintenance_date || !content) {
      return error(res, '维护类型、日期与内容为必填项');
    }
    const { rows } = await pool.query(
      `INSERT INTO machine_maintenance (
        machine_id, maintenance_type, maintenance_date, next_due, content, result, notes, maintained_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        req.params.id, maintenance_type, maintenance_date, next_due || null,
        content, result || null, notes || null, req.user.id,
      ]
    );
    return created(res, rows[0], '维护记录已保存');
  } catch (err) { next(err); }
});

router.get('/machines/:id/alerts', auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM alerts WHERE machine_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.params.id]
    );
    return success(res, rows);
  } catch (err) { next(err); }
});

router.post('/machines/:id/alerts', auth, rbac(['admin', 'head_nurse']), async (req, res, next) => {
  try {
    const { alert_type, priority, title, message } = req.body;
    if (!title || !message) {
      return error(res, '标题与内容为必填项');
    }
    const { rows } = await pool.query(
      `INSERT INTO alerts (machine_id, alert_type, priority, title, message, status, created_at)
       VALUES ($1, COALESCE($2, 'machine_alarm'), COALESCE($3, 'medium'), $4, $5, 'pending', NOW())
       RETURNING *`,
      [req.params.id, alert_type || null, priority || null, title, message]
    );
    return created(res, rows[0], '设备异常报警已登记');
  } catch (err) { next(err); }
});

// ── 水机台账与维护 ─────────────────────────────────────────

router.get('/water-machines', auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT wm.*
       FROM water_machines wm
       ORDER BY wm.machine_no`
    );
    return success(res, rows);
  } catch (err) {
    // 表不存在时（尚未执行迁移），返回空列表而不是 500，避免前端报错
    if (err.code === '42P01') {
      return success(res, []);
    }
    next(err);
  }
});

router.post('/water-machines', auth, rbac(['admin', 'head_nurse', 'nurse']), async (req, res, next) => {
  try {
    const { machine_no, model, brand, location, status, last_disinfection_at, next_disinfection_due, notes } = req.body;
    if (!machine_no) return error(res, '水机编号为必填项');
    const { rows } = await pool.query(
      `INSERT INTO water_machines (
         machine_no, model, brand, location, status, last_disinfection_at, next_disinfection_due, notes
       ) VALUES ($1,$2,$3,$4,COALESCE($5,'active'),$6,$7,$8)
       RETURNING *`,
      [
        machine_no,
        model || null,
        brand || null,
        location || null,
        status,
        last_disinfection_at || null,
        next_disinfection_due || null,
        notes || null,
      ]
    );
    return created(res, rows[0], '水机已登记');
  } catch (err) { next(err); }
});

router.get('/water-machines/:id/maintenance', auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT wm.*, u.real_name AS maintained_by_name
       FROM water_machine_maintenance wm
       LEFT JOIN users u ON wm.maintained_by = u.id
       WHERE wm.water_machine_id = $1
       ORDER BY wm.maintenance_date DESC`,
      [req.params.id]
    );
    return success(res, rows);
  } catch (err) { next(err); }
});

router.post('/water-machines/:id/maintenance', auth, rbac(['admin', 'head_nurse', 'nurse']), async (req, res, next) => {
  try {
    const { maintenance_type, maintenance_date, next_due, content, result, notes } = req.body;
    if (!maintenance_type || !maintenance_date || !content) {
      return error(res, '维护类型、日期与内容为必填项');
    }
    const { rows } = await pool.query(
      `INSERT INTO water_machine_maintenance (
         water_machine_id, maintenance_type, maintenance_date, next_due, content, result, notes, maintained_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        req.params.id,
        maintenance_type,
        maintenance_date,
        next_due || null,
        content,
        result || null,
        notes || null,
        req.user.id,
      ]
    );
    return created(res, rows[0], '水机维护记录已保存');
  } catch (err) { next(err); }
});

// ── 兼容旧路径：设备维护（已废弃，指向 machine_maintenance）──────────

router.get('/maintenance', auth, async (req, res, next) => {
  try {
    const { machine_id, page = 1, page_size = 20 } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(page_size, 10);
    const params = [];
    let idx = 1;
    let where = '';
    if (machine_id) {
      where = `WHERE mm.machine_id = $${idx++}`;
      params.push(machine_id);
    }
    const { rows } = await pool.query(
      `SELECT mm.*, m.machine_no, m.model,
              u.real_name AS maintained_by_name
       FROM machine_maintenance mm
       LEFT JOIN machines m ON mm.machine_id = m.id
       LEFT JOIN users u ON mm.maintained_by = u.id
       ${where}
       ORDER BY mm.maintenance_date DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, parseInt(page_size, 10), offset]
    );
    return success(res, rows);
  } catch (err) { next(err); }
});

router.post('/maintenance', auth, rbac(['admin', 'head_nurse']), async (req, res, next) => {
  try {
    const {
      device_id, machine_id, maintenance_type, maintenance_date, next_due, content, result, notes,
    } = req.body;
    const mid = machine_id || device_id;
    if (!mid || !maintenance_date || !content) {
      return error(res, '设备（machine_id）与维护日期、内容为必填项');
    }
    const type = maintenance_type || 'routine';
    const { rows } = await pool.query(
      `INSERT INTO machine_maintenance (
        machine_id, maintenance_type, maintenance_date, next_due, content, result, notes, maintained_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [mid, type, maintenance_date, next_due || null, content, result || null, notes || null, req.user.id]
    );
    return created(res, rows[0], '维护记录已保存');
  } catch (err) { next(err); }
});

// ── 水质检测记录 ──────────────────────────────────────────

router.get('/water-quality', auth, async (req, res, next) => {
  try {
    const { start_date, end_date, page = 1, page_size = 20 } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(page_size, 10);
    const conditions = [];
    const params = [];
    let idx = 1;
    if (start_date) { conditions.push(`test_date >= $${idx++}`); params.push(start_date); }
    if (end_date)   { conditions.push(`test_date <= $${idx++}`); params.push(end_date); }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const { rows } = await pool.query(
      `SELECT wq.*, u.real_name AS tested_by_name
       FROM water_quality_records wq
       LEFT JOIN users u ON wq.tested_by = u.id
       ${where}
       ORDER BY wq.test_date DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, parseInt(page_size, 10), offset]
    );
    return success(res, rows);
  } catch (err) {
    // 若旧环境尚未创建 water_quality_records 表，则容忍并返回空数组
    if (err.code === '42P01') {
      return success(res, []);
    }
    next(err);
  }
});

router.post('/water-quality', auth, rbac(['admin', 'head_nurse', 'nurse']), async (req, res, next) => {
  try {
    const {
      test_date, test_type, sample_point,
      bacteria_count, endotoxin_value, conductivity,
      hardness, chlorine, result, notes,
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
      `SELECT cs.*, u.real_name AS updated_by_name,
        COALESCE(SUM(b.quantity_remaining), 0)::bigint AS batch_remaining_sum
       FROM consumable_stocks cs
       LEFT JOIN users u ON cs.updated_by = u.id
       LEFT JOIN consumable_batches b ON b.stock_item_id = cs.id
       GROUP BY cs.id, u.real_name
       ORDER BY cs.category, cs.item_name`
    );
    return success(res, rows);
  } catch (err) { next(err); }
});

router.post('/consumables', auth, rbac(['admin', 'head_nurse']), async (req, res, next) => {
  try {
    const {
      item_name,
      category,
      specification,
      unit,
      dialyzer_flux,
      manufacturer,
      registration_no,
      storage_location,
      alert_threshold,
    } = req.body;
    if (!item_name || !category || !unit) {
      return error(res, '品名、目录分类与单位为必填项');
    }
    const { rows } = await pool.query(
      `INSERT INTO consumable_stocks (
        item_name, category, specification, unit, dialyzer_flux, manufacturer, registration_no, storage_location,
        alert_threshold, current_stock, updated_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,0),0,$10)
      RETURNING *`,
      [
        item_name,
        category,
        specification || null,
        unit,
        dialyzer_flux || null,
        manufacturer || null,
        registration_no || null,
        storage_location || null,
        alert_threshold ?? 0,
        req.user.id,
      ]
    );
    return created(res, rows[0], '耗材目录已创建');
  } catch (err) { next(err); }
});

router.get('/consumables/:id/last-inbound', auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT lot_no, expiry_date, supplier, unit_price, inbound_at, notes
       FROM consumable_batches
       WHERE stock_item_id = $1
       ORDER BY inbound_at DESC
       LIMIT 1`,
      [req.params.id]
    );
    return success(res, rows[0] || null);
  } catch (err) { next(err); }
});

router.post('/consumables/inbound', auth, rbac(['admin', 'head_nurse', 'nurse']), async (req, res, next) => {
  try {
    const {
      stock_item_id, quantity, lot_no, expiry_date, supplier, unit_price, notes,
    } = req.body;
    if (!stock_item_id || !quantity || !lot_no) {
      return error(res, '耗材、数量、批号为必填项');
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: batchRows } = await client.query(
        `INSERT INTO consumable_batches (
          stock_item_id, lot_no, expiry_date, quantity_remaining, supplier, unit_price, created_by, notes
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (stock_item_id, lot_no) DO UPDATE SET
          quantity_remaining = consumable_batches.quantity_remaining + EXCLUDED.quantity_remaining,
          supplier = COALESCE(EXCLUDED.supplier, consumable_batches.supplier),
          unit_price = COALESCE(EXCLUDED.unit_price, consumable_batches.unit_price)
        RETURNING *`,
        [
          stock_item_id, lot_no, expiry_date || null, quantity,
          supplier || null, unit_price ?? null, req.user.id, notes || null,
        ]
      );
      await client.query(
        `UPDATE consumable_stocks
         SET current_stock = current_stock + $1, updated_at = NOW(), updated_by = $2
         WHERE id = $3`,
        [quantity, req.user.id, stock_item_id]
      );
      await client.query('COMMIT');
      return created(res, batchRows[0], '入库成功');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
});

router.get('/consumables/outbound-lines', auth, async (req, res, next) => {
  try {
    const { start_date, end_date, stock_item_id, page = 1, page_size = 30 } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(page_size, 10);
    const cond = [];
    const params = [];
    let idx = 1;
    if (start_date) { cond.push(`c.outbound_date >= $${idx++}`); params.push(start_date); }
    if (end_date)   { cond.push(`c.outbound_date <= $${idx++}`); params.push(end_date); }
    if (stock_item_id) { cond.push(`c.stock_item_id = $${idx++}`); params.push(stock_item_id); }
    const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
    const { rows } = await pool.query(
      `SELECT c.*, cs.item_name, cs.unit, cs.specification, p.name AS patient_name,
              u.real_name AS operated_by_name
       FROM consumables c
       JOIN consumable_stocks cs ON c.stock_item_id = cs.id
       JOIN patients p ON c.patient_id = p.id
       LEFT JOIN users u ON c.operated_by = u.id
       ${where}
       ORDER BY c.outbound_date DESC, c.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, parseInt(page_size, 10), offset]
    );
    return success(res, rows);
  } catch (err) { next(err); }
});

router.get('/consumables/patient-usage', auth, async (req, res, next) => {
  try {
    const { patient_id, stock_item_id } = req.query;
    if (!patient_id) return error(res, 'patient_id 必填');
    const cond = ['c.patient_id = $1'];
    const params = [patient_id];
    let idx = 2;
    if (stock_item_id) {
      cond.push(`c.stock_item_id = $${idx++}`);
      params.push(stock_item_id);
    }
    const { rows } = await pool.query(
      `SELECT c.*, cs.item_name, cs.unit
       FROM consumables c
       JOIN consumable_stocks cs ON c.stock_item_id = cs.id
       WHERE ${cond.join(' AND ')}
       ORDER BY c.outbound_date DESC
       LIMIT 200`,
      params
    );
    return success(res, rows);
  } catch (err) { next(err); }
});

router.get('/consumables/today-summary', auth, async (req, res, next) => {
  try {
    const { rows: sched } = await pool.query(
      `SELECT COUNT(DISTINCT patient_id)::int AS scheduled_patients
       FROM schedules WHERE scheduled_date = CURRENT_DATE`
    );
    const { rows: outRows } = await pool.query(
      `SELECT COUNT(*)::int AS outbound_lines
       FROM consumables WHERE outbound_date = CURRENT_DATE`
    );
    return success(res, {
      scheduled_patients: sched[0]?.scheduled_patients ?? 0,
      outbound_lines_today: outRows[0]?.outbound_lines ?? 0,
    });
  } catch (err) { next(err); }
});

router.patch('/consumables/:id/stock', auth, rbac(['admin', 'head_nurse', 'nurse']), async (req, res, next) => {
  try {
    const { quantity, notes, operation } = req.body;
    if (quantity === undefined) return error(res, '数量为必填项');

    let sql;
    if (operation === 'in') sql = 'current_stock = current_stock + $1';
    else if (operation === 'out') sql = 'current_stock = GREATEST(0, current_stock - $1)';
    else sql = 'current_stock = $1';

    const { rows } = await pool.query(
      `UPDATE consumable_stocks SET ${sql}, notes = COALESCE($2, notes), updated_by = $3, updated_at = NOW()
       WHERE id = $4 RETURNING *`,
      [quantity, notes, req.user.id, req.params.id]
    );
    if (rows.length === 0) return notFound(res, '耗材记录不存在');
    return success(res, rows[0], '库存已更新');
  } catch (err) { next(err); }
});

module.exports = router;
