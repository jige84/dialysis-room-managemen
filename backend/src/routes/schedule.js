/**
 * 周排班 REST 路由
 * 主要作用：维护患者与护士的周排班视图，供床位与人力安排使用。
 * 主要功能：按周查询班次患者/护士列表与护患比；调整护士排班；预留患者调班接口。
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const auth = require('../middleware/auth');
const { rbac } = require('../middleware/rbac');
const { success, created, error } = require('../utils/response');

const SHIFT_MAP = {
  am: 'morning',
  pm: 'afternoon',
  eve: 'evening',
};

const SHIFT_LABEL = {
  morning: 'am',
  afternoon: 'pm',
  evening: 'eve',
};

/**
 * 将班次英文字段转换为前端简写键
 */
const toShiftKey = (shift) => SHIFT_LABEL[shift] || shift;

/**
 * 计算一周的起始日期（周一）
 */
const getWeekStart = (dateStr) => {
  const d = new Date(dateStr);
  const day = d.getDay() || 7; // 周日=0 → 7
  d.setDate(d.getDate() - (day - 1));
  return d.toISOString().slice(0, 10);
};

// GET /api/schedule/week?start_date=2026-04-06 - 获取当周排班（周视图）
router.get('/week', auth, async (req, res, next) => {
  try {
    const { start_date: queryStart } = req.query;
    const todayStr = new Date().toISOString().slice(0, 10);
    const weekStart = getWeekStart(queryStart || todayStr);
    const start = new Date(weekStart);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const weekEnd = end.toISOString().slice(0, 10);

    // 取出本周所有排班实例 + 患者 / 机器信息
    const { rows: scheduleRows } = await pool.query(
      `SELECT s.scheduled_date,
              s.shift,
              s.patient_id,
              s.machine_id,
              s.is_temp,
              s.status,
              p.name AS patient_name,
              p.isolation_zone,
              m.machine_no
       FROM schedules s
       JOIN patients p ON s.patient_id = p.id
       LEFT JOIN machines m ON s.machine_id = m.id
       WHERE s.scheduled_date BETWEEN $1 AND $2`,
      [weekStart, weekEnd]
    );

    // 护士排班
    const { rows: nurseRows } = await pool.query(
      `SELECT n.duty_date,
              n.shift,
              n.nurse_id,
              u.real_name AS nurse_name
       FROM nurse_schedule n
       JOIN users u ON n.nurse_id = u.id
       WHERE n.duty_date BETWEEN $1 AND $2`,
      [weekStart, weekEnd]
    );

    // 护患比（按日/班次聚合）
    const { rows: ratioRows } = await pool.query(
      `SELECT duty_date,
              shift,
              patient_count,
              nurse_count,
              ratio_value,
              compliant
       FROM vw_shift_staffing
       WHERE duty_date BETWEEN $1 AND $2`,
      [weekStart, weekEnd]
    );

    // 组装返回结构
    const shifts = ['am', 'pm', 'eve'];
    const days = [];
    for (let i = 0; i < 7; i += 1) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().slice(0, 10);
      const label = ['周一','周二','周三','周四','周五','周六','周日'][i];
      days.push({ date: dateStr, label });
    }

    const cells = {};
    shifts.forEach((s) => { cells[s] = {}; });

    // 初始化每个单元格
    for (const shiftKey of shifts) {
      for (const d of days) {
        cells[shiftKey][d.date] = {
          patients: [],
          nurses: [],
          ratio: '—',
          compliant: true,
        };
      }
    }

    // 填充患者
    scheduleRows.forEach((row) => {
      const shiftKey = toShiftKey(row.shift);
      if (!cells[shiftKey] || !cells[shiftKey][row.scheduled_date]) return;
      cells[shiftKey][row.scheduled_date].patients.push({
        patientId: row.patient_id,
        name: row.patient_name,
        isolationZone: row.isolation_zone,
        machineNo: row.machine_no,
        isTemp: !!row.is_temp,
        status: row.status || 'planned',
      });
    });

    // 填充护士
    nurseRows.forEach((row) => {
      const shiftKey = toShiftKey(row.shift);
      if (!cells[shiftKey] || !cells[shiftKey][row.duty_date]) return;
      cells[shiftKey][row.duty_date].nurses.push({
        nurseId: row.nurse_id,
        name: row.nurse_name,
      });
    });

    // 护患比
    ratioRows.forEach((row) => {
      const shiftKey = toShiftKey(row.shift);
      const cell = cells[shiftKey] && cells[shiftKey][row.duty_date];
      if (!cell) return;
      if (!row.nurse_count || row.nurse_count === 0) {
        cell.ratio = '—';
        cell.compliant = false;
      } else {
        const ratioNum = Number(row.ratio_value || 0);
        const rounded = ratioNum.toFixed(1);
        cell.ratio = `1:${rounded}`;
        cell.compliant = !!row.compliant;
      }
    });

    return success(res, { shifts, days, cells });
  } catch (err) { next(err); }
});

// GET /api/schedule/today - 今日上机患者快速列表（复用 schedules）
router.get('/today', auth, async (req, res, next) => {
  try {
    const today = new Date().toISOString().slice(0, 10);

    const { rows } = await pool.query(
      `SELECT s.*, p.name as patient_name, p.isolation_zone,
              va.access_type, va.location as access_location,
              m.machine_no
       FROM schedules s
       JOIN patients p ON s.patient_id = p.id
       LEFT JOIN vascular_accesses va ON va.patient_id = p.id AND va.is_current = true
       LEFT JOIN machines m ON s.machine_id = m.id
       WHERE s.scheduled_date = $1
         AND p.status = 'active'
       ORDER BY s.shift, m.machine_no`,
      [today]
    );
    return success(res, rows);
  } catch (err) { next(err); }
});

// GET /api/schedule/:patientId - 某患者的排班规则与实例
router.get('/:patientId', auth, async (req, res, next) => {
  try {
    const patientId = req.params.patientId;

    const { rows: rules } = await pool.query(
      `SELECT *
       FROM patient_schedule_rules
       WHERE patient_id = $1
       ORDER BY start_date DESC`,
      [patientId]
    );

    const { rows: instances } = await pool.query(
      `SELECT s.*, m.machine_no
       FROM schedules s
       LEFT JOIN machines m ON s.machine_id = m.id
       WHERE s.patient_id = $1
       ORDER BY s.scheduled_date DESC, s.shift`,
      [patientId]
    );

    return success(res, { rules, instances });
  } catch (err) { next(err); }
});

// POST /api/schedule/rules - 新建患者长期排班规则（护士长权限）
router.post('/rules', auth, rbac(['admin', 'head_nurse']), async (req, res, next) => {
  try {
    const {
      patient_id,
      pattern_type,
      week_type,
      days,
      shift,
      start_date,
      end_date,
      preferred_machine_id,
      notes,
    } = req.body;

    if (!patient_id || !pattern_type || !Array.isArray(days) || !days.length || !shift || !start_date) {
      return error(res, 'patient_id、pattern_type、days、shift、start_date 为必填项');
    }

    const { rows } = await pool.query(
      `INSERT INTO patient_schedule_rules (
         patient_id, pattern_type, week_type, days, shift,
         start_date, end_date, preferred_machine_id, is_active, notes
       ) VALUES ($1,$2,COALESCE($3,'both'),$4,$5,$6,$7,$8,true,$9)
       RETURNING *`,
      [
        patient_id,
        pattern_type,
        week_type || 'both',
        days,
        SHIFT_MAP[shift] || shift,
        start_date,
        end_date || null,
        preferred_machine_id || null,
        notes || null,
      ]
    );

    return created(res, rows[0], '排班规则已创建');
  } catch (err) { next(err); }
});

// POST /api/schedule/nurse-adjust - 调整某天某班次护士排班
router.post('/nurse-adjust', auth, rbac(['admin', 'head_nurse']), async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { date, shift, nurseIds } = req.body;
    const shiftDb = SHIFT_MAP[shift] || shift;

    if (!date || !shiftDb) {
      await client.query('ROLLBACK');
      return error(res, 'date 与 shift 为必填项');
    }

    await client.query(
      `DELETE FROM nurse_schedule WHERE duty_date = $1 AND shift = $2`,
      [date, shiftDb]
    );

    if (Array.isArray(nurseIds) && nurseIds.length > 0) {
      for (const nurseId of nurseIds) {
        await client.query(
          `INSERT INTO nurse_schedule (nurse_id, duty_date, shift)
           VALUES ($1,$2,$3)
           ON CONFLICT (nurse_id, duty_date, shift, zone)
           DO NOTHING`,
          [nurseId, date, shiftDb]
        );
      }
    }

    await client.query('COMMIT');
    return success(res, null, '护士排班已更新');
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
