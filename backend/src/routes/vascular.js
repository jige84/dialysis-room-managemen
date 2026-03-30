/**
 * 血管通路 REST 路由
 * 主要作用：管理 AVF/AVG/TCC/NCC 等通路档案，支撑透析穿刺与感染风险评估。
 * 主要功能：通路 CRUD；CVC 高危评分（CVCRiskScoring）；溶栓等相关记录字段维护。
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const auth = require('../middleware/auth');
const { rbac } = require('../middleware/rbac');
const CVCRiskScoring = require('../services/CVCRiskScoring');
const { success, created, error, notFound } = require('../utils/response');

// GET /api/vascular/cvc-all - 全科当前CVC患者列表（护士长用）
// 静态路由必须在通配符路由之前
router.get('/cvc-all', auth, rbac(['admin','head_nurse','doctor']), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT va.*, p.name as patient_name, p.isolation_zone,
         cva.total_score as cvc_score, cva.risk_grade, cva.assessed_at
       FROM vascular_accesses va
       JOIN patients p ON p.id = va.patient_id
       LEFT JOIN LATERAL (
         SELECT total_score, risk_grade, assessed_at
         FROM cvc_risk_assessments WHERE access_id = va.id
         ORDER BY assessed_at DESC LIMIT 1
       ) cva ON true
       WHERE va.access_type IN ('ncc','tcc') AND va.is_current = true
       ORDER BY cva.total_score DESC NULLS LAST`
    );
    return success(res, rows);
  } catch (err) { next(err); }
});

// GET /api/vascular/:patientId - 获取患者所有通路
router.get('/:patientId', auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT va.*,
         cva.total_score as latest_cvc_score,
         cva.risk_grade as cvc_risk_grade,
         cva.assessed_at as cvc_assessed_at
       FROM vascular_accesses va
       LEFT JOIN LATERAL (
         SELECT total_score, risk_grade, assessed_at
         FROM cvc_risk_assessments
         WHERE access_id = va.id
         ORDER BY assessed_at DESC LIMIT 1
       ) cva ON true
       WHERE va.patient_id = $1
       ORDER BY va.is_current DESC, va.established_date DESC`,
      [req.params.patientId]
    );
    return success(res, rows);
  } catch (err) { next(err); }
});

// GET /api/vascular/:patientId/current - 当前通路
router.get('/:patientId/current', auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT va.*,
         cva.total_score as cvc_score,
         cva.risk_grade as cvc_risk_grade,
         cva.assessed_at as cvc_assessed_at,
         cva.factors as cvc_factors
       FROM vascular_accesses va
       LEFT JOIN LATERAL (
         SELECT total_score, risk_grade, assessed_at, factors
         FROM cvc_risk_assessments
         WHERE access_id = va.id
         ORDER BY assessed_at DESC LIMIT 1
       ) cva ON true
       WHERE va.patient_id = $1 AND va.is_current = true
       ORDER BY va.established_date DESC`,
      [req.params.patientId]
    );
    return success(res, rows);
  } catch (err) { next(err); }
});

// POST /api/vascular/:patientId - 新增血管通路
router.post('/:patientId', auth, rbac(['admin','head_nurse','doctor']), async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const {
      access_type, location, side, established_date,
      surgeon, notes,
      // CVC特有
      cvc_brand, cvc_spec, insertion_date,
      // 超声随访
      avf_blood_flow, avf_diameter, avf_ultrasound_date,
    } = req.body;

    if (!access_type) return error(res, '通路类型不能为空');

    // 如果新通路是current，把之前的current改为false
    if (req.body.is_current !== false) {
      await client.query(
        `UPDATE vascular_accesses SET is_current = false WHERE patient_id = $1`,
        [req.params.patientId]
      );
    }

    const { rows } = await client.query(
      `INSERT INTO vascular_accesses (
         patient_id, access_type, location, side,
         established_date, surgeon, notes,
         cvc_brand, cvc_spec, insertion_date,
         avf_blood_flow, avf_diameter, avf_ultrasound_date,
         is_current, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true,$14)
       RETURNING *`,
      [
        req.params.patientId, access_type, location, side,
        established_date, surgeon, notes,
        cvc_brand, cvc_spec, insertion_date || null,
        avf_blood_flow, avf_diameter, avf_ultrasound_date || null,
        req.user.id,
      ]
    );

    await client.query('COMMIT');
    return created(res, rows[0], '血管通路记录已创建');
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally { client.release(); }
});

// PUT /api/vascular/:id - 更新通路信息（超声随访结果等）
router.put('/:id', auth, rbac(['admin','head_nurse','doctor','nurse']), async (req, res, next) => {
  try {
    const allowed = [
      'avf_blood_flow','avf_diameter','avf_ultrasound_date',
      'notes','surgeon',
    ];
    const updates = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) updates[k] = req.body[k];
    }
    if (Object.keys(updates).length === 0) return error(res, '无可更新字段');

    const sets = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`).join(', ');
    const values = Object.values(updates);

    const { rows } = await pool.query(
      `UPDATE vascular_accesses SET ${sets}, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.id, ...values]
    );
    if (rows.length === 0) return notFound(res, '通路记录不存在');
    return success(res, rows[0], '通路信息已更新');
  } catch (err) { next(err); }
});

// PATCH /api/vascular/:id/abandon - 废用通路
router.patch('/:id/abandon', auth, rbac(['admin','head_nurse','doctor']), async (req, res, next) => {
  try {
    const { reason, abandon_date } = req.body;
    const { rows } = await pool.query(
      `UPDATE vascular_accesses
       SET is_current = false, abandon_reason = $2, abandon_date = $3, updated_at = NOW()
       WHERE id = $1 RETURNING id, access_type, is_current`,
      [req.params.id, reason, abandon_date || new Date().toISOString().slice(0, 10)]
    );
    if (rows.length === 0) return notFound(res, '通路记录不存在');
    return success(res, rows[0], '通路已标记废用');
  } catch (err) { next(err); }
});

// GET /api/vascular/:accessId/cvc-risk - CVC风险评分历史
router.get('/:accessId/cvc-risk', auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT cva.*, u.real_name as assessed_by_name
       FROM cvc_risk_assessments cva
       LEFT JOIN users u ON cva.assessed_by = u.id
       WHERE cva.access_id = $1
       ORDER BY cva.assessed_at DESC`,
      [req.params.accessId]
    );
    return success(res, rows);
  } catch (err) { next(err); }
});

// POST /api/vascular/:accessId/cvc-risk - 新增CVC风险评分
router.post('/:accessId/cvc-risk', auth, rbac(['admin','head_nurse','nurse']), async (req, res, next) => {
  try {
    const { factors } = req.body;
    if (!factors) return error(res, '请提供评分因素');

    const { total_score, risk_grade } = CVCRiskScoring.calculate(factors);

    const { rows } = await pool.query(
      `INSERT INTO cvc_risk_assessments (access_id, factors, total_score, risk_grade, assessed_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.params.accessId, JSON.stringify(factors), total_score, risk_grade, req.user.id]
    );

    // 更新通路表的最新评分
    await pool.query(
      `UPDATE vascular_accesses SET cvc_risk_score = $1, updated_at = NOW() WHERE id = $2`,
      [total_score, req.params.accessId]
    );

    return created(res, { ...rows[0], total_score, risk_grade }, `评分完成：${total_score}分（${risk_grade}级）`);
  } catch (err) { next(err); }
});

// POST /api/vascular/:accessId/thrombolysis - 溶栓记录
router.post('/:accessId/thrombolysis', auth, rbac(['admin','head_nurse','doctor']), async (req, res, next) => {
  try {
    const { thrombolysis_date, drug, dose, route, operator, outcome, notes } = req.body;
    if (!thrombolysis_date) return error(res, '溶栓日期不能为空');

    const { rows } = await pool.query(
      `INSERT INTO thrombolysis_records
         (access_id, thrombolysis_date, drug, dose, route, operator, outcome, notes, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.params.accessId, thrombolysis_date, drug, dose, route, operator, outcome, notes, req.user.id]
    );
    return created(res, rows[0], '溶栓记录已保存');
  } catch (err) { next(err); }
});

// GET /api/vascular/:accessId/thrombolysis - 溶栓历史
router.get('/:accessId/thrombolysis', auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT tr.*, u.real_name as recorded_by_name
       FROM thrombolysis_records tr
       LEFT JOIN users u ON tr.recorded_by = u.id
       WHERE tr.access_id = $1 ORDER BY tr.thrombolysis_date DESC`,
      [req.params.accessId]
    );
    return success(res, rows);
  } catch (err) { next(err); }
});

module.exports = router;
