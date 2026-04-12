/**
 * 血管通路 REST 路由
 * 主要作用：管理 AVF/AVG/TCC/NCC 等通路档案，支撑透析穿刺与 CVC 感染风险评估。
 * 权限矩阵：详见 hd-alerts-permissions SKILL
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const auth = require('../middleware/auth');
const { rbac } = require('../middleware/rbac');
const auditLog = require('../middleware/audit');
const restrictNurseEditTime = require('../middleware/nurseTimeRestriction');
const CVCRiskScoring = require('../services/CVCRiskScoring');
const { success, created, error, notFound } = require('../utils/response');
const { formatDate } = require('../utils/dateUtils');

/** 将 6 因素布尔列组装为 factors 对象，供 GET /cvc-risk 与前端逐项展示 */
function mapCvcRiskFactorsRow(row) {
  return {
    ...row,
    factors: {
      diabetes_mellitus:      !!row.diabetes_mellitus,
      immunosuppressed:       !!row.immunosuppressed,
      recent_hospitalization: !!row.recent_hospitalization,
      catheter_days_over90:   !!row.catheter_days_over90,
      previous_crbsi:         !!row.previous_crbsi,
      poor_hygiene:           !!row.poor_hygiene,
    },
  };
}

// ---------------------------------------------------------------------------
// 静态路由（必须在 :patientId / :id / :accessId 通配符路由之前）
// ---------------------------------------------------------------------------

// GET /api/vascular/cvc-all — 全科当前 CVC 患者（护士长/admin/doctor 用）
router.get('/cvc-all', auth, rbac(['admin', 'head_nurse', 'doctor']), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT va.id, va.access_type, va.location, va.established_date, va.is_active,
              p.id as patient_id, p.name as patient_name, p.isolation_zone,
              cva.total_score as cvc_score, cva.risk_grade, cva.assessed_at
         FROM vascular_accesses va
         JOIN patients p ON p.id = va.patient_id
         LEFT JOIN LATERAL (
           SELECT total_score, risk_grade, assessed_at
             FROM cvc_risk_assessments
            WHERE vascular_access_id = va.id
            ORDER BY assessed_at DESC LIMIT 1
         ) cva ON true
        WHERE va.access_type IN ('ncc', 'tcc') AND va.is_active = true
        ORDER BY cva.total_score DESC NULLS LAST`
    );
    return success(res, rows);
  } catch (err) { next(err); }
});

// GET /api/vascular/factor-definitions — CVC 风险因素定义（供前端渲染用）
router.get('/factor-definitions', auth, async (_req, res, next) => {
  try {
    return success(res, CVCRiskScoring.getFactorDefinitions());
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// 患者维度通路列表 / 当前通路
// ---------------------------------------------------------------------------

// GET /api/vascular/:patientId/list — 患者所有通路（含最新 CVC 评分）
router.get('/:patientId/list', auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT va.*,
              cva.total_score as latest_cvc_score,
              cva.risk_grade  as cvc_risk_grade,
              cva.assessed_at as cvc_assessed_at
         FROM vascular_accesses va
         LEFT JOIN LATERAL (
           SELECT total_score, risk_grade, assessed_at
             FROM cvc_risk_assessments
            WHERE vascular_access_id = va.id
            ORDER BY assessed_at DESC LIMIT 1
         ) cva ON true
        WHERE va.patient_id = $1
        ORDER BY va.is_active DESC, va.established_date DESC`,
      [req.params.patientId]
    );
    return success(res, rows);
  } catch (err) { next(err); }
});

// GET /api/vascular/:patientId/current — 当前活动通路（含最新 CVC 评分摘要）
router.get('/:patientId/current', auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT va.*,
              cva.total_score        as cvc_score,
              cva.risk_grade         as cvc_risk_grade,
              cva.assessed_at        as cvc_assessed_at,
              cva.diabetes_mellitus,
              cva.immunosuppressed,
              cva.recent_hospitalization,
              cva.catheter_days_over90,
              cva.previous_crbsi,
              cva.poor_hygiene
         FROM vascular_accesses va
         LEFT JOIN LATERAL (
           SELECT total_score, risk_grade, assessed_at,
                  diabetes_mellitus, immunosuppressed, recent_hospitalization,
                  catheter_days_over90, previous_crbsi, poor_hygiene
             FROM cvc_risk_assessments
            WHERE vascular_access_id = va.id
            ORDER BY assessed_at DESC LIMIT 1
         ) cva ON true
        WHERE va.patient_id = $1 AND va.is_active = true
        ORDER BY va.established_date DESC
        LIMIT 1`,
      [req.params.patientId]
    );
    return success(res, rows[0] || null);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// 通路 CRUD
// ---------------------------------------------------------------------------

// POST /api/vascular/:patientId — 新增血管通路
router.post(
  '/:patientId',
  auth,
  rbac(['admin', 'head_nurse', 'doctor']),
  auditLog('vascular_accesses', 'CREATE'),
  async (req, res, next) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { access_type, location, established_date, puncture_method, notes } = req.body;
      if (!access_type) return error(res, '通路类型不能为空');
      if (!location) return error(res, '通路位置不能为空');
      if (!established_date) return error(res, '建立日期不能为空');

      // 新通路设为活动时，先把该患者的旧活动通路关闭
      await client.query(
        `UPDATE vascular_accesses SET is_active = false, updated_at = NOW()
          WHERE patient_id = $1 AND is_active = true`,
        [req.params.patientId]
      );

      const { rows } = await client.query(
        `INSERT INTO vascular_accesses
           (patient_id, access_type, location, established_date, puncture_method, notes, is_active, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, true, $7)
         RETURNING *`,
        [req.params.patientId, access_type, location, established_date, puncture_method, notes, req.user.id]
      );

      await client.query('COMMIT');
      return created(res, rows[0], '血管通路记录已创建');
    } catch (err) {
      await client.query('ROLLBACK');
      next(err);
    } finally { client.release(); }
  }
);

// PUT /api/vascular/access/:id — 更新通路基本信息（超声随访结果等）
router.put(
  '/access/:id',
  auth,
  rbac(['admin', 'head_nurse', 'doctor', 'nurse']),
  auditLog('vascular_accesses', 'UPDATE'),
  async (req, res, next) => {
    try {
      const ALLOWED = [
        'last_ultrasound_date', 'ultrasound_result', 'ultrasound_notes',
        'puncture_method', 'notes',
      ];
      const updates = {};
      for (const k of ALLOWED) {
        if (req.body[k] !== undefined) updates[k] = req.body[k];
      }
      if (Object.keys(updates).length === 0) return error(res, '无可更新字段');

      const sets = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`).join(', ');
      const { rows } = await pool.query(
        `UPDATE vascular_accesses SET ${sets}, updated_at = NOW()
          WHERE id = $1 RETURNING *`,
        [req.params.id, ...Object.values(updates)]
      );
      if (rows.length === 0) return notFound(res, '通路记录不存在');
      return success(res, rows[0], '通路信息已更新');
    } catch (err) { next(err); }
  }
);

// PATCH /api/vascular/access/:id/abandon — 废用通路
router.patch(
  '/access/:id/abandon',
  auth,
  rbac(['admin', 'head_nurse', 'doctor']),
  auditLog('vascular_accesses', 'UPDATE'),
  async (req, res, next) => {
    try {
      const { reason, abandon_date } = req.body;
      const { rows } = await pool.query(
        `UPDATE vascular_accesses
            SET is_active = false,
                deactivation_reason = $2,
                deactivated_date = $3,
                updated_at = NOW()
          WHERE id = $1
          RETURNING id, access_type, is_active, deactivated_date`,
        [req.params.id, reason, abandon_date || formatDate(new Date())]
      );
      if (rows.length === 0) return notFound(res, '通路记录不存在');
      return success(res, rows[0], '通路已标记废用');
    } catch (err) { next(err); }
  }
);

// ---------------------------------------------------------------------------
// AVF/AVG 定期评估记录
// ---------------------------------------------------------------------------

// GET /api/vascular/:accessId/assessments — 评估历史列表
router.get('/:accessId/assessments', auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT aa.*, u.real_name as assessed_by_name
         FROM vascular_avf_assessments aa
         LEFT JOIN users u ON aa.assessed_by = u.id
        WHERE aa.vascular_access_id = $1
        ORDER BY aa.assessed_at DESC`,
      [req.params.accessId]
    );
    return success(res, rows);
  } catch (err) { next(err); }
});

// POST /api/vascular/:accessId/assessments — 新增 AVF/AVG 评估
router.post(
  '/:accessId/assessments',
  auth,
  rbac(['admin', 'head_nurse', 'doctor', 'nurse']),
  restrictNurseEditTime,
  auditLog('vascular_avf_assessments', 'CREATE'),
  async (req, res, next) => {
    try {
      const {
        assessed_at,
        blood_flow_rate,
        pulsation,
        thrill,
        bruit,
        inner_diameter_mm,
        skin_depth_mm,
        arm_raise_test,
        pulsation_enhancement_test,
        skin_condition,
        overall_result,
        notes,
      } = req.body;

      if (!assessed_at) return error(res, '评估日期不能为空');
      if (!overall_result) return error(res, '评估结论不能为空');

      // 验证通路存在且属于 AVF/AVG
      const { rows: accessRows } = await pool.query(
        `SELECT id, patient_id, access_type FROM vascular_accesses WHERE id = $1`,
        [req.params.accessId]
      );
      if (accessRows.length === 0) return notFound(res, '通路记录不存在');
      const access = accessRows[0];
      if (!['avf', 'avg'].includes(access.access_type)) {
        return error(res, '该接口仅适用于 AVF/AVG 通路评估');
      }

      const { rows } = await pool.query(
        `INSERT INTO vascular_avf_assessments
           (vascular_access_id, patient_id, assessed_at,
            blood_flow_rate, pulsation, thrill, bruit,
            inner_diameter_mm, skin_depth_mm,
            arm_raise_test, pulsation_enhancement_test,
            skin_condition, overall_result, notes, assessed_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING *`,
        [
          req.params.accessId, access.patient_id, assessed_at,
          blood_flow_rate, pulsation, thrill, bruit,
          inner_diameter_mm, skin_depth_mm,
          arm_raise_test, pulsation_enhancement_test,
          skin_condition, overall_result, notes, req.user.id,
        ]
      );

      // 同步更新通路表的最新超声日期与结果（若提供了血流量）
      if (blood_flow_rate) {
        await pool.query(
          `UPDATE vascular_accesses
              SET last_ultrasound_date = $2, updated_at = NOW()
            WHERE id = $1`,
          [req.params.accessId, assessed_at]
        );
      }

      return created(res, rows[0], '评估记录已保存');
    } catch (err) { next(err); }
  }
);

// ---------------------------------------------------------------------------
// CVC 日常评估记录
// ---------------------------------------------------------------------------

// GET /api/vascular/:accessId/cvc-assessments — CVC 评估历史
router.get('/:accessId/cvc-assessments', auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT ca.*, u.real_name as assessed_by_name
         FROM vascular_cvc_assessments ca
         LEFT JOIN users u ON ca.assessed_by = u.id
        WHERE ca.vascular_access_id = $1
        ORDER BY ca.assessed_at DESC`,
      [req.params.accessId]
    );
    return success(res, rows);
  } catch (err) { next(err); }
});

// POST /api/vascular/:accessId/cvc-assessments — 新增 CVC 评估
router.post(
  '/:accessId/cvc-assessments',
  auth,
  rbac(['admin', 'head_nurse', 'doctor', 'nurse']),
  restrictNurseEditTime,
  auditLog('vascular_cvc_assessments', 'CREATE'),
  async (req, res, next) => {
    try {
      const {
        assessed_at,
        blood_flow_rate,
        blood_return_status,
        arterial_draw_volume_ml,
        venous_draw_volume_ml,
        lock_clot_status,
        skin_condition,
        fixation_status,
        overall_result,
        intervention_notes,
      } = req.body;

      if (!assessed_at) return error(res, '评估日期不能为空');
      if (!overall_result) return error(res, '评估结论不能为空');

      const { rows: accessRows } = await pool.query(
        `SELECT id, patient_id, access_type FROM vascular_accesses WHERE id = $1`,
        [req.params.accessId]
      );
      if (accessRows.length === 0) return notFound(res, '通路记录不存在');
      const access = accessRows[0];
      if (!['ncc', 'tcc'].includes(access.access_type)) {
        return error(res, '该接口仅适用于 NCC/TCC 导管评估');
      }

      const { rows } = await pool.query(
        `INSERT INTO vascular_cvc_assessments
           (vascular_access_id, patient_id, assessed_at,
            blood_flow_rate, blood_return_status,
            arterial_draw_volume_ml, venous_draw_volume_ml, lock_clot_status,
            skin_condition, fixation_status,
            overall_result, intervention_notes, assessed_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING *`,
        [
          req.params.accessId, access.patient_id, assessed_at,
          blood_flow_rate, blood_return_status,
          arterial_draw_volume_ml, venous_draw_volume_ml, lock_clot_status,
          skin_condition, fixation_status,
          overall_result, intervention_notes, req.user.id,
        ]
      );
      return created(res, rows[0], 'CVC 评估记录已保存');
    } catch (err) { next(err); }
  }
);

// ---------------------------------------------------------------------------
// 穿刺记录（AVF/AVG 专用）
// ---------------------------------------------------------------------------

// GET /api/vascular/:accessId/punctures — 穿刺记录历史
router.get('/:accessId/punctures', auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT vp.*, u.real_name as nurse_name
         FROM vascular_punctures vp
         LEFT JOIN users u ON vp.nurse_id = u.id
        WHERE vp.vascular_access_id = $1
        ORDER BY vp.puncture_date DESC`,
      [req.params.accessId]
    );
    return success(res, rows);
  } catch (err) { next(err); }
});

// POST /api/vascular/:accessId/punctures — 新增穿刺记录
router.post(
  '/:accessId/punctures',
  auth,
  rbac(['admin', 'head_nurse', 'nurse']),
  restrictNurseEditTime,
  auditLog('vascular_punctures', 'CREATE'),
  async (req, res, next) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const {
        puncture_date,
        arterial_site,
        venous_site,
        attempts,
        puncture_result,
        hematoma_occurred,
        notes,
      } = req.body;

      if (!puncture_date) return error(res, '穿刺日期不能为空');
      if (!puncture_result) return error(res, '穿刺结果不能为空');

      const { rows: accessRows } = await client.query(
        `SELECT id, patient_id, access_type FROM vascular_accesses WHERE id = $1`,
        [req.params.accessId]
      );
      if (accessRows.length === 0) return notFound(res, '通路记录不存在');
      const access = accessRows[0];
      if (!['avf', 'avg'].includes(access.access_type)) {
        return error(res, '穿刺记录仅适用于 AVF/AVG 通路');
      }

      const { rows } = await client.query(
        `INSERT INTO vascular_punctures
           (vascular_access_id, patient_id, puncture_date, nurse_id,
            arterial_site, venous_site, attempts, puncture_result, hematoma_occurred, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
        [
          req.params.accessId, access.patient_id, puncture_date, req.user.id,
          arterial_site, venous_site, attempts || 1,
          puncture_result, hematoma_occurred || false, notes,
        ]
      );

      // 规程：连续 3 次穿刺困难 → MEDIUM 级预警（由 AlertEngine 定时检测，此处仅记录）
      await client.query('COMMIT');
      return created(res, rows[0], '穿刺记录已保存');
    } catch (err) {
      await client.query('ROLLBACK');
      next(err);
    } finally { client.release(); }
  }
);

// ---------------------------------------------------------------------------
// CVC 风险评分（6 因素）
// ---------------------------------------------------------------------------

// GET /api/vascular/:accessId/cvc-risk — CVC 风险评分历史
router.get('/:accessId/cvc-risk', auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT cra.*,
              u.real_name as assessed_by_name
         FROM cvc_risk_assessments cra
         LEFT JOIN users u ON cra.assessed_by = u.id
        WHERE cra.vascular_access_id = $1
        ORDER BY cra.assessed_at DESC`,
      [req.params.accessId]
    );
    return success(res, rows.map(mapCvcRiskFactorsRow));
  } catch (err) { next(err); }
});

// POST /api/vascular/:accessId/cvc-risk — 新增 CVC 风险评分
router.post(
  '/:accessId/cvc-risk',
  auth,
  rbac(['admin', 'head_nurse', 'nurse', 'doctor']),
  auditLog('cvc_risk_assessments', 'CREATE'),
  async (req, res, next) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const {
        assessed_at,
        diabetes_mellitus,
        immunosuppressed,
        recent_hospitalization,
        catheter_days_over90,
        previous_crbsi,
        poor_hygiene,
        intervention_notes,
      } = req.body;

      if (!assessed_at) return error(res, '评估日期不能为空');

      const factors = {
        diabetes_mellitus:      !!diabetes_mellitus,
        immunosuppressed:       !!immunosuppressed,
        recent_hospitalization: !!recent_hospitalization,
        catheter_days_over90:   !!catheter_days_over90,
        previous_crbsi:         !!previous_crbsi,
        poor_hygiene:           !!poor_hygiene,
      };

      const { rows: accessRows } = await client.query(
        `SELECT id, patient_id FROM vascular_accesses WHERE id = $1`,
        [req.params.accessId]
      );
      if (accessRows.length === 0) return notFound(res, '通路记录不存在');
      const { patient_id } = accessRows[0];

      const { total_score, risk_grade, risk_label, score_summary } = CVCRiskScoring.calculate(factors);

      const { rows } = await client.query(
        `INSERT INTO cvc_risk_assessments
           (vascular_access_id, patient_id, assessed_at,
            diabetes_mellitus, immunosuppressed, recent_hospitalization,
            catheter_days_over90, previous_crbsi, poor_hygiene,
            total_score, risk_grade, assessed_by, intervention_notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING *`,
        [
          req.params.accessId, patient_id, assessed_at,
          factors.diabetes_mellitus, factors.immunosuppressed, factors.recent_hospitalization,
          factors.catheter_days_over90, factors.previous_crbsi, factors.poor_hygiene,
          total_score, risk_grade, req.user.id, intervention_notes,
        ]
      );

      // 同步更新通路表的最新风险评分
      await client.query(
        `UPDATE vascular_accesses
            SET last_risk_score = $2, last_risk_grade = $3, updated_at = NOW()
          WHERE id = $1`,
        [req.params.accessId, total_score, risk_grade]
      );

      await client.query('COMMIT');
      return created(res, mapCvcRiskFactorsRow({ ...rows[0], risk_label, score_summary }), `风险评分完成：${total_score}分（${risk_label}）`);
    } catch (err) {
      await client.query('ROLLBACK');
      next(err);
    } finally { client.release(); }
  }
);

// ---------------------------------------------------------------------------
// 溶栓记录（TCC/NCC 专用）
// ---------------------------------------------------------------------------

// GET /api/vascular/:accessId/thrombolysis — 溶栓历史
router.get('/:accessId/thrombolysis', auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT tr.*, u.real_name as performed_by_name
         FROM thrombolysis_records tr
         LEFT JOIN users u ON tr.performed_by = u.id
        WHERE tr.vascular_access_id = $1
        ORDER BY tr.thrombolysis_date DESC`,
      [req.params.accessId]
    );
    return success(res, rows);
  } catch (err) { next(err); }
});

// POST /api/vascular/:accessId/thrombolysis — 新增溶栓记录
router.post(
  '/:accessId/thrombolysis',
  auth,
  rbac(['admin', 'head_nurse', 'doctor', 'nurse']),
  auditLog('thrombolysis_records', 'CREATE'),
  async (req, res, next) => {
    try {
      const { thrombolysis_date, drug_name, drug_dose, method, dwell_hours, evaluation, is_successful, notes } = req.body;
      if (!thrombolysis_date) return error(res, '溶栓日期不能为空');
      if (!method) return error(res, '溶栓方式不能为空');
      if (!evaluation) return error(res, '溶栓效果评价不能为空');

      const { rows: accessRows } = await pool.query(
        `SELECT id, patient_id FROM vascular_accesses WHERE id = $1`,
        [req.params.accessId]
      );
      if (accessRows.length === 0) return notFound(res, '通路记录不存在');
      const { patient_id } = accessRows[0];

      const { rows } = await pool.query(
        `INSERT INTO thrombolysis_records
           (vascular_access_id, patient_id, thrombolysis_date,
            drug_name, drug_dose, method, dwell_hours,
            evaluation, is_successful, notes, performed_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [
          req.params.accessId, patient_id, thrombolysis_date,
          drug_name || '尿激酶', drug_dose, method, dwell_hours,
          evaluation, is_successful !== false, notes, req.user.id,
        ]
      );
      return created(res, rows[0], '溶栓记录已保存');
    } catch (err) { next(err); }
  }
);

module.exports = router;
