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
const PG_UNDEFINED_COLUMN = '42703';
const PG_FOREIGN_KEY_VIOLATION = '23503';
/** PostgreSQL uuid 文本格式（参数化查询，仅校验格式防无效输入） */
const PG_UUID_TEXT_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuidText(value) {
  return typeof value === 'string' && PG_UUID_TEXT_RE.test(value.trim());
}

function isWaterQualityUserColumnMissing(err) {
  if (!err || err.code !== PG_UNDEFINED_COLUMN) return false;
  const msg = String(err.message || '');
  return msg.includes('entered_by') || msg.includes('tested_by');
}

function isWaterQualityWaterMachineColumnMissing(err) {
  if (!err || err.code !== PG_UNDEFINED_COLUMN) return false;
  return String(err.message || '').includes('water_machine_id');
}

async function queryWaterQualityList({ where, params, limit, offset }) {
  const baseParams = [...params, limit, offset];
  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;

  async function runWithUser(userColumn, withMachineJoin) {
    const wmJoin = withMachineJoin
      ? 'LEFT JOIN water_machines wm ON wq.water_machine_id = wm.id'
      : '';
    const wmSelect = withMachineJoin ? 'wm.machine_no AS water_machine_no' : 'NULL::text AS water_machine_no';
    return pool.query(
      `SELECT wq.*, u.real_name AS tested_by_name, ${wmSelect}
       FROM water_quality_records wq
       LEFT JOIN users u ON wq.${userColumn} = u.id
       ${wmJoin}
       ${where}
       ORDER BY wq.test_date DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      baseParams,
    );
  }

  async function runNoUser(withMachineJoin) {
    const wmJoin = withMachineJoin
      ? 'LEFT JOIN water_machines wm ON wq.water_machine_id = wm.id'
      : '';
    const wmSelect = withMachineJoin ? 'wm.machine_no AS water_machine_no' : 'NULL::text AS water_machine_no';
    return pool.query(
      `SELECT wq.*, NULL::text AS tested_by_name, ${wmSelect}
       FROM water_quality_records wq
       ${wmJoin}
       ${where}
       ORDER BY wq.test_date DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      baseParams,
    );
  }

  async function tryUserColumn(userColumn) {
    try {
      return await runWithUser(userColumn, true);
    } catch (err) {
      if (err.code === PG_UNDEFINED_COLUMN && isWaterQualityWaterMachineColumnMissing(err)) {
        return runWithUser(userColumn, false);
      }
      throw err;
    }
  }

  async function tryNoUser() {
    try {
      return await runNoUser(true);
    } catch (err) {
      if (err.code === PG_UNDEFINED_COLUMN && isWaterQualityWaterMachineColumnMissing(err)) {
        return runNoUser(false);
      }
      throw err;
    }
  }

  try {
    return await tryUserColumn('entered_by');
  } catch (err) {
    if (!isWaterQualityUserColumnMissing(err)) throw err;
  }

  try {
    return await tryUserColumn('tested_by');
  } catch (err) {
    if (!isWaterQualityUserColumnMissing(err)) throw err;
  }

  return tryNoUser();
}

/**
 * values: [test_date, test_type, sample_point, result_value, result_unit, result_text, is_qualified, notes, userId]
 * waterMachineId: optional UUID string
 */
async function insertWaterQualityRecord(values, waterMachineId) {
  const wm = waterMachineId || null;
  const base8 = values.slice(0, 8);
  const userId = values[8];

  const insertEnteredByWithWm = () =>
    pool.query(
      `INSERT INTO water_quality_records
         (test_date, test_type, sample_point, result_value, result_unit,
          result_text, is_qualified, notes, entered_by, water_machine_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [...base8, userId, wm],
    );

  const insertEnteredBy = () =>
    pool.query(
      `INSERT INTO water_quality_records
         (test_date, test_type, sample_point, result_value, result_unit,
          result_text, is_qualified, notes, entered_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      values,
    );

  const insertTestedByWithWm = () =>
    pool.query(
      `INSERT INTO water_quality_records
         (test_date, test_type, sample_point, result_value, result_unit,
          result_text, is_qualified, notes, tested_by, water_machine_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [...base8, userId, wm],
    );

  const insertTestedBy = () =>
    pool.query(
      `INSERT INTO water_quality_records
         (test_date, test_type, sample_point, result_value, result_unit,
          result_text, is_qualified, notes, tested_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      values,
    );

  const insertWmOnly = () =>
    pool.query(
      `INSERT INTO water_quality_records
         (test_date, test_type, sample_point, result_value, result_unit,
          result_text, is_qualified, notes, water_machine_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [...base8, wm],
    );

  const insertBare = () =>
    pool.query(
      `INSERT INTO water_quality_records
         (test_date, test_type, sample_point, result_value, result_unit,
          result_text, is_qualified, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      base8,
    );

  try {
    return await insertEnteredByWithWm();
  } catch (err) {
    if (!isWaterQualityWaterMachineColumnMissing(err)) {
      if (!isWaterQualityUserColumnMissing(err)) throw err;
    }
  }

  try {
    return await insertEnteredBy();
  } catch (err) {
    if (!isWaterQualityUserColumnMissing(err)) throw err;
  }

  try {
    return await insertTestedByWithWm();
  } catch (err) {
    if (!isWaterQualityWaterMachineColumnMissing(err)) {
      if (!isWaterQualityUserColumnMissing(err)) throw err;
    }
  }

  try {
    return await insertTestedBy();
  } catch (err) {
    if (!isWaterQualityUserColumnMissing(err)) throw err;
  }

  try {
    return await insertWmOnly();
  } catch (err) {
    if (!isWaterQualityWaterMachineColumnMissing(err)) throw err;
  }

  return insertBare();
}

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
    const { alert_type, priority, severity, title, message } = req.body;
    if (!title || !message) {
      return error(res, '标题与内容为必填项');
    }
    const nextAlertType = alert_type || 'machine_alarm';
    const severityMap = {
      low: 'info',
      medium: 'warning',
      high: 'critical',
      critical: 'emergency',
      info: 'info',
      warning: 'warning',
      emergency: 'emergency',
    };
    const nextSeverity = severityMap[String(severity || priority || 'medium')] || 'warning';
    const { rows } = await pool.query(
      `INSERT INTO alerts (
         machine_id, alert_rule_id, alert_type, severity, title, message, status, created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, 'active', NOW())
       RETURNING *`,
      [req.params.id, nextAlertType, nextAlertType, nextSeverity, title, message]
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
    const { start_date, end_date, water_machine_id, page = 1, page_size = 20 } = req.query;
    if (water_machine_id && !isUuidText(String(water_machine_id))) {
      return error(res, 'water_machine_id 格式无效', 400);
    }
    const offset = (parseInt(page, 10) - 1) * parseInt(page_size, 10);
    const conditions = [];
    const params = [];
    let idx = 1;
    if (start_date) { conditions.push(`wq.test_date >= $${idx++}`); params.push(start_date); }
    if (end_date)   { conditions.push(`wq.test_date <= $${idx++}`); params.push(end_date); }
    if (water_machine_id) { conditions.push(`wq.water_machine_id = $${idx++}`); params.push(String(water_machine_id).trim()); }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const { rows } = await queryWaterQualityList({
      where,
      params,
      limit: parseInt(page_size, 10),
      offset,
    });
    const normalized = rows.map((row) => {
      const value = row.result_value != null ? Number(row.result_value) : null;
      const result =
        typeof row.result_text === 'string' && row.result_text.trim()
          ? row.result_text
          : row.is_qualified === null || row.is_qualified === undefined
            ? null
            : row.is_qualified
              ? 'qualified'
              : 'unqualified';
      return {
        ...row,
        result,
        tested_by_name: row.tested_by_name || null,
        bacteria_count: row.test_type && String(row.test_type).startsWith('bacteria_') ? value : null,
        endotoxin_value: row.test_type && String(row.test_type).startsWith('endotoxin_') ? value : null,
      };
    });
    return success(res, normalized);
  } catch (err) {
    // 若旧环境尚未创建 water_quality_records 表，则容忍并返回空数组
    if (err.code === '42P01') {
      return success(res, []);
    }
    // 未执行 055 迁移时 wq.water_machine_id 不存在
    if (
      err.code === PG_UNDEFINED_COLUMN
      && (err.column === 'water_machine_id' || String(err.message || '').includes('water_machine_id'))
    ) {
      return error(res, '请先执行数据库迁移（含 water_quality_records.water_machine_id）', 503);
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
      water_machine_id: waterMachineIdBody,
    } = req.body;
    if (!test_date) return error(res, '检测日期为必填项');

    const wmIdTrimmed = waterMachineIdBody ? String(waterMachineIdBody).trim() : '';
    if (waterMachineIdBody) {
      if (!isUuidText(wmIdTrimmed)) return error(res, 'water_machine_id 格式无效', 400);
      const { rows: wmExists } = await pool.query('SELECT 1 FROM water_machines WHERE id = $1::uuid LIMIT 1', [wmIdTrimmed]);
      if (wmExists.length === 0) return error(res, '关联的水机不存在', 400);
    }

    const resolvedType = test_type
      || (bacteria_count !== undefined && bacteria_count !== null ? 'bacteria_water' : null)
      || (endotoxin_value !== undefined && endotoxin_value !== null ? 'endotoxin_water' : null);
    if (!resolvedType) {
      return error(res, 'test_type 必填，或至少提供 bacteria_count / endotoxin_value 之一', 400);
    }

    const numericValue = bacteria_count ?? endotoxin_value ?? null;
    const resultText = result || [conductivity, hardness, chlorine].filter((v) => v !== undefined && v !== null && v !== '').join(' / ') || null;
    const resultUnit = bacteria_count != null ? 'CFU/mL' : endotoxin_value != null ? 'EU/mL' : null;
    const isQualified = result === 'qualified'
      ? true
      : result === 'unqualified'
        ? false
        : null;

    const { rows } = await insertWaterQualityRecord([
      test_date,
      resolvedType,
      sample_point || '产水点',
      numericValue,
      resultUnit,
      resultText,
      isQualified,
      notes,
      req.user.id,
    ], wmIdTrimmed || null);
    const row = rows[0];

    let resultCode = null;
    if (result === 'qualified' || result === 'unqualified') {
      resultCode = result;
    } else if (isQualified === true) {
      resultCode = 'qualified';
    } else if (isQualified === false) {
      resultCode = 'unqualified';
    }

    if (wmIdTrimmed && resultCode) {
      try {
        await pool.query(
          `UPDATE water_machines
           SET last_water_test_date = $1::date,
               last_water_test_result = $2,
               updated_at = NOW()
           WHERE id = $3::uuid
             AND ($1::date >= COALESCE(last_water_test_date, '1900-01-01'::date))`,
          [test_date, resultCode, wmIdTrimmed],
        );
      } catch (wmErr) {
        if (wmErr.code !== '42P01') throw wmErr;
      }
    }

    let waterMachineNo = null;
    const wmIdForResponse = row.water_machine_id || wmIdTrimmed || null;
    if (wmIdForResponse) {
      try {
        const { rows: wmRows } = await pool.query(
          'SELECT machine_no FROM water_machines WHERE id = $1',
          [wmIdForResponse],
        );
        waterMachineNo = wmRows[0]?.machine_no ?? null;
      } catch (wmErr) {
        if (wmErr.code !== '42P01') throw wmErr;
      }
    }

    return created(res, {
      ...row,
      result: row.result_text || result || null,
      tested_by_name: null,
      water_machine_no: waterMachineNo,
      bacteria_count: String(row.test_type).startsWith('bacteria_') && row.result_value != null ? Number(row.result_value) : null,
      endotoxin_value: String(row.test_type).startsWith('endotoxin_') && row.result_value != null ? Number(row.result_value) : null,
    }, '水质检测记录已保存');
  } catch (err) {
    if (err.code === PG_FOREIGN_KEY_VIOLATION) {
      return error(res, '关联的水机不存在或数据不一致', 400);
    }
    next(err);
  }
});

// ── 水处理日常检测记录（硬度、压差、电导等）────────────────

router.get('/water-daily-inspections', auth, async (req, res, next) => {
  try {
    const { start_date, end_date, water_machine_id, page = 1, page_size = 30 } = req.query;
    if (water_machine_id && !isUuidText(String(water_machine_id))) {
      return error(res, 'water_machine_id 格式无效', 400);
    }
    const offset = (parseInt(page, 10) - 1) * parseInt(page_size, 10);
    const conditions = [];
    const params = [];
    let idx = 1;
    if (start_date) { conditions.push(`w.check_date >= $${idx++}`); params.push(start_date); }
    if (end_date) { conditions.push(`w.check_date <= $${idx++}`); params.push(end_date); }
    if (water_machine_id) { conditions.push(`w.water_machine_id = $${idx++}`); params.push(String(water_machine_id).trim()); }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const { rows } = await pool.query(
      `SELECT w.*, wm.machine_no AS water_machine_no, u.real_name AS entered_by_name
       FROM water_daily_inspections w
       LEFT JOIN water_machines wm ON w.water_machine_id = wm.id
       LEFT JOIN users u ON w.entered_by = u.id
       ${where}
       ORDER BY w.check_date DESC, w.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, parseInt(page_size, 10), offset],
    );
    return success(res, rows);
  } catch (err) {
    if (err.code === '42P01') {
      return success(res, []);
    }
    next(err);
  }
});

router.post('/water-daily-inspections', auth, rbac(['admin', 'head_nurse', 'nurse']), async (req, res, next) => {
  try {
    const {
      water_machine_id: wmId,
      check_date,
      hardness, total_chlorine, tap_pressure,
      sand_delta_p, resin_delta_p, carbon_delta_p,
      ro_in_pressure, ro_out_pressure,
      feed_conductivity, product_conductivity,
      product_flow, drain_flow, feed_temp,
      operator, operator_name,
      notes,
    } = req.body;
    if (!check_date) return error(res, '检测日期为必填项');

    const wmIdResolved = wmId ? String(wmId).trim() : '';
    if (wmId) {
      if (!isUuidText(wmIdResolved)) return error(res, 'water_machine_id 格式无效', 400);
      const { rows: wmExists } = await pool.query('SELECT 1 FROM water_machines WHERE id = $1::uuid LIMIT 1', [wmIdResolved]);
      if (wmExists.length === 0) return error(res, '关联的水机不存在', 400);
    }

    const opName = operator_name || operator || null;

    const { rows } = await pool.query(
      `INSERT INTO water_daily_inspections (
        water_machine_id, check_date,
        hardness, total_chlorine, tap_pressure,
        sand_delta_p, resin_delta_p, carbon_delta_p,
        ro_in_pressure, ro_out_pressure,
        feed_conductivity, product_conductivity,
        product_flow, drain_flow, feed_temp,
        operator_name, notes, entered_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      RETURNING *`,
      [
        wmIdResolved || null,
        check_date,
        hardness || null,
        total_chlorine || null,
        tap_pressure || null,
        sand_delta_p || null,
        resin_delta_p || null,
        carbon_delta_p || null,
        ro_in_pressure || null,
        ro_out_pressure || null,
        feed_conductivity || null,
        product_conductivity || null,
        product_flow || null,
        drain_flow || null,
        feed_temp || null,
        opName,
        notes || null,
        req.user.id,
      ],
    );
    const row = rows[0];
    let waterMachineNo = null;
    if (row.water_machine_id) {
      const { rows: wmRows } = await pool.query(
        'SELECT machine_no FROM water_machines WHERE id = $1',
        [row.water_machine_id],
      );
      waterMachineNo = wmRows[0]?.machine_no ?? null;
    }
    return created(res, {
      ...row,
      water_machine_no: waterMachineNo,
      entered_by_name: null,
    }, '日常检测记录已保存');
  } catch (err) {
    if (err.code === '42P01') {
      return error(res, '请先执行数据库迁移以创建 water_daily_inspections 表', 503);
    }
    if (err.code === PG_FOREIGN_KEY_VIOLATION) {
      return error(res, '关联的水机不存在或数据不一致', 400);
    }
    next(err);
  }
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
