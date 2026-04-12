/**
 * 透析处方 REST 路由（医生端）
 * 主要作用：维护当前有效透析处方，作为透析录入与医嘱的基础配置来源。
 * 主要功能：处方 CRUD；新开处方时归档旧方；与长期医嘱的关联与联动（依业务实现）。
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const auth = require('../middleware/auth');
const { rbac } = require('../middleware/rbac');
const auditLog = require('../middleware/audit');
const { success, created, error, notFound } = require('../utils/response');
const logger = require('../utils/logger');
const MedicationRuleService = require('../services/MedicationRuleService');
const { formatDate } = require('../utils/dateUtils');

/** PostgreSQL: undefined_column（常见于未执行 migrations/048_prescriptions_hdf_replacement.sql） */
const PG_UNDEFINED_COLUMN = '42703';

/**
 * 将前端 form_extra 规范为可写入 JSONB 的纯 JSON（去除不可序列化值、循环引用等）
 * @param {unknown} raw
 * @returns {object|null}
 */
function serializeFormExtraForDb(raw) {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  try {
    const s = JSON.stringify(raw);
    if (s.length > 512 * 1024) {
      logger.warn('prescriptions form_extra 过大，已忽略扩展字段');
      return null;
    }
    return JSON.parse(s);
  } catch (e) {
    logger.warn(`prescriptions form_extra 序列化失败，已忽略：${e.message}`);
    return null;
  }
}

async function safeRollback(client) {
  try {
    await client.query('ROLLBACK');
  } catch (e) {
    logger.warn(`prescriptions 事务回滚：${e.message}`);
  }
}

/**
 * 若语句引用列尚未迁移（42703），跳过该步，避免处方 INSERT 成功却因同步失败整笔 ROLLBACK
 */
async function clientQueryIgnoreUndefinedColumn(client, contextLabel, text, params) {
  try {
    return await client.query(text, params);
  } catch (err) {
    if (err && err.code === PG_UNDEFINED_COLUMN) {
      logger.warn(`${contextLabel}：已跳过（列不存在）。请补齐 migrations。 ${err.message}`);
      return { rows: [], rowCount: 0 };
    }
    throw err;
  }
}

/** RETURNING 结果转可 JSON 输出，避免 BigInt 等导致 res.json 抛错 */
function prescriptionRowForResponse(row) {
  try {
    return JSON.parse(JSON.stringify(row, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
  } catch {
    return row;
  }
}

/** node-pg 不接受 undefined 作绑定值（会抛错致 500）；JSON 省略字段为 undefined，须转为 null */
function pgParam(v) {
  return v === undefined ? null : v;
}

/** node-pg 对 DATE 可能返回 Date 或 string，统一为 YYYY-MM-DD 供 ::date 绑定（勿用 toISOString 切片，避免 UTC 与服务器本地日历差一天） */
function coercePgDateValue(v) {
  if (v == null) return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s;
}

/** 与排班 session_dialysis_mode 一致；其他说明文本原样入库（TEXT） */
function normalizeHemodialysisModalityForInsert(raw) {
  if (raw === undefined || raw === null) return 'HD';
  const s = String(raw).trim();
  if (!s) return 'HD';
  const u = s.toUpperCase().replace(/\+/g, '_');
  if (u === 'HDF') return 'HDF';
  if (u === 'HD_HP' || u === 'HDHP') return 'HD_HP';
  if (u === 'HD') return 'HD';
  return s.length > 500 ? s.slice(0, 500) : s;
}

/**
 * HDF 处方：置换方式 pre/post/both 与置换液量（L）；非 HDF 时两列均为 NULL。
 * @returns {{ mode: string|null, volume: number|null } | { error: string }}
 */
function resolveHdfReplacementFields(modalityNormalized, modeRaw, volumeRaw) {
  const u = String(modalityNormalized || '')
    .trim()
    .toUpperCase()
    .replace(/\+/g, '_');
  if (u !== 'HDF') return { mode: null, volume: null };
  const m = String(modeRaw ?? '')
    .trim()
    .toLowerCase();
  if (!['pre', 'post', 'both'].includes(m)) {
    return { error: 'HDF 模式须选择置换方式：前置换、后置换或前后置换' };
  }
  const v = Number(volumeRaw);
  if (!Number.isFinite(v) || v <= 0 || v > 100) {
    return { error: 'HDF 须填写置换液量（0.1–100 L）' };
  }
  return { mode: m, volume: v };
}

// POST /api/prescriptions/check — 保存前用药规则校验（必须在 /:patientId 动态路由之前）
router.post(
  '/check',
  auth,
  rbac(['admin', 'doctor']),
  async (req, res, next) => {
    try {
      const { patientId, anticoagulantKey } = req.body || {};
      if (!patientId) return error(res, 'patientId 为必填项');
      const result = await MedicationRuleService.evaluateForPrescription(patientId, {
        anticoagulantKey: anticoagulantKey || 'heparin',
      });
      return success(res, result);
    } catch (err) {
      next(err);
    }
  },
);

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
    const {
      frequency_per_week, duration_hours, dialyzer_model, dialyzer_area, dialyzer_flux,
      anticoagulant, heparin_prime_dose, heparin_maintain,
      dry_weight, dry_weight_date, dry_weight_reason,
      dialysate_na, dialysate_ca, dialysate_k, dialysate_temp,
      blood_flow_rate, dialysate_flow_rate, notes,
      hemodialysis_modality: bodyHemodialysisModality,
      hemodialysis_remark: bodyHemodialysisRemark,
      hdf_replacement_mode: bodyHdfReplacementMode,
      hdf_replacement_volume_l: bodyHdfReplacementVolumeL,
      form_extra: bodyFormExtra,
    } = req.body || {};

    const formExtra = serializeFormExtraForDb(bodyFormExtra);

    const normalizedHemoModality = normalizeHemodialysisModalityForInsert(bodyHemodialysisModality);
    const hdfResolved = resolveHdfReplacementFields(
      normalizedHemoModality,
      bodyHdfReplacementMode,
      bodyHdfReplacementVolumeL,
    );
    if ('error' in hdfResolved && hdfResolved.error) {
      return error(res, hdfResolved.error);
    }

    if (!dry_weight || !dry_weight_date) {
      return error(res, '干体重和评估日期为必填项');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. 归档旧处方
      await client.query(
        `UPDATE prescriptions SET is_current = false, valid_until = CURRENT_DATE
         WHERE patient_id = $1 AND is_current = true`,
        [req.params.patientId]
      );

      // 2. 创建新处方
      const hemoRemark =
        bodyHemodialysisRemark !== undefined && bodyHemodialysisRemark !== null
          ? String(bodyHemodialysisRemark).trim() || null
          : null;

      const insertParamsHead = [
        req.params.patientId,
        frequency_per_week || 3,
        duration_hours || 4.0,
        pgParam(dialyzer_model),
        pgParam(dialyzer_area),
        pgParam(dialyzer_flux),
        anticoagulant || 'heparin',
        pgParam(heparin_prime_dose),
        pgParam(heparin_maintain),
        dry_weight,
        dry_weight_date,
        pgParam(dry_weight_reason),
        dialysate_na || 138,
        dialysate_ca || 1.5,
        dialysate_k || 2.0,
        dialysate_temp || 36.5,
        blood_flow_rate || 250,
        dialysate_flow_rate || 500,
        pgParam(notes),
      ];
      const insertParamsTail = [normalizedHemoModality, hemoRemark];
      const prescribedBy = pgParam(req.user?.id);
      const insertParamsWithHdfExtra = [
        ...insertParamsHead,
        formExtra,
        ...insertParamsTail,
        hdfResolved.mode,
        hdfResolved.volume,
        prescribedBy,
      ];
      const insertParamsWithHdf = [
        ...insertParamsHead,
        ...insertParamsTail,
        hdfResolved.mode,
        hdfResolved.volume,
        prescribedBy,
      ];
      const insertParamsLegacy = [...insertParamsHead, ...insertParamsTail, prescribedBy];

      const sqlInsertWithHdfExtra = `
        INSERT INTO prescriptions (
           patient_id, frequency_per_week, duration_hours,
           dialyzer_model, dialyzer_area, dialyzer_flux,
           anticoagulant, heparin_prime_dose, heparin_maintain,
           dry_weight, dry_weight_date, dry_weight_reason,
           dialysate_na, dialysate_ca, dialysate_k, dialysate_temp,
           blood_flow_rate, dialysate_flow_rate, notes,
           form_extra,
           hemodialysis_modality, hemodialysis_remark,
           hdf_replacement_mode, hdf_replacement_volume_l,
           prescribed_by, valid_from, is_current
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,CURRENT_DATE,true
         ) RETURNING *`;

      const sqlInsertWithHdf = `
        INSERT INTO prescriptions (
           patient_id, frequency_per_week, duration_hours,
           dialyzer_model, dialyzer_area, dialyzer_flux,
           anticoagulant, heparin_prime_dose, heparin_maintain,
           dry_weight, dry_weight_date, dry_weight_reason,
           dialysate_na, dialysate_ca, dialysate_k, dialysate_temp,
           blood_flow_rate, dialysate_flow_rate, notes,
           hemodialysis_modality, hemodialysis_remark,
           hdf_replacement_mode, hdf_replacement_volume_l,
           prescribed_by, valid_from, is_current
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,CURRENT_DATE,true
         ) RETURNING *`;

      const sqlInsertLegacy = `
        INSERT INTO prescriptions (
           patient_id, frequency_per_week, duration_hours,
           dialyzer_model, dialyzer_area, dialyzer_flux,
           anticoagulant, heparin_prime_dose, heparin_maintain,
           dry_weight, dry_weight_date, dry_weight_reason,
           dialysate_na, dialysate_ca, dialysate_k, dialysate_temp,
           blood_flow_rate, dialysate_flow_rate, notes,
           hemodialysis_modality, hemodialysis_remark,
           prescribed_by, valid_from, is_current
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,CURRENT_DATE,true
         ) RETURNING *`;

      /** 首条 INSERT 失败会中止事务；用 SAVEPOINT + ROLLBACK TO 才能在同一事务内换列集重试 */
      const INSERT_SP = 'prescription_insert_retry';
      await client.query(`SAVEPOINT ${INSERT_SP}`);
      async function rollbackInsertSavepoint() {
        await client.query(`ROLLBACK TO SAVEPOINT ${INSERT_SP}`);
      }

      let rows;
      try {
        ({ rows } = await client.query(sqlInsertWithHdfExtra, insertParamsWithHdfExtra));
      } catch (insertErr) {
        const isUndefCol = insertErr && insertErr.code === PG_UNDEFINED_COLUMN;
        const isJsonError =
          insertErr &&
          (insertErr.code === '22P02' || insertErr.code === '42804') &&
          insertErr.message &&
          /json|form_extra/i.test(String(insertErr.message));
        if (isUndefCol || isJsonError) {
          await rollbackInsertSavepoint();
          if (isJsonError) {
            logger.warn('prescriptions INSERT：form_extra 写入失败，尝试不含 form_extra 的 HDF INSERT');
          } else {
            logger.warn(
              'prescriptions INSERT：form_extra 或 HDF 列不存在，尝试不含 form_extra 的 HDF INSERT。请执行 migrations/049_prescriptions_form_extra.sql',
            );
          }
          try {
            ({ rows } = await client.query(sqlInsertWithHdf, insertParamsWithHdf));
          } catch (insertErr2) {
            if (insertErr2 && insertErr2.code === PG_UNDEFINED_COLUMN) {
              await rollbackInsertSavepoint();
              logger.warn(
                'prescriptions INSERT：HDF 列不存在，已回退为不含 hdf_replacement_* 的 INSERT。请执行 migrations/048_prescriptions_hdf_replacement.sql',
              );
              ({ rows } = await client.query(sqlInsertLegacy, insertParamsLegacy));
            } else {
              throw insertErr2;
            }
          }
        } else {
          throw insertErr;
        }
      }

      const newRx = rows[0];

      // 3. 将当前活跃医嘱关联到新处方（不终止医嘱，只更新外键）
      await clientQueryIgnoreUndefinedColumn(
        client,
        '同步 long_term_orders.prescription_id',
        `UPDATE long_term_orders SET prescription_id = $1
         WHERE patient_id = $2 AND status = 'active'`,
        [newRx.id, req.params.patientId],
      );

      // 4. 干体重与原因同步回患者档案（与编辑患者档案双向一致；047 未执行时列不存在）
      await clientQueryIgnoreUndefinedColumn(
        client,
        '同步 patients.profile_dry_weight',
        `UPDATE patients SET profile_dry_weight = $1, profile_dry_weight_date = $2::date,
            profile_dry_weight_reason = $3, updated_at = NOW()
         WHERE id = $4`,
        [
          newRx.dry_weight,
          coercePgDateValue(newRx.dry_weight_date),
          newRx.dry_weight_reason != null && String(newRx.dry_weight_reason).trim()
            ? String(newRx.dry_weight_reason).trim().slice(0, 2000)
            : null,
          req.params.patientId,
        ],
      );

      await client.query('COMMIT');
      return created(res, prescriptionRowForResponse(newRx), '透析处方开具成功');
    } catch (err) {
      logger.error('prescriptions 开具事务失败', {
        code: err.code,
        message: err.message,
        detail: err.detail,
        constraint: err.constraint,
      });
      await safeRollback(client);
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

      const dwd = dry_weight_date || formatDate(new Date());
      const dwr =
        dry_weight_reason != null && String(dry_weight_reason).trim()
          ? String(dry_weight_reason).trim().slice(0, 2000)
          : null;
      const { rows } = await pool.query(
        `UPDATE prescriptions
         SET dry_weight = $1, dry_weight_date = $2::date, dry_weight_reason = $3, updated_at = NOW()
         WHERE id = $4 RETURNING id, patient_id, dry_weight, dry_weight_date, dry_weight_reason`,
        [dry_weight, dwd, dwr, req.params.id]
      );
      if (rows.length === 0) return notFound(res, '处方不存在');
      const row = rows[0];
      await pool.query(
        `UPDATE patients SET profile_dry_weight = $1, profile_dry_weight_date = $2::date,
            profile_dry_weight_reason = $3, updated_at = NOW()
         WHERE id = $4`,
        [row.dry_weight, row.dry_weight_date, row.dry_weight_reason, row.patient_id],
      );
      return success(res, { id: row.id, dry_weight: row.dry_weight, dry_weight_date: row.dry_weight_date }, '干体重更新成功');
    } catch (err) { next(err); }
  }
);

module.exports = router;
