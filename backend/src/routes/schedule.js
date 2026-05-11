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
const { success, created, error, notFound } = require('../utils/response');
const { expandDialysisScheduleCode } = require('../services/DialysisScheduleExpansionService');
const { formatDate, parseBusinessDate } = require('../utils/dateUtils');
const {
  isValidUuid,
  validateOptionalStartDate,
  validateCreateSlotPayload,
  validateScheduleSlotId,
  validateNurseSheetWeekStart,
  validateNurseSheetWeekStartBody,
  validateSchedulePatientId,
  validateScheduleRulePayload,
  validateNurseAdjustPayload,
} = require('../validators/scheduleValidators');

const NURSE_SHEET_ROW_COUNT = 14;

/** 白班「分区」备注：与 rows 并列存于 payload */
function normalizeNurseSheetWhiteZone(input) {
  if (typeof input !== 'string') return '';
  const t = input.trim();
  if (t === '—' || t === '－' || t === '-') return '';
  return t.slice(0, 80);
}

/** 护士排班空白表 JSON 行：白班 3 + A区 8 + B区 2 + 本周二线 1（白班分区格为只读合并格，不存 rows） */
function normalizeNurseSheetRows(input) {
  const emptyDays = () => ['', '', '', '', '', '', ''];
  const emptyRow = () => ({ name: '', days: emptyDays(), owe: '' });
  if (!Array.isArray(input)) {
    return Array.from({ length: NURSE_SHEET_ROW_COUNT }, emptyRow);
  }
  const out = [];
  for (let i = 0; i < NURSE_SHEET_ROW_COUNT; i += 1) {
    const r = input[i];
    if (!r || typeof r !== 'object') {
      out.push(emptyRow());
      continue;
    }
    const name = typeof r.name === 'string' ? r.name : '';
    const owe = typeof r.owe === 'string' ? r.owe : '';
    let days = Array.isArray(r.days) ? r.days.map((x) => (typeof x === 'string' ? x : '')) : emptyDays();
    while (days.length < 7) days.push('');
    days = days.slice(0, 7);
    out.push({ name, days, owe });
  }
  return out;
}

/**
 * 患者隔离分区 → 透析机分区（仅 machines.zone 三种）
 * @param {string | null} isolationZone
 * @returns {'normal'|'hbv'|'hcv'}
 */
function mapIsolationToMachineZone(isolationZone) {
  if (isolationZone === 'hbv') return 'hbv';
  if (isolationZone === 'hcv') return 'hcv';
  return 'normal';
}

/**
 * 拉取待生成排班的患者；若未执行迁移 042（无 dialysis_schedule_anchor_date 列）则降级查询，qod 锚点视为空。
 */
async function fetchPatientsForGenerateWeek() {
  const sqlWithAnchor = `
    SELECT id, dialysis_schedule_code, dialysis_schedule_notes, dialysis_schedule_anchor_date, isolation_zone, machine_station
    FROM patients
    WHERE status = 'active'
      AND dialysis_schedule_code IS NOT NULL
      AND dialysis_schedule_code <> 'other'
  `;
  try {
    const { rows } = await pool.query(sqlWithAnchor);
    return rows;
  } catch (err) {
    if (err && err.code === '42703') {
      const errMsg = String(err.message || '');
      if (errMsg.includes('machine_station')) {
        try {
          const { rows } = await pool.query(
            `SELECT id, dialysis_schedule_code, dialysis_schedule_notes, dialysis_schedule_anchor_date, isolation_zone
             FROM patients
             WHERE status = 'active'
               AND dialysis_schedule_code IS NOT NULL
               AND dialysis_schedule_code <> 'other'`,
          );
          return rows.map((r) => ({ ...r, machine_station: null }));
        } catch (err2) {
          if (err2 && err2.code === '42703') {
            const { rows } = await pool.query(
              `SELECT id, dialysis_schedule_code, dialysis_schedule_notes, isolation_zone
               FROM patients
               WHERE status = 'active'
                 AND dialysis_schedule_code IS NOT NULL
                 AND dialysis_schedule_code <> 'other'`,
            );
            return rows.map((r) => ({ ...r, dialysis_schedule_anchor_date: null, machine_station: null }));
          }
          throw err2;
        }
      }
      const { rows } = await pool.query(
        `SELECT id, dialysis_schedule_code, dialysis_schedule_notes, isolation_zone
         FROM patients
         WHERE status = 'active'
           AND dialysis_schedule_code IS NOT NULL
           AND dialysis_schedule_code <> 'other'`,
      );
      return rows.map((r) => ({ ...r, dialysis_schedule_anchor_date: null, machine_station: null }));
    }
    throw err;
  }
}

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
  const d = parseBusinessDate(dateStr);
  if (!d) return '';
  const day = d.getDay() || 7; // 周日=0 → 7
  d.setDate(d.getDate() - (day - 1));
  return formatDate(d);
};

/**
 * 将 node-pg 返回的 DATE（常为 Date 对象）规范为 YYYY-MM-DD，与 cells[shift][date] 的键一致。
 * 若直接用 Date 作对象键会变成 "Wed Apr 06 2026 ..."，导致周视图永远匹配不到格子。
 */
function toSqlDateKey(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'string') {
    return value.length >= 10 ? value.slice(0, 10) : value;
  }
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(value);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

/** 服务端本地日历日（与排班 scheduled_date 同日比较，用于「仅上机当日同步处方」） */
function todayKeyLocal() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

function isScheduleRowDateToday(scheduledDate) {
  const k = toSqlDateKey(scheduledDate);
  if (!k) return false;
  return k === todayKeyLocal();
}

/** PostgreSQL: undefined_column — 未执行迁移时列不存在，降级查询避免 500 */
const PG_UNDEFINED_COLUMN = '42703';

const WEEK_PATIENT_SLOTS_BASE = `
       FROM schedules s
       JOIN patients p ON s.patient_id = p.id
       LEFT JOIN machines m ON s.machine_id = m.id
       WHERE s.scheduled_date BETWEEN $1 AND $2`;

/**
 * @param {unknown} raw
 * @returns {{ ok: boolean, value: (string | null | undefined), error?: string }}
 */
function normalizeSessionDialysisMode(raw) {
  if (raw === undefined) return { ok: true, value: undefined };
  if (raw === null || raw === '') return { ok: true, value: null };
  const s = String(raw).trim().toUpperCase().replace(/\+/g, '_');
  if (s === 'HD_HP') return { ok: true, value: 'HD_HP' };
  if (s === 'HDF') return { ok: true, value: 'HDF' };
  if (s === 'HD') return { ok: true, value: 'HD' };
  return { ok: false, value: null, error: 'session_dialysis_mode 须为 HD、HDF、HD_HP 或空' };
}

/**
 * 将本条排班的透析模式与备注同步到患者当前透析处方（迁移 045：hemodialysis_modality / hemodialysis_remark）
 * @returns {Promise<{ rows: number, columnsMissing: boolean }>} rows=受影响处方行数；columnsMissing=处方表缺列未执行迁移
 */
async function syncHemodialysisFromScheduleToPrescription(patientId, sessionMode, scheduleRemarkText) {
  const mod = sessionMode && ['HD', 'HDF', 'HD_HP'].includes(sessionMode) ? sessionMode : 'HD';
  let remark = null;
  if (scheduleRemarkText !== undefined && scheduleRemarkText !== null) {
    const t = String(scheduleRemarkText).trim();
    remark = t || null;
  }
  try {
    const r = await pool.query(
      `UPDATE prescriptions SET
         hemodialysis_modality = $1,
         hemodialysis_remark = $2,
         updated_at = NOW()
       WHERE patient_id = $3::uuid AND is_current = true`,
      [mod, remark, patientId],
    );
    return { rows: r.rowCount || 0, columnsMissing: false };
  } catch (err) {
    if (!err || err.code !== PG_UNDEFINED_COLUMN) throw err;
    try {
      const r = await pool.query(
        `UPDATE prescriptions SET
           hemodialysis_modality = $1,
           hemodialysis_remark = $2
         WHERE patient_id = $3::uuid AND is_current = true`,
        [mod, remark, patientId],
      );
      return { rows: r.rowCount || 0, columnsMissing: false };
    } catch (err2) {
      if (err2 && err2.code === PG_UNDEFINED_COLUMN) {
        return { rows: 0, columnsMissing: true };
      }
      throw err2;
    }
  }
}

/**
 * 排班保存后，组合给前端的说明（迁移 / 无当前处方 / 非上机日不同步处方）
 * @param {{ skippedNotToday?: boolean }} options
 */
function buildHemodialysisSyncMessage(syncResult, noScheduleCols, options = {}) {
  const { skippedNotToday } = options;
  if (skippedNotToday) {
    const parts = [
      '非上机当日：透析模式仅保存在本条排班中；仅在该排班「日期＝当日」时写入透析处方（请上机日在处方管理确认并保存处方）',
    ];
    if (noScheduleCols) {
      parts.push('排班表未持久化透析模式/备注（未执行迁移 043、044）');
    }
    return parts.join('；');
  }
  const parts = [];
  if (syncResult.columnsMissing) {
    parts.push('处方表缺少透析模式字段（未执行迁移 045），未写入处方');
  } else if (syncResult.rows === 0) {
    parts.push('该患者暂无当前有效透析处方，处方中的透析模式未更新（请先在「透析处方管理」保存一条处方）');
  } else {
    parts.push('透析模式已写入当前透析处方（上机当日同步）');
  }
  if (noScheduleCols) {
    parts.push('排班表未持久化透析模式/备注（未执行迁移 043、044），界面刷新后仍可能显示默认 HD');
  }
  return parts.join('；');
}

/**
 * 本周排班患者行：含 schedule_remark、patient_dialysis_mode、session_dialysis_mode；缺列时降级
 */
async function queryWeekPatientScheduleRows(weekStart, weekEnd) {
  const variants = [
    `SELECT s.id AS schedule_id,
              s.scheduled_date,
              s.shift,
              s.patient_id,
              s.machine_id,
              s.is_temp,
              s.status,
              s.schedule_remark,
              p.name AS patient_name,
              p.isolation_zone,
              p.dialysis_mode AS patient_dialysis_mode,
              s.session_dialysis_mode,
              m.id AS machine_uuid,
              m.machine_no,
              COALESCE(s.machine_station, p.machine_station) AS machine_station
     ${WEEK_PATIENT_SLOTS_BASE}`,
    `SELECT s.id AS schedule_id,
              s.scheduled_date,
              s.shift,
              s.patient_id,
              s.machine_id,
              s.is_temp,
              s.status,
              s.schedule_remark,
              p.name AS patient_name,
              p.isolation_zone,
              p.dialysis_mode AS patient_dialysis_mode,
              NULL::text AS session_dialysis_mode,
              m.id AS machine_uuid,
              m.machine_no,
              COALESCE(s.machine_station, p.machine_station) AS machine_station
     ${WEEK_PATIENT_SLOTS_BASE}`,
    `SELECT s.id AS schedule_id,
              s.scheduled_date,
              s.shift,
              s.patient_id,
              s.machine_id,
              s.is_temp,
              s.status,
              NULL::text AS schedule_remark,
              p.name AS patient_name,
              p.isolation_zone,
              p.dialysis_mode AS patient_dialysis_mode,
              s.session_dialysis_mode,
              m.id AS machine_uuid,
              m.machine_no,
              COALESCE(s.machine_station, p.machine_station) AS machine_station
     ${WEEK_PATIENT_SLOTS_BASE}`,
    `SELECT s.id AS schedule_id,
              s.scheduled_date,
              s.shift,
              s.patient_id,
              s.machine_id,
              s.is_temp,
              s.status,
              NULL::text AS schedule_remark,
              p.name AS patient_name,
              p.isolation_zone,
              p.dialysis_mode AS patient_dialysis_mode,
              NULL::text AS session_dialysis_mode,
              m.id AS machine_uuid,
              m.machine_no,
              COALESCE(s.machine_station, p.machine_station) AS machine_station
     ${WEEK_PATIENT_SLOTS_BASE}`,
    `SELECT s.id AS schedule_id,
              s.scheduled_date,
              s.shift,
              s.patient_id,
              s.machine_id,
              s.is_temp,
              s.status,
              NULL::text AS schedule_remark,
              p.name AS patient_name,
              p.isolation_zone,
              NULL::text AS patient_dialysis_mode,
              s.session_dialysis_mode,
              m.id AS machine_uuid,
              m.machine_no,
              COALESCE(s.machine_station, p.machine_station) AS machine_station
     ${WEEK_PATIENT_SLOTS_BASE}`,
    `SELECT s.id AS schedule_id,
              s.scheduled_date,
              s.shift,
              s.patient_id,
              s.machine_id,
              s.is_temp,
              s.status,
              NULL::text AS schedule_remark,
              p.name AS patient_name,
              p.isolation_zone,
              NULL::text AS patient_dialysis_mode,
              NULL::text AS session_dialysis_mode,
              m.id AS machine_uuid,
              m.machine_no,
              COALESCE(s.machine_station, p.machine_station) AS machine_station
     ${WEEK_PATIENT_SLOTS_BASE}`,
    // 未执行 053 迁移时：无 machine_station 列则降级为 NULL
    `SELECT s.id AS schedule_id,
              s.scheduled_date,
              s.shift,
              s.patient_id,
              s.machine_id,
              s.is_temp,
              s.status,
              s.schedule_remark,
              p.name AS patient_name,
              p.isolation_zone,
              p.dialysis_mode AS patient_dialysis_mode,
              s.session_dialysis_mode,
              m.id AS machine_uuid,
              m.machine_no,
              NULL::text AS machine_station
     ${WEEK_PATIENT_SLOTS_BASE}`,
    `SELECT s.id AS schedule_id,
              s.scheduled_date,
              s.shift,
              s.patient_id,
              s.machine_id,
              s.is_temp,
              s.status,
              s.schedule_remark,
              p.name AS patient_name,
              p.isolation_zone,
              p.dialysis_mode AS patient_dialysis_mode,
              NULL::text AS session_dialysis_mode,
              m.id AS machine_uuid,
              m.machine_no,
              NULL::text AS machine_station
     ${WEEK_PATIENT_SLOTS_BASE}`,
    `SELECT s.id AS schedule_id,
              s.scheduled_date,
              s.shift,
              s.patient_id,
              s.machine_id,
              s.is_temp,
              s.status,
              NULL::text AS schedule_remark,
              p.name AS patient_name,
              p.isolation_zone,
              p.dialysis_mode AS patient_dialysis_mode,
              s.session_dialysis_mode,
              m.id AS machine_uuid,
              m.machine_no,
              NULL::text AS machine_station
     ${WEEK_PATIENT_SLOTS_BASE}`,
    `SELECT s.id AS schedule_id,
              s.scheduled_date,
              s.shift,
              s.patient_id,
              s.machine_id,
              s.is_temp,
              s.status,
              NULL::text AS schedule_remark,
              p.name AS patient_name,
              p.isolation_zone,
              p.dialysis_mode AS patient_dialysis_mode,
              NULL::text AS session_dialysis_mode,
              m.id AS machine_uuid,
              m.machine_no,
              NULL::text AS machine_station
     ${WEEK_PATIENT_SLOTS_BASE}`,
    `SELECT s.id AS schedule_id,
              s.scheduled_date,
              s.shift,
              s.patient_id,
              s.machine_id,
              s.is_temp,
              s.status,
              NULL::text AS schedule_remark,
              p.name AS patient_name,
              p.isolation_zone,
              NULL::text AS patient_dialysis_mode,
              s.session_dialysis_mode,
              m.id AS machine_uuid,
              m.machine_no,
              NULL::text AS machine_station
     ${WEEK_PATIENT_SLOTS_BASE}`,
    `SELECT s.id AS schedule_id,
              s.scheduled_date,
              s.shift,
              s.patient_id,
              s.machine_id,
              s.is_temp,
              s.status,
              NULL::text AS schedule_remark,
              p.name AS patient_name,
              p.isolation_zone,
              NULL::text AS patient_dialysis_mode,
              NULL::text AS session_dialysis_mode,
              m.id AS machine_uuid,
              m.machine_no,
              NULL::text AS machine_station
     ${WEEK_PATIENT_SLOTS_BASE}`,
  ];

  let lastErr;
  for (const sql of variants) {
    try {
      const { rows } = await pool.query(sql, [weekStart, weekEnd]);
      return rows;
    } catch (err) {
      lastErr = err;
      if (err && err.code === PG_UNDEFINED_COLUMN) {
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

// GET /api/schedule/week?start_date=2026-04-06 - 获取当周排班（周视图）
router.get('/week', auth, async (req, res, next) => {
  try {
    const { start_date: queryStart } = req.query;
    const startValid = validateOptionalStartDate(queryStart);
    if (!startValid.ok) return error(res, startValid.message, 400);
    const todayStr = formatDate(new Date());
    const weekStart = getWeekStart(startValid.value || todayStr);
    const start = parseBusinessDate(weekStart);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const weekEnd = formatDate(end);

    const scheduleRows = await queryWeekPatientScheduleRows(weekStart, weekEnd);

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
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      const dateStr = formatDate(d);
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
      const dateKey = toSqlDateKey(row.scheduled_date);
      if (!dateKey || !cells[shiftKey] || !cells[shiftKey][dateKey]) return;
      const patientMode = row.patient_dialysis_mode || null;
      /** 档案：腹透 PD / 血透 HD（与处方血透方式 HD·HDF·HD+HP 不同概念） */
      const patientRenalCategory = patientMode === 'PD' ? 'PD' : 'HD';
      const sessionMode = row.session_dialysis_mode || null;
      /** 本条血透方式：未选时默认 HD（不沿用档案中的 HD/HDF 等） */
      const effectiveHemo = sessionMode || 'HD';
      cells[shiftKey][dateKey].patients.push({
        scheduleId: row.schedule_id,
        patientId: row.patient_id,
        name: row.patient_name,
        isolationZone: row.isolation_zone,
        machineId: row.machine_uuid,
        machineNo: row.machine_no,
        machineStation: row.machine_station || null,
        isTemp: !!row.is_temp,
        status: row.status || 'planned',
        patientRenalCategory,
        sessionDialysisMode: sessionMode,
        dialysisMode: effectiveHemo,
        scheduleRemark: row.schedule_remark || null,
      });
    });

    // 填充护士
    nurseRows.forEach((row) => {
      const shiftKey = toShiftKey(row.shift);
      const dateKey = toSqlDateKey(row.duty_date);
      if (!dateKey || !cells[shiftKey] || !cells[shiftKey][dateKey]) return;
      cells[shiftKey][dateKey].nurses.push({
        nurseId: row.nurse_id,
        name: row.nurse_name,
      });
    });

    // 护患比
    ratioRows.forEach((row) => {
      const shiftKey = toShiftKey(row.shift);
      const dateKey = toSqlDateKey(row.duty_date);
      const cell = dateKey && cells[shiftKey] && cells[shiftKey][dateKey];
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

// POST /api/schedule/generate-week — 按患者档案 dialysis_schedule_code 生成本周实例（不覆盖已有排班）
router.post('/generate-week', auth, rbac(['admin', 'head_nurse']), async (req, res, next) => {
  try {
    const { start_date: bodyStart } = req.body || {};
    const startValid = validateOptionalStartDate(bodyStart);
    if (!startValid.ok) return error(res, startValid.message, 400);
    const todayStr = formatDate(new Date());
    const weekStart = getWeekStart(startValid.value || todayStr);
    const start = parseBusinessDate(weekStart);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const weekEnd = formatDate(end);

    const patientRows = await fetchPatientsForGenerateWeek();

    let inserted = 0;
    let skipped = 0;
    let skippedNoAnchorQod = 0;
    let expandedSlotCount = 0;
    let blockedNoMachine = 0;
    const warnings = [];

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const p of patientRows) {
        const code = p.dialysis_schedule_code;
        if (code === 'qod' && !p.dialysis_schedule_anchor_date) {
          skippedNoAnchorQod += 1;
          continue;
        }

        const slots = expandDialysisScheduleCode(
          code,
          p.dialysis_schedule_anchor_date,
          weekStart,
          p.dialysis_schedule_notes,
        );

        expandedSlotCount += slots.length;

        const zone = mapIsolationToMachineZone(p.isolation_zone);

        for (const slot of slots) {
          const { rows: dup } = await client.query(
            `SELECT id FROM schedules
             WHERE patient_id = $1 AND scheduled_date = $2::date AND shift = $3`,
            [p.id, slot.scheduledDate, slot.shift],
          );
          if (dup.length > 0) {
            skipped += 1;
            continue;
          }

          const { rows: free } = await client.query(
            `SELECT m.id
             FROM machines m
             WHERE m.status = 'active' AND m.zone = $1
               AND NOT EXISTS (
                 SELECT 1 FROM schedules s
                 WHERE s.machine_id = m.id
                   AND s.scheduled_date = $2::date
                   AND s.shift = $3
               )
             ORDER BY m.machine_no
             LIMIT 1`,
            [zone, slot.scheduledDate, slot.shift],
          );

          if (free.length === 0) {
            blockedNoMachine += 1;
            warnings.push(`${slot.scheduledDate} ${slot.shift} 档：${zone} 区无可用机位`);
            continue;
          }

          const creatorId = req.user && req.user.id ? req.user.id : null;
          const stationLabel =
            p.machine_station != null && String(p.machine_station).trim()
              ? String(p.machine_station).trim().slice(0, 80)
              : null;
          try {
            await client.query(
              `INSERT INTO schedules (
                 patient_id, machine_id, scheduled_date, shift, status, is_temp, created_by, machine_station
               ) VALUES ($1, $2, $3::date, $4, 'planned', false, $5, $6)`,
              [p.id, free[0].id, slot.scheduledDate, slot.shift, creatorId, stationLabel],
            );
          } catch (insErr) {
            if (insErr && insErr.code === PG_UNDEFINED_COLUMN) {
              await client.query(
                `INSERT INTO schedules (
                   patient_id, machine_id, scheduled_date, shift, status, is_temp, created_by
                 ) VALUES ($1, $2, $3::date, $4, 'planned', false, $5)`,
                [p.id, free[0].id, slot.scheduledDate, slot.shift, creatorId],
              );
            } else {
              throw insErr;
            }
          }
          inserted += 1;
        }
      }

      await client.query('COMMIT');
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {
        /* 忽略 ROLLBACK 失败，避免掩盖原始错误 */
      }
      throw e;
    } finally {
      client.release();
    }

    if (skippedNoAnchorQod > 0) {
      warnings.unshift(`有 ${skippedNoAnchorQod} 名隔日透析患者未设置锚点日期，已跳过`);
    }

    /** 未写入任何排班时的可读原因（便于前端提示，不等同于错误） */
    const hints = [];
    if (inserted === 0) {
      if (patientRows.length === 0) {
        hints.push(
          '没有在透且已选择可自动展开透析时间的患者：请为患者档案设置「透析时间」（预设、隔日或自定方案），并确保状态为在透。',
        );
      }
      if (expandedSlotCount === 0) {
        if (skippedNoAnchorQod > 0 && skippedNoAnchorQod === patientRows.length) {
          hints.push('候选患者均为「隔日一次」但未填写锚点日期，系统无法展开本周应透析日。');
        } else if (patientRows.length > skippedNoAnchorQod) {
          hints.push(
            '透析频次展开后本周为 0 个时段：请核对档案中的「透析时间」编码是否与系统选项一致（勿填「其他」或错误代码）。',
          );
        }
      }
      if (expandedSlotCount > 0 && skipped === expandedSlotCount && blockedNoMachine === 0) {
        hints.push('本周应生成的时段均与已有排班重复（同一患者同日同班次已存在），故未新增。');
      }
      if (blockedNoMachine > 0) {
        hints.push(
          `有 ${blockedNoMachine} 个时段因对应隔离区无空闲透析机位未能落位，请检查「透析机」是否已维护且分区正确。`,
        );
      }
      if (hints.length === 0 && expandedSlotCount > 0) {
        hints.push('未新增条目，请结合上方「警告」列表与重复/机位计数排查。');
      }
    }

    const note =
      '两周五次(biw5_alt)按 ISO 周序号奇偶周：奇周周一/四/六，偶周周二/五；时段默认上午。隔日(qod)时段默认上午。';

    return success(
      res,
      {
        weekStart,
        weekEnd,
        inserted,
        skipped,
        candidatePatients: patientRows.length,
        expandedSlots: expandedSlotCount,
        skippedQodNoAnchor: skippedNoAnchorQod,
        blockedNoMachine,
        warnings,
        hints,
        note,
      },
      inserted > 0 ? '周排班已生成' : '本周未新增排班（详见返回说明）',
    );
  } catch (err) { next(err); }
});

// POST /api/schedule/slots — 手动新增单条患者排班
router.post('/slots', auth, rbac(['admin', 'head_nurse']), async (req, res, next) => {
  try {
    const payloadValid = validateCreateSlotPayload(req.body);
    if (!payloadValid.ok) return error(res, payloadValid.message, payloadValid.statusCode || 400);
    const {
      patient_id,
      scheduled_date,
      shift,
      machine_id,
      schedule_remark,
      session_dialysis_mode,
      is_temp,
    } = payloadValid.value;
    const shiftDb = SHIFT_MAP[shift] || shift;
    if (!shiftDb) return error(res, 'patient_id、scheduled_date、shift、machine_id 为必填项');
    const isTemp = is_temp === true || is_temp === 1 || is_temp === 'true';

    const { rows: pRows } = await pool.query(
      'SELECT id, isolation_zone FROM patients WHERE id = $1 AND status = $2',
      [patient_id, 'active'],
    );
    if (pRows.length === 0) return notFound(res, '患者不存在或已非在透');

    const { rows: mRows } = await pool.query(
      'SELECT id, zone FROM machines WHERE id = $1 AND status = $2',
      [machine_id, 'active'],
    );
    if (mRows.length === 0) return error(res, '透析机不存在或已停用', 400);

    const needZone = mapIsolationToMachineZone(pRows[0].isolation_zone);
    if (mRows[0].zone !== needZone) {
      return error(res, '机位隔离区与患者分区不匹配', 400);
    }

    const { rows: clash } = await pool.query(
      `SELECT id FROM schedules WHERE patient_id = $1 AND scheduled_date = $2::date AND shift = $3`,
      [patient_id, scheduled_date, shiftDb],
    );
    if (clash.length > 0) return error(res, '该患者在该日期班次已有排班', 409);

    const { rows: taken } = await pool.query(
      `SELECT id FROM schedules WHERE machine_id = $1 AND scheduled_date = $2::date AND shift = $3`,
      [machine_id, scheduled_date, shiftDb],
    );
    if (taken.length > 0) return error(res, '该机位在该日期班次已被占用', 409);

    const remarkVal =
      schedule_remark !== undefined && schedule_remark !== null && String(schedule_remark).trim()
        ? String(schedule_remark).trim()
        : null;

    const sessionNorm = Object.prototype.hasOwnProperty.call(req.body || {}, 'session_dialysis_mode')
      ? normalizeSessionDialysisMode(session_dialysis_mode)
      : { ok: true, value: undefined };
    if (!sessionNorm.ok) return error(res, sessionNorm.error || '参数无效', 400);
    const sessionVal = sessionNorm.value === undefined ? null : sessionNorm.value;

    let insRows;
    let remarkDropped = false;
    let sessionDropped = false;
    try {
      const { rows } = await pool.query(
        `INSERT INTO schedules (
           patient_id, machine_id, scheduled_date, shift, status, is_temp, created_by, schedule_remark, session_dialysis_mode
         ) VALUES ($1, $2, $3::date, $4, 'planned', $5, $6, $7, $8)
         RETURNING *`,
        [patient_id, machine_id, scheduled_date, shiftDb, isTemp, req.user.id, remarkVal, sessionVal],
      );
      insRows = rows;
    } catch (err) {
      if (err && err.code === PG_UNDEFINED_COLUMN) {
        try {
          const { rows } = await pool.query(
            `INSERT INTO schedules (
               patient_id, machine_id, scheduled_date, shift, status, is_temp, created_by, schedule_remark
             ) VALUES ($1, $2, $3::date, $4, 'planned', $5, $6, $7)
             RETURNING *`,
            [patient_id, machine_id, scheduled_date, shiftDb, isTemp, req.user.id, remarkVal],
          );
          insRows = rows;
          sessionDropped = sessionVal != null;
        } catch (err2) {
          if (err2 && err2.code === PG_UNDEFINED_COLUMN) {
            const { rows } = await pool.query(
              `INSERT INTO schedules (
                 patient_id, machine_id, scheduled_date, shift, status, is_temp, created_by
               ) VALUES ($1, $2, $3::date, $4, 'planned', $5, $6)
               RETURNING *`,
              [patient_id, machine_id, scheduled_date, shiftDb, isTemp, req.user.id],
            );
            insRows = rows;
            remarkDropped = !!remarkVal;
            sessionDropped = sessionVal != null;
          } else {
            throw err2;
          }
        }
      } else {
        throw err;
      }
    }

    try {
      const { rows: stRows } = await pool.query(
        'SELECT machine_station FROM patients WHERE id = $1',
        [patient_id],
      );
      const stVal =
        stRows[0]?.machine_station != null && String(stRows[0].machine_station).trim()
          ? String(stRows[0].machine_station).trim().slice(0, 80)
          : null;
      await pool.query(
        `UPDATE schedules SET machine_station = $1 WHERE id = $2`,
        [stVal, insRows[0].id],
      );
    } catch {
      /* 未迁移 053 或列不存在：不阻断排班创建 */
    }

    let msg = isTemp ? '临时加透排班已创建' : '排班已创建';
    if (remarkDropped) msg = '排班已创建（数据库暂无 schedule_remark 列，备注未保存；请执行迁移 043）';
    if (sessionDropped) msg = `${msg}（本条透析模式未保存；请执行迁移 044）`;

    const modalityForRx = sessionVal || 'HD';
    const postDateKey = String(scheduled_date).slice(0, 10);
    let syncResult = { rows: 0, columnsMissing: false };
    let skippedNotToday = false;
    if (isScheduleRowDateToday(postDateKey)) {
      try {
        syncResult = await syncHemodialysisFromScheduleToPrescription(patient_id, modalityForRx, remarkVal);
      } catch (syncErr) {
        /* 非预期错误不阻断排班创建 */
      }
    } else {
      skippedNotToday = true;
    }
    const noSchedulePersist = remarkDropped || sessionDropped;
    const syncHint = buildHemodialysisSyncMessage(syncResult, noSchedulePersist, { skippedNotToday });
    msg = `${msg} ${syncHint}`;

    return created(res, insRows[0], msg.trim());
  } catch (err) { next(err); }
});

// PATCH /api/schedule/slots/:id — 调整日期/班次/机位/状态
router.patch('/slots/:id', auth, rbac(['admin', 'head_nurse']), async (req, res, next) => {
  try {
    const { id } = req.params;
    const idValid = validateScheduleSlotId(id);
    if (!idValid.ok) return error(res, idValid.message, idValid.statusCode || 400);

    const patchSelectVariants = [
      {
        sql: `SELECT s.id, s.patient_id, s.scheduled_date, s.shift, s.machine_id, s.status, s.schedule_remark, s.session_dialysis_mode, p.isolation_zone
         FROM schedules s
         JOIN patients p ON p.id = s.patient_id
         WHERE s.id = $1`,
        scheduleRemarkCol: true,
        sessionDialysisModeCol: true,
      },
      {
        sql: `SELECT s.id, s.patient_id, s.scheduled_date, s.shift, s.machine_id, s.status, s.schedule_remark, NULL::text AS session_dialysis_mode, p.isolation_zone
         FROM schedules s
         JOIN patients p ON p.id = s.patient_id
         WHERE s.id = $1`,
        scheduleRemarkCol: true,
        sessionDialysisModeCol: false,
      },
      {
        sql: `SELECT s.id, s.patient_id, s.scheduled_date, s.shift, s.machine_id, s.status, NULL::text AS schedule_remark, s.session_dialysis_mode, p.isolation_zone
         FROM schedules s
         JOIN patients p ON p.id = s.patient_id
         WHERE s.id = $1`,
        scheduleRemarkCol: false,
        sessionDialysisModeCol: true,
      },
      {
        sql: `SELECT s.id, s.patient_id, s.scheduled_date, s.shift, s.machine_id, s.status, NULL::text AS schedule_remark, NULL::text AS session_dialysis_mode, p.isolation_zone
         FROM schedules s
         JOIN patients p ON p.id = s.patient_id
         WHERE s.id = $1`,
        scheduleRemarkCol: false,
        sessionDialysisModeCol: false,
      },
    ];

    let cur;
    let scheduleRemarkCol = true;
    let sessionDialysisModeCol = true;
    let lastErr;
    for (const v of patchSelectVariants) {
      try {
        const { rows } = await pool.query(v.sql, [id]);
        cur = rows;
        scheduleRemarkCol = v.scheduleRemarkCol;
        sessionDialysisModeCol = v.sessionDialysisModeCol;
        break;
      } catch (err) {
        lastErr = err;
        if (err && err.code === PG_UNDEFINED_COLUMN) {
          continue;
        }
        throw err;
      }
    }
    if (!cur) throw lastErr;
    if (cur.length === 0) return notFound(res, '排班不存在');

    const row = cur[0];
    const body = req.body || {};
    const { scheduled_date, shift, machine_id, status, schedule_remark, session_dialysis_mode } = body;

    /** 仅改血透方式/备注时不做机位占用校验（避免日期解析偏差导致误报 409） */
    const touchesPlan =
      Object.prototype.hasOwnProperty.call(body, 'scheduled_date')
      || Object.prototype.hasOwnProperty.call(body, 'shift')
      || Object.prototype.hasOwnProperty.call(body, 'machine_id')
      || Object.prototype.hasOwnProperty.call(body, 'status');

    if (!touchesPlan) {
      const hasSessionKey = Object.prototype.hasOwnProperty.call(body, 'session_dialysis_mode');
      const hasRemarkKey = Object.prototype.hasOwnProperty.call(body, 'schedule_remark');
      if (hasSessionKey || hasRemarkKey) {
        let requestedFromBody;
        let nextSessionDialysisMeta = sessionDialysisModeCol ? (row.session_dialysis_mode || null) : null;
        if (hasSessionKey) {
          const sn = normalizeSessionDialysisMode(session_dialysis_mode);
          if (!sn.ok) return error(res, sn.error || '参数无效', 400);
          requestedFromBody = sn.value;
          if (sessionDialysisModeCol && sn.value !== undefined) {
            nextSessionDialysisMeta = sn.value;
          }
        }

        let nextScheduleRemarkMeta;
        if (hasRemarkKey) {
          nextScheduleRemarkMeta =
            schedule_remark === null || schedule_remark === ''
              ? null
              : String(schedule_remark).trim() || null;
        } else {
          nextScheduleRemarkMeta = scheduleRemarkCol ? row.schedule_remark : null;
        }

        let updMeta;
        try {
          if (scheduleRemarkCol && sessionDialysisModeCol) {
            const r = await pool.query(
              `UPDATE schedules SET schedule_remark = $2, session_dialysis_mode = $3, updated_at = NOW()
               WHERE id = $1::uuid RETURNING *`,
              [id, nextScheduleRemarkMeta, nextSessionDialysisMeta],
            );
            updMeta = r.rows;
          } else if (scheduleRemarkCol) {
            const r = await pool.query(
              `UPDATE schedules SET schedule_remark = $2, updated_at = NOW() WHERE id = $1::uuid RETURNING *`,
              [id, nextScheduleRemarkMeta],
            );
            updMeta = r.rows;
          } else if (sessionDialysisModeCol) {
            const r = await pool.query(
              `UPDATE schedules SET session_dialysis_mode = $2, updated_at = NOW() WHERE id = $1::uuid RETURNING *`,
              [id, nextSessionDialysisMeta],
            );
            updMeta = r.rows;
          } else {
            /** 未执行迁移 043/044：无法写排班表，仍同步处方并返回成功 */
            updMeta = [row];
          }
        } catch (err) {
          if (!err || err.code !== PG_UNDEFINED_COLUMN) throw err;
          if (scheduleRemarkCol && sessionDialysisModeCol) {
            const r = await pool.query(
              `UPDATE schedules SET schedule_remark = $2, session_dialysis_mode = $3 WHERE id = $1::uuid RETURNING *`,
              [id, nextScheduleRemarkMeta, nextSessionDialysisMeta],
            );
            updMeta = r.rows;
          } else if (scheduleRemarkCol) {
            const r = await pool.query(
              `UPDATE schedules SET schedule_remark = $2 WHERE id = $1::uuid RETURNING *`,
              [id, nextScheduleRemarkMeta],
            );
            updMeta = r.rows;
          } else if (sessionDialysisModeCol) {
            const r = await pool.query(
              `UPDATE schedules SET session_dialysis_mode = $2 WHERE id = $1::uuid RETURNING *`,
              [id, nextSessionDialysisMeta],
            );
            updMeta = r.rows;
          } else {
            updMeta = [row];
          }
        }

        const modalityForRx = sessionDialysisModeCol
          ? (nextSessionDialysisMeta || 'HD')
          : (requestedFromBody !== undefined && requestedFromBody !== null ? requestedFromBody : 'HD');
        const remarkForRx = hasRemarkKey
          ? nextScheduleRemarkMeta
          : (scheduleRemarkCol ? (row.schedule_remark ?? null) : null);
        let syncResult = { rows: 0, columnsMissing: false };
        let skippedNotToday = false;
        if (isScheduleRowDateToday(row.scheduled_date)) {
          try {
            syncResult = await syncHemodialysisFromScheduleToPrescription(row.patient_id, modalityForRx, remarkForRx);
          } catch (syncErr) {
            /* 非预期错误不阻断排班保存 */
          }
        } else {
          skippedNotToday = true;
        }

        const noScheduleCols = !scheduleRemarkCol && !sessionDialysisModeCol;
        const msg = buildHemodialysisSyncMessage(syncResult, noScheduleCols, { skippedNotToday });
        return success(res, updMeta[0], msg);
      }
    }

    let nextDate = scheduled_date !== undefined && scheduled_date !== null
      ? String(scheduled_date).slice(0, 10)
      : toSqlDateKey(row.scheduled_date);
    const shiftDb = shift !== undefined && shift !== null
      ? (SHIFT_MAP[shift] || shift)
      : row.shift;
    if (!['morning', 'afternoon', 'evening'].includes(shiftDb)) {
      return error(res, '班次无效', 400);
    }
    let nextMachine = machine_id !== undefined && machine_id !== null ? machine_id : row.machine_id;
    if (!isValidUuid(String(nextMachine))) return error(res, '机位ID格式无效', 400);

    const nextStatus = status !== undefined && status !== null ? status : row.status;

    let nextScheduleRemark = scheduleRemarkCol ? row.schedule_remark : null;
    if (scheduleRemarkCol && Object.prototype.hasOwnProperty.call(req.body || {}, 'schedule_remark')) {
      if (schedule_remark === null || schedule_remark === '') {
        nextScheduleRemark = null;
      } else {
        nextScheduleRemark = String(schedule_remark).trim() || null;
      }
    }

    /** 请求体中的血透方式（列不存在时仍用于处方同步，不阻断保存） */
    let requestedSessionFromBody;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'session_dialysis_mode')) {
      const sn = normalizeSessionDialysisMode(session_dialysis_mode);
      if (!sn.ok) return error(res, sn.error || '参数无效', 400);
      requestedSessionFromBody = sn.value;
    }

    let nextSessionDialysis = sessionDialysisModeCol ? (row.session_dialysis_mode || null) : null;
    if (sessionDialysisModeCol && requestedSessionFromBody !== undefined) {
      nextSessionDialysis = requestedSessionFromBody;
    }

    const { rows: mRows } = await pool.query(
      'SELECT id, zone FROM machines WHERE id = $1 AND status = $2',
      [nextMachine, 'active'],
    );
    if (mRows.length === 0) return error(res, '透析机不存在或已停用', 400);
    const needZone = mapIsolationToMachineZone(row.isolation_zone);
    if (mRows[0].zone !== needZone) {
      return error(res, '机位隔离区与患者分区不匹配', 400);
    }

    const { rows: slotTaken } = await pool.query(
      `SELECT id FROM schedules
       WHERE machine_id = $1 AND scheduled_date = $2::date AND shift = $3 AND id <> $4`,
      [nextMachine, nextDate, shiftDb, id],
    );
    if (slotTaken.length > 0) return error(res, '该机位在该日期班次已被占用', 409);

    const { rows: dupePatient } = await pool.query(
      `SELECT id FROM schedules
       WHERE patient_id = $1 AND scheduled_date = $2::date AND shift = $3 AND id <> $4`,
      [row.patient_id, nextDate, shiftDb, id],
    );
    if (dupePatient.length > 0) return error(res, '该患者在该日期班次已有其他排班', 409);

    let upd;
    try {
      if (scheduleRemarkCol && sessionDialysisModeCol) {
        const r = await pool.query(
          `UPDATE schedules SET
             scheduled_date = $2::date,
             shift = $3,
             machine_id = $4,
             status = $5,
             schedule_remark = $6,
             session_dialysis_mode = $7,
             updated_at = NOW()
           WHERE id = $1
           RETURNING *`,
          [id, nextDate, shiftDb, nextMachine, nextStatus, nextScheduleRemark, nextSessionDialysis],
        );
        upd = r.rows;
      } else if (scheduleRemarkCol) {
        const r = await pool.query(
          `UPDATE schedules SET
             scheduled_date = $2::date,
             shift = $3,
             machine_id = $4,
             status = $5,
             schedule_remark = $6,
             updated_at = NOW()
           WHERE id = $1
           RETURNING *`,
          [id, nextDate, shiftDb, nextMachine, nextStatus, nextScheduleRemark],
        );
        upd = r.rows;
      } else {
        const r = await pool.query(
          `UPDATE schedules SET
             scheduled_date = $2::date,
             shift = $3,
             machine_id = $4,
             status = $5,
             updated_at = NOW()
           WHERE id = $1
           RETURNING *`,
          [id, nextDate, shiftDb, nextMachine, nextStatus],
        );
        upd = r.rows;
      }
    } catch (err) {
      if (err && err.code === PG_UNDEFINED_COLUMN && scheduleRemarkCol && sessionDialysisModeCol) {
        const r = await pool.query(
          `UPDATE schedules SET
             scheduled_date = $2::date,
             shift = $3,
             machine_id = $4,
             status = $5,
             schedule_remark = $6,
             updated_at = NOW()
           WHERE id = $1
           RETURNING *`,
          [id, nextDate, shiftDb, nextMachine, nextStatus, nextScheduleRemark],
        );
        upd = r.rows;
      } else {
        throw err;
      }
    }

    const modalityForRx = sessionDialysisModeCol
      ? (nextSessionDialysis || 'HD')
      : (requestedSessionFromBody !== undefined && requestedSessionFromBody !== null
          ? requestedSessionFromBody
          : 'HD');
    const remarkForRx = scheduleRemarkCol ? nextScheduleRemark : (row.schedule_remark ?? null);
    let syncResult = { rows: 0, columnsMissing: false };
    let skippedNotToday = false;
    if (isScheduleRowDateToday(nextDate)) {
      try {
        syncResult = await syncHemodialysisFromScheduleToPrescription(row.patient_id, modalityForRx, remarkForRx);
      } catch (syncErr) {
        /* 非预期错误不阻断排班保存 */
      }
    } else {
      skippedNotToday = true;
    }
    const noScheduleCols = !scheduleRemarkCol && !sessionDialysisModeCol;
    const syncHint = buildHemodialysisSyncMessage(syncResult, noScheduleCols, { skippedNotToday });
    return success(res, upd[0], `排班已更新。${syncHint}`);
  } catch (err) { next(err); }
});

// DELETE /api/schedule/slots/:id — 删除排班实例
router.delete('/slots/:id', auth, rbac(['admin', 'head_nurse']), async (req, res, next) => {
  try {
    const { id } = req.params;
    const idValid = validateScheduleSlotId(id);
    if (!idValid.ok) return error(res, idValid.message, idValid.statusCode || 400);
    const { rowCount } = await pool.query('DELETE FROM schedules WHERE id = $1', [id]);
    if (rowCount === 0) return notFound(res, '排班不存在');
    return success(res, null, '排班已删除');
  } catch (err) { next(err); }
});

// GET /api/schedule/today - 今日上机患者快速列表（复用 schedules）
// 附加：档案性别/诊断、当前处方干体重、当日本中心透析记录（用于工作台「今日透析患者」列）
router.get('/today', auth, async (req, res, next) => {
  try {
    const today = todayKeyLocal();

    const { rows } = await pool.query(
      `SELECT s.*, p.name as patient_name, p.gender, p.dob, p.primary_diagnosis, p.isolation_zone,
              p.profile_dry_weight,
              va.access_type, va.location as access_location,
              m.machine_no,
              pr.dry_weight AS prescription_dry_weight,
              dr_today.id AS dialysis_record_id,
              dr_today.pre_weight AS dialysis_pre_weight,
              dr_today.uf_volume AS dialysis_uf_volume,
              dr_today.uf_pct_of_dry_weight AS dialysis_uf_pct_of_dry_weight,
              dr_today.end_time AS dialysis_end_time,
              dr_today.start_time AS dialysis_start_time,
              dr_today.ktv AS dialysis_ktv
       FROM schedules s
       JOIN patients p ON s.patient_id = p.id
       LEFT JOIN prescriptions pr ON pr.patient_id = p.id AND pr.is_current = true
       LEFT JOIN LATERAL (
         SELECT id, pre_weight, uf_volume, uf_pct_of_dry_weight, end_time, start_time, ktv
         FROM dialysis_records
         WHERE patient_id = p.id AND session_date = $1::date
         ORDER BY created_at DESC NULLS LAST
         LIMIT 1
       ) dr_today ON true
       LEFT JOIN LATERAL (
         SELECT access_type, location
         FROM vascular_accesses va2
         WHERE va2.patient_id = p.id AND COALESCE(va2.is_active, true) = true
         ORDER BY va2.established_date DESC NULLS LAST
         LIMIT 1
       ) va ON true
       LEFT JOIN machines m ON s.machine_id = m.id
       WHERE s.scheduled_date = $1::date
         AND p.status = 'active'
       ORDER BY s.shift, m.machine_no NULLS LAST`,
      [today]
    );
    return success(res, rows);
  } catch (err) { next(err); }
});

// GET /api/schedule/nurse-sheet?week_start=YYYY-MM-DD — 护士长排班空白表（按周）
router.get('/nurse-sheet', auth, async (req, res, next) => {
  try {
    const weekValid = validateNurseSheetWeekStart(req.query.week_start);
    if (!weekValid.ok) return error(res, weekValid.message, weekValid.statusCode || 400);
    const weekStart = weekValid.value;
    const { rows } = await pool.query(
      `SELECT s.week_start_date, s.payload, s.updated_at, u.real_name AS updated_by_name
       FROM nurse_schedule_sheet s
       LEFT JOIN users u ON u.id = s.updated_by
       WHERE s.week_start_date = $1::date`,
      [weekStart],
    );
    if (rows.length === 0) {
      return success(res, {
        week_start_date: weekStart,
        rows: normalizeNurseSheetRows([]),
        white_zone: '',
        updated_at: null,
        updated_by_name: null,
      });
    }
    const row = rows[0];
    const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
    const rawRows = Array.isArray(payload.rows) ? payload.rows : [];
    const whiteZone = normalizeNurseSheetWhiteZone(payload.white_zone);
    return success(res, {
      week_start_date: weekStart,
      rows: normalizeNurseSheetRows(rawRows),
      white_zone: whiteZone,
      updated_at: row.updated_at,
      updated_by_name: row.updated_by_name,
    });
  } catch (err) { next(err); }
});

// PUT /api/schedule/nurse-sheet — 保存护士长排班空白表
router.put('/nurse-sheet', auth, rbac(['admin', 'head_nurse']), async (req, res, next) => {
  try {
    const { week_start_date: weekStart, rows: bodyRows, white_zone: bodyWhiteZone } = req.body || {};
    const weekValid = validateNurseSheetWeekStartBody(weekStart);
    if (!weekValid.ok) return error(res, weekValid.message, weekValid.statusCode || 400);
    const weekStartDate = weekValid.value;
    const normalized = normalizeNurseSheetRows(bodyRows);
    const whiteZone = normalizeNurseSheetWhiteZone(bodyWhiteZone);
    const userId = req.user?.id;
    if (!userId) return error(res, '未认证', 401);

    await pool.query(
      `INSERT INTO nurse_schedule_sheet (week_start_date, payload, updated_by)
       VALUES ($1::date, $2::jsonb, $3)
       ON CONFLICT (week_start_date)
       DO UPDATE SET
         payload = EXCLUDED.payload,
         updated_at = NOW(),
         updated_by = EXCLUDED.updated_by`,
      [weekStartDate, { rows: normalized, white_zone: whiteZone }, userId],
    );

    const { rows: out } = await pool.query(
      `SELECT s.updated_at, u.real_name AS updated_by_name
       FROM nurse_schedule_sheet s
       LEFT JOIN users u ON u.id = s.updated_by
       WHERE s.week_start_date = $1::date`,
      [weekStartDate],
    );
    return success(
      res,
      {
        week_start_date: weekStartDate,
        rows: normalized,
        white_zone: whiteZone,
        updated_at: out[0]?.updated_at ?? null,
        updated_by_name: out[0]?.updated_by_name ?? null,
      },
      '护士排班表已保存',
    );
  } catch (err) { next(err); }
});

// GET /api/schedule/:patientId - 某患者的排班规则与实例
router.get('/:patientId', auth, async (req, res, next) => {
  try {
    const patientId = req.params.patientId;
    const pidValid = validateSchedulePatientId(patientId);
    if (!pidValid.ok) return error(res, pidValid.message, pidValid.statusCode || 400);

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
    const payloadValid = validateScheduleRulePayload(req.body);
    if (!payloadValid.ok) return error(res, payloadValid.message);
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
    } = payloadValid.value;

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

    const payloadValid = validateNurseAdjustPayload(req.body);
    if (!payloadValid.ok) {
      await client.query('ROLLBACK');
      return error(res, payloadValid.message);
    }
    const { date, shift, nurseIds } = payloadValid.value;
    const shiftDb = SHIFT_MAP[shift] || shift;

    if (!shiftDb) {
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
