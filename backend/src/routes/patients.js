/**
 * 患者档案管理路由
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const auth = require('../middleware/auth');
const { rbac } = require('../middleware/rbac');
const auditLog = require('../middleware/audit');
const { encrypt, decrypt, maskIdCard, maskPhone } = require('../utils/encrypt');
const { calcAge, formatDuration } = require('../utils/dateUtils');
const { success, created, paginated, error, notFound } = require('../utils/response');

// GET /api/patients
router.get('/', auth, async (req, res, next) => {
  try {
    const { page = 1, page_size = 20, status, isolation_zone, keyword } = req.query;
    const offset = (page - 1) * page_size;

    const conditions = ['1=1'];
    const params = [];
    let idx = 1;

    if (status)         { conditions.push(`p.status = $${idx++}`);         params.push(status); }
    if (isolation_zone) { conditions.push(`p.isolation_zone = $${idx++}`); params.push(isolation_zone); }
    if (keyword) {
      conditions.push(`(p.name ILIKE $${idx} OR p.name ~ $${idx})`);
      params.push(`%${keyword}%`);
      idx++;
    }

    const where = conditions.join(' AND ');

    const countRes = await pool.query(`SELECT COUNT(*) FROM patients p WHERE ${where}`, params);
    const total = parseInt(countRes.rows[0].count);

    const { rows } = await pool.query(
      `SELECT p.id, p.name, p.gender, p.dob, p.primary_diagnosis, p.status,
              p.dialysis_start_date, p.isolation_zone, p.consent_dialysis,
              p.phone_encrypted,
              va.access_type, va.location as access_location
       FROM patients p
       LEFT JOIN LATERAL (
         SELECT access_type, location FROM vascular_accesses
         WHERE patient_id = p.id AND is_active = true
         ORDER BY created_at DESC LIMIT 1
       ) va ON true
       WHERE ${where}
       ORDER BY p.name
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, page_size, offset]
    );

    const list = rows.map(row => ({
      ...row,
      age: calcAge(row.dob),
      dialysis_age: formatDuration(row.dialysis_start_date),
      phone_masked: maskPhone(decrypt(row.phone_encrypted)),
      phone_encrypted: undefined,
    }));

    return paginated(res, list, total, page, page_size);
  } catch (err) { next(err); }
});

// GET /api/patients/stats
router.get('/stats', auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'active')                         as total_active,
        COUNT(*) FILTER (WHERE isolation_zone = 'normal')                 as zone_normal,
        COUNT(*) FILTER (WHERE isolation_zone = 'hbv')                   as zone_hbv,
        COUNT(*) FILTER (WHERE isolation_zone = 'hcv')                   as zone_hcv,
        COUNT(*) FILTER (WHERE isolation_zone = 'observation')            as zone_obs,
        (SELECT COUNT(*) FROM vascular_accesses WHERE access_type='avf' AND is_active=true) as va_avf,
        (SELECT COUNT(*) FROM vascular_accesses WHERE access_type='avg' AND is_active=true) as va_avg,
        (SELECT COUNT(*) FROM vascular_accesses WHERE access_type='tcc' AND is_active=true) as va_tcc,
        (SELECT COUNT(*) FROM vascular_accesses WHERE access_type='ncc' AND is_active=true) as va_ncc
      FROM patients WHERE status = 'active'
    `);
    return success(res, rows[0]);
  } catch (err) { next(err); }
});

// GET /api/patients/:id
router.get('/:id', auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*,
              pr.id as rx_id, pr.frequency_per_week, pr.duration_hours, pr.dialyzer_model,
              pr.dry_weight, pr.dry_weight_date, pr.anticoagulant,
              pr.heparin_prime_dose, pr.heparin_maintain,
              pr.dialysate_na, pr.dialysate_ca, pr.dialysate_k, pr.dialysate_temp,
              pr.blood_flow_rate, pr.dialysate_flow_rate
       FROM patients p
       LEFT JOIN prescriptions pr ON pr.patient_id = p.id AND pr.is_current = true
       WHERE p.id = $1`,
      [req.params.id]
    );

    if (rows.length === 0) return notFound(res, '患者不存在');

    const patient = rows[0];

    // 解密并脱敏（管理员/护士长可看完整）
    const isPrivileged = ['admin', 'head_nurse'].includes(req.user.role);
    patient.age = calcAge(patient.dob);
    patient.dialysis_age = formatDuration(patient.dialysis_start_date);
    patient.phone = isPrivileged
      ? decrypt(patient.phone_encrypted)
      : maskPhone(decrypt(patient.phone_encrypted));
    patient.id_card = isPrivileged
      ? decrypt(patient.id_card_encrypted)
      : maskIdCard(decrypt(patient.id_card_encrypted));
    delete patient.phone_encrypted;
    delete patient.id_card_encrypted;

    // 当前血管通路
    const { rows: vaRows } = await pool.query(
      `SELECT id, access_type, location, established_date, first_use_date,
              puncture_method, is_buttonhole, is_active, last_risk_score, last_risk_grade,
              last_ultrasound_date, ultrasound_result
       FROM vascular_accesses WHERE patient_id = $1 AND is_active = true`,
      [req.params.id]
    );
    patient.vascular_accesses = vaRows;

    // 最近3条透析记录
    const { rows: drRows } = await pool.query(
      `SELECT id, session_date, shift, ktv, urr, uf_volume, coagulation_grade
       FROM dialysis_records WHERE patient_id = $1 ORDER BY session_date DESC LIMIT 3`,
      [req.params.id]
    );
    patient.recent_dialysis = drRows;

    return success(res, patient);
  } catch (err) { next(err); }
});

// POST /api/patients
// patients:create 权限：admin, doctor（规范不含 head_nurse）
router.post('/', auth, rbac(['admin', 'doctor']), auditLog('patients', 'CREATE'), async (req, res, next) => {
  try {
    const {
      name, gender, dob, id_card, phone, family_contact, address,
      primary_diagnosis, ckd_stage, comorbidities,
      dialysis_start_date, dialysis_mode, isolation_zone,
      consent_dialysis, consent_dialysis_date
    } = req.body;

    if (!name || !gender || !dob || !dialysis_start_date || !primary_diagnosis) {
      return error(res, '姓名、性别、出生日期、开始透析日期、诊断为必填项');
    }

    const { rows } = await pool.query(
      `INSERT INTO patients (
         name, gender, dob,
         id_card_encrypted, phone_encrypted,
         family_contact, address,
         primary_diagnosis, ckd_stage, comorbidities,
         dialysis_start_date, dialysis_mode,
         isolation_zone,
         consent_dialysis, consent_dialysis_date,
         created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING id, name, gender, dob, primary_diagnosis, status, dialysis_start_date`,
      [
        name, gender, dob,
        id_card ? encrypt(id_card) : null,
        phone ? encrypt(phone) : null,
        family_contact ? JSON.stringify(family_contact) : null,
        address,
        primary_diagnosis, ckd_stage,
        comorbidities || null,
        dialysis_start_date, dialysis_mode || 'HD',
        isolation_zone || 'normal',
        consent_dialysis || false, consent_dialysis_date || null,
        req.user.id
      ]
    );

    return created(res, rows[0], '患者档案创建成功');
  } catch (err) { next(err); }
});

// PUT /api/patients/:id
// patients:update 权限：admin, doctor（规范不含 head_nurse）
router.put('/:id', auth, rbac(['admin', 'doctor']), auditLog('patients', 'UPDATE'), async (req, res, next) => {
  try {
    const {
      name, gender, dob, id_card, phone, family_contact, address,
      primary_diagnosis, ckd_stage, comorbidities, dialysis_mode
    } = req.body;

    const { rows } = await pool.query(
      `UPDATE patients SET
         name = COALESCE($1, name),
         gender = COALESCE($2, gender),
         dob = COALESCE($3, dob),
         id_card_encrypted = CASE WHEN $4::text IS NOT NULL THEN $4 ELSE id_card_encrypted END,
         phone_encrypted = CASE WHEN $5::text IS NOT NULL THEN $5 ELSE phone_encrypted END,
         family_contact = COALESCE($6::jsonb, family_contact),
         address = COALESCE($7, address),
         primary_diagnosis = COALESCE($8, primary_diagnosis),
         ckd_stage = COALESCE($9, ckd_stage),
         comorbidities = COALESCE($10, comorbidities),
         dialysis_mode = COALESCE($11, dialysis_mode),
         updated_at = NOW()
       WHERE id = $12
       RETURNING id, name, gender, status`,
      [
        name, gender, dob,
        id_card ? encrypt(id_card) : null,
        phone ? encrypt(phone) : null,
        family_contact ? JSON.stringify(family_contact) : null,
        address, primary_diagnosis, ckd_stage,
        comorbidities || null,
        dialysis_mode,
        req.params.id
      ]
    );

    if (rows.length === 0) return notFound(res, '患者不存在');
    return success(res, rows[0], '患者信息更新成功');
  } catch (err) { next(err); }
});

// PATCH /api/patients/:id/status
// patients:update 权限：admin, doctor
router.patch('/:id/status', auth, rbac(['admin', 'doctor']), auditLog('patients', 'UPDATE'), async (req, res, next) => {
  try {
    const { status, status_note, status_changed_at } = req.body;
    const validStatuses = ['active', 'suspended', 'transferred', 'transplanted', 'deceased'];
    if (!validStatuses.includes(status)) {
      return error(res, '无效的患者状态');
    }

    const { rows } = await pool.query(
      `UPDATE patients SET status = $1, status_note = $2, status_changed_at = $3, updated_at = NOW()
       WHERE id = $4 RETURNING id, name, status`,
      [status, status_note, status_changed_at, req.params.id]
    );
    if (rows.length === 0) return notFound(res, '患者不存在');
    return success(res, rows[0], '患者状态已更新');
  } catch (err) { next(err); }
});

// PATCH /api/patients/:id/isolation
router.patch('/:id/isolation', auth, rbac(['admin', 'head_nurse']), auditLog('patients', 'UPDATE'), async (req, res, next) => {
  try {
    const { isolation_zone } = req.body;
    const valid = ['normal', 'hbv', 'hcv', 'observation', 'last_shift'];
    if (!valid.includes(isolation_zone)) return error(res, '无效的隔离区域');

    const { rows } = await pool.query(
      `UPDATE patients SET isolation_zone = $1, updated_at = NOW()
       WHERE id = $2 RETURNING id, name, isolation_zone`,
      [isolation_zone, req.params.id]
    );
    if (rows.length === 0) return notFound(res, '患者不存在');
    return success(res, rows[0], '隔离状态已更新');
  } catch (err) { next(err); }
});

module.exports = router;
