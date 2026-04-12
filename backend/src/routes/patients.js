/**
 * 患者档案 REST 路由
 * 主要作用：患者主数据与敏感信息（身份证、手机）的加密存储与脱敏展示。
 * 主要功能：分页列表与详情；新建/更新/软删除；加密字段不落日志；导出权限按 RBAC。
 */
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const { pool } = require('../config/database');
const { createPatientConsentUploader } = require('../middleware/patientConsentUpload');
const auth = require('../middleware/auth');
const { rbac } = require('../middleware/rbac');
const auditLog = require('../middleware/audit');
const { encrypt, decrypt, maskIdCard, maskPhone } = require('../utils/encrypt');
const { calcAge, formatDuration } = require('../utils/dateUtils');
const { success, created, paginated, error, notFound } = require('../utils/response');
const { isValidUuid, resolveResponsibleNurseId } = require('../utils/responsibleNurseUtils');
const PatientBulkImportService = require('../services/PatientBulkImportService');
const PatientHistoryFolderImportService = require('../services/PatientHistoryFolderImportService');
const PatientImportAutoService = require('../services/PatientImportAutoService');

const consentUpload = createPatientConsentUploader();
const MAX_HISTORY_IMPORT_FILES = 300;

function mapImportUploadError(err, fallbackMessage) {
  if (!err) return fallbackMessage;
  if (err.code === 'LIMIT_FILE_COUNT') return `单次最多上传 ${MAX_HISTORY_IMPORT_FILES} 个 Excel 文件`;
  if (err.code === 'LIMIT_FILE_SIZE') return '单个文件不能超过 5MB';
  if (err.code === 'LIMIT_UNEXPECTED_FILE') return '上传字段不正确，请使用 files 字段上传 Excel 文件';
  return err.message || fallbackMessage;
}

const patientImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const name = (file.originalname || '').toLowerCase();
    const ok =
      file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      || name.endsWith('.xlsx');
    cb(ok ? null : new Error('仅支持 .xlsx 格式'), ok);
  },
});

const patientHistoryImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: MAX_HISTORY_IMPORT_FILES,
  },
  fileFilter: (_req, file, cb) => {
    const name = (file.originalname || '').toLowerCase();
    const ok =
      file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      || name.endsWith('.xlsx');
    cb(ok ? null : new Error('仅支持 .xlsx 格式'), ok);
  },
});

/** @param {string | null | undefined} relPath */
function safeUnlinkStoredPath(relPath) {
  if (!relPath || typeof relPath !== 'string') return;
  const abs = path.join(__dirname, '../..', relPath);
  const normalized = path.normalize(abs);
  const root = path.normalize(path.join(__dirname, '../../uploads'));
  if (!normalized.startsWith(root)) return;
  fs.unlink(normalized, () => {});
}

/** @param {unknown} paths */
function normalizeConsentPaths(paths) {
  if (paths == null) return [];
  if (Array.isArray(paths)) {
    return paths.filter((p) => typeof p === 'string' && p.length > 0);
  }
  return [];
}

/** @param {unknown} paths */
function safeUnlinkStoredPaths(paths) {
  normalizeConsentPaths(paths).forEach((p) => safeUnlinkStoredPath(p));
}

/** 与 prescriptions.anticoagulant CHECK 一致 */
function normalizeProfileAnticoagulant(raw) {
  const s = raw == null || raw === '' ? 'heparin' : String(raw).trim().toLowerCase();
  if (s === 'heparin' || s === 'lmwh' || s === 'citrate' || s === 'none') return s;
  return 'heparin';
}

// GET /api/patients
router.get('/', auth, async (req, res, next) => {
  try {
    const { page = 1, page_size = 20, status, isolation_zone, keyword, dialysis_mode, ckd_stage } = req.query;
    const offset = (page - 1) * page_size;

    const conditions = ['1=1'];
    const params = [];
    let idx = 1;

    if (status)         { conditions.push(`p.status = $${idx++}`);         params.push(status); }
    if (isolation_zone) { conditions.push(`p.isolation_zone = $${idx++}`); params.push(isolation_zone); }
    if (dialysis_mode)  { conditions.push(`p.dialysis_mode = $${idx++}`);  params.push(dialysis_mode); }
    if (ckd_stage)      { conditions.push(`p.ckd_stage = $${idx++}`);      params.push(parseInt(ckd_stage, 10)); }
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
              p.profile_dry_weight,
              pr.dry_weight AS prescription_dry_weight,
              rn.real_name AS responsible_nurse_name,
              va.access_type, va.location as access_location
       FROM patients p
       LEFT JOIN users rn ON rn.id = p.responsible_nurse_id
       LEFT JOIN LATERAL (
         SELECT dry_weight FROM prescriptions
         WHERE patient_id = p.id AND is_current = true
         LIMIT 1
       ) pr ON true
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
      dialysis_age: row.dialysis_start_date ? formatDuration(row.dialysis_start_date) : '',
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

// GET /api/patients/import/template — 下载标准导入表头（须早于 /:id）
router.get('/import/template', auth, rbac(['admin', 'doctor']), async (req, res, next) => {
  try {
    const buf = await PatientBulkImportService.buildTemplateWorkbookBuffer();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename=patient_import_template.xlsx',
    );
    res.setHeader('Cache-Control', 'no-store');
    return res.send(buf);
  } catch (err) { next(err); }
});

// POST /api/patients/import — XLSX 批量导入（query: dry_run=1 仅校验）
router.post(
  '/import',
  auth,
  rbac(['admin', 'doctor']),
  (req, res, next) => {
    patientImportUpload.single('file')(req, res, (err) => {
      if (err) return error(res, err.message || '文件上传失败', 400);
      next();
    });
  },
  auditLog('patients', 'CREATE'),
  async (req, res, next) => {
    try {
      if (!req.file || !req.file.buffer) {
        return error(res, '请上传 file 字段的 .xlsx 文件', 400);
      }
      const dryRun =
        String(req.query.dry_run || '') === '1'
        || String(req.query.dry_run || '').toLowerCase() === 'true';
      const result = await PatientBulkImportService.runImport(pool, req.file.buffer, {
        dryRun,
        createdByUserId: req.user.id,
      });
      const firstId = result.imported.length ? result.imported[0].id : null;
      return success(
        res,
        {
          ...result,
          id: dryRun ? null : firstId,
        },
        dryRun ? '预检完成（未写入数据库）' : '批量导入完成',
      );
    } catch (err) { next(err); }
  },
);

// POST /api/patients/import/auto — 自动识别单文件/多文件/文件夹导入
router.post(
  '/import/auto',
  auth,
  rbac(['admin', 'doctor']),
  (req, res, next) => {
    patientHistoryImportUpload.array('files', MAX_HISTORY_IMPORT_FILES)(req, res, (err) => {
      if (err) return error(res, mapImportUploadError(err, '文件上传失败'), 400);
      next();
    });
  },
  auditLog('patients', 'CREATE'),
  async (req, res, next) => {
    try {
      const files = Array.isArray(req.files) ? req.files : [];
      if (files.length === 0) {
        return error(res, '请上传 files 字段的 .xlsx 文件', 400);
      }
      const dryRun =
        String(req.query.dry_run || '') === '1'
        || String(req.query.dry_run || '').toLowerCase() === 'true';
      const result = await PatientImportAutoService.runImport(pool, files, {
        dryRun,
        actorUserId: req.user.id,
      });
      const message =
        result.mode === 'bulk_template'
          ? (dryRun ? '标准模板预检完成（未写入数据库）' : '标准模板导入完成')
          : (dryRun ? '历史资料预检完成（未写入数据库）' : '历史资料导入完成');
      return success(res, result, message);
    } catch (err) { next(err); }
  },
);

// POST /api/patients/import/history-folder — 历史资料文件夹导入（query: dry_run=1 仅校验）
router.post(
  '/import/history-folder',
  auth,
  rbac(['admin', 'doctor']),
  (req, res, next) => {
    patientHistoryImportUpload.array('files', MAX_HISTORY_IMPORT_FILES)(req, res, (err) => {
      if (err) return error(res, mapImportUploadError(err, '文件上传失败'), 400);
      next();
    });
  },
  auditLog('patients', 'CREATE'),
  async (req, res, next) => {
    try {
      const files = Array.isArray(req.files) ? req.files : [];
      if (files.length === 0) {
        return error(res, '请上传 files 字段的 .xlsx 文件', 400);
      }
      const dryRun =
        String(req.query.dry_run || '') === '1'
        || String(req.query.dry_run || '').toLowerCase() === 'true';
      const result = await PatientHistoryFolderImportService.runImport(pool, files, {
        dryRun,
        actorUserId: req.user.id,
      });
      return success(
        res,
        result,
        dryRun ? '历史资料预检完成（未写入数据库）' : '历史资料导入完成',
      );
    } catch (err) { next(err); }
  },
);

// GET /api/patients/:id/consent-dialysis-image/:index — 按序号取第 N 张（须在无 index 路由之前注册）
router.get('/:id/consent-dialysis-image/:index', auth, async (req, res, next) => {
  try {
    if (!isValidUuid(req.params.id)) return error(res, '患者ID格式无效', 400);
    const idx = parseInt(req.params.index, 10);
    if (!Number.isFinite(idx) || idx < 0) return error(res, '无效的图片序号', 400);

    const { rows } = await pool.query(
      'SELECT consent_dialysis_image_paths FROM patients WHERE id = $1',
      [req.params.id],
    );
    if (rows.length === 0) return notFound(res, '患者不存在');
    const arr = normalizeConsentPaths(rows[0].consent_dialysis_image_paths);
    const rel = arr[idx];
    if (!rel) return error(res, '暂无知情同意书影像', 404);

    const abs = path.join(__dirname, '../..', rel);
    const normalized = path.normalize(abs);
    const root = path.normalize(path.join(__dirname, '../../uploads'));
    if (!normalized.startsWith(root)) return error(res, '无效路径', 400);

    res.setHeader('Cache-Control', 'private, no-store');
    res.sendFile(normalized, (err) => {
      if (err) next(err);
    });
  } catch (err) { next(err); }
});

// GET /api/patients/:id/consent-dialysis-image — 兼容：返回第 0 张
router.get('/:id/consent-dialysis-image', auth, async (req, res, next) => {
  try {
    if (!isValidUuid(req.params.id)) return error(res, '患者ID格式无效', 400);

    const { rows } = await pool.query(
      'SELECT consent_dialysis_image_paths FROM patients WHERE id = $1',
      [req.params.id],
    );
    if (rows.length === 0) return notFound(res, '患者不存在');
    const arr = normalizeConsentPaths(rows[0].consent_dialysis_image_paths);
    const rel = arr[0];
    if (!rel) return error(res, '暂无知情同意书影像', 404);

    const abs = path.join(__dirname, '../..', rel);
    const normalized = path.normalize(abs);
    const root = path.normalize(path.join(__dirname, '../../uploads'));
    if (!normalized.startsWith(root)) return error(res, '无效路径', 400);

    res.setHeader('Cache-Control', 'private, no-store');
    res.sendFile(normalized, (err) => {
      if (err) next(err);
    });
  } catch (err) { next(err); }
});

// GET /api/patients/:id
router.get('/:id', auth, async (req, res, next) => {
  try {
    if (!isValidUuid(req.params.id)) return error(res, '患者ID格式无效', 400);

    const { rows } = await pool.query(
      `SELECT p.*,
              rn.real_name AS responsible_nurse_name,
              pr.id as rx_id, pr.frequency_per_week, pr.duration_hours, pr.dialyzer_model,
              pr.dry_weight, pr.dry_weight_date, pr.dry_weight_reason, pr.anticoagulant,
              pr.heparin_prime_dose, pr.heparin_maintain,
              pr.dialysate_na, pr.dialysate_ca, pr.dialysate_k, pr.dialysate_temp,
              pr.blood_flow_rate, pr.dialysate_flow_rate
       FROM patients p
       LEFT JOIN users rn ON rn.id = p.responsible_nurse_id
       LEFT JOIN prescriptions pr ON pr.patient_id = p.id AND pr.is_current = true
       WHERE p.id = $1`,
      [req.params.id]
    );

    if (rows.length === 0) return notFound(res, '患者不存在');

    const patient = rows[0];

    // 解密并脱敏（管理员/护士长可看完整）
    const isPrivileged = ['admin', 'head_nurse'].includes(req.user.role);
    patient.age = calcAge(patient.dob);
    patient.dialysis_age = patient.dialysis_start_date
      ? formatDuration(patient.dialysis_start_date)
      : '';
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

    // 传染病筛查最新结果摘要（每种检测类型取最近一次）
    const { rows: screenRows } = await pool.query(
      `SELECT DISTINCT ON (test_type)
         test_type, result, test_date, next_due_date
       FROM infection_screenings
       WHERE patient_id = $1
       ORDER BY test_type, test_date DESC`,
      [req.params.id]
    );
    patient.infection_screenings_summary = screenRows;

    // 知情同意子对象（方便前端渲染）
    patient.consents = {
      dialysis: patient.consent_dialysis || false,
      dialysis_date: patient.consent_dialysis_date || null,
      cvc: patient.consent_cvc || false,
      cvc_date: patient.consent_cvc_date || null,
    };

    return success(res, patient);
  } catch (err) { next(err); }
});

// POST /api/patients
// patients:create 权限：admin, doctor（规范不含 head_nurse）
router.post('/', auth, rbac(['admin', 'doctor']), auditLog('patients', 'CREATE'), async (req, res, next) => {
  try {
    const {
      name, gender, dob, id_card, phone, family_contact, address,
      primary_diagnosis, present_illness, past_history, ckd_stage, comorbidities,
      dialysis_start_date, dialysis_mode, isolation_zone,
      consent_dialysis, consent_dialysis_date,
      dialysis_schedule_code, dialysis_schedule_notes, dialysis_schedule_anchor_date,
      responsible_nurse_id,
    } = req.body;

    if (!name || !gender || !dob || !dialysis_start_date || !primary_diagnosis) {
      return error(res, '姓名、性别、出生日期、开始透析日期、诊断为必填项');
    }

    const scheduleNotes = typeof dialysis_schedule_notes === 'string'
      ? dialysis_schedule_notes.trim() || null
      : null;

    const anchorStr = dialysis_schedule_anchor_date != null && String(dialysis_schedule_anchor_date).trim()
      ? String(dialysis_schedule_anchor_date).trim().slice(0, 10)
      : null;
    if (dialysis_schedule_code === 'qod' && !anchorStr) {
      return error(res, '选择隔日透析时请填写隔日锚点日期');
    }
    const scheduleAnchorDate = dialysis_schedule_code === 'qod' ? anchorStr : null;

    const rnResolved = await resolveResponsibleNurseId(pool, responsible_nurse_id);
    if (rnResolved.error) return error(res, rnResolved.error);
    if (!rnResolved.id) return error(res, '请选择责任护士');

    const { rows } = await pool.query(
      `INSERT INTO patients (
         name, gender, dob,
         id_card_encrypted, phone_encrypted,
         family_contact, address,
         primary_diagnosis, present_illness, past_history, ckd_stage, comorbidities,
         dialysis_start_date, dialysis_mode,
         isolation_zone,
         consent_dialysis, consent_dialysis_date,
         dialysis_schedule_code, dialysis_schedule_notes, dialysis_schedule_anchor_date,
         responsible_nurse_id,
         created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       RETURNING id, name, gender, dob, primary_diagnosis, status, dialysis_start_date`,
      [
        name, gender, dob,
        id_card ? encrypt(id_card) : null,
        phone ? encrypt(phone) : null,
        family_contact ? JSON.stringify(family_contact) : null,
        address,
        primary_diagnosis, present_illness || null, past_history || null, ckd_stage,
        comorbidities || null,
        dialysis_start_date, dialysis_mode || 'HD',
        isolation_zone || 'normal',
        consent_dialysis || false, consent_dialysis_date || null,
        dialysis_schedule_code || null,
        scheduleNotes,
        scheduleAnchorDate,
        rnResolved.id,
        req.user.id
      ]
    );

    return created(res, rows[0], '患者档案创建成功');
  } catch (err) { next(err); }
});

// POST /api/patients/:id/consent-dialysis-image — 上传 1～15 张（files 字段；单文件 field name=file 兼容）
router.post(
  '/:id/consent-dialysis-image',
  auth,
  rbac(['admin', 'doctor']),
  auditLog('patients', 'UPDATE'),
  (req, res, next) => {
    consentUpload.array('files', 15)(req, res, (err) => {
      if (err) return next(err);
      next();
    });
  },
  async (req, res, next) => {
    try {
      if (!isValidUuid(req.params.id)) return error(res, '患者ID格式无效', 400);

      const uploaded = Array.isArray(req.files) ? req.files : [];
      if (uploaded.length === 0) return error(res, '请上传至少一张图片（可多选）', 400);

      const rels = uploaded.map((f) =>
        path.join('uploads', 'patient-consents', req.params.id, f.filename).replace(/\\/g, '/'),
      );

      const { rows: exists } = await pool.query(
        'SELECT consent_dialysis_image_paths FROM patients WHERE id = $1',
        [req.params.id],
      );
      if (exists.length === 0) {
        safeUnlinkStoredPaths(rels);
        return notFound(res, '患者不存在');
      }

      const oldPaths = exists[0].consent_dialysis_image_paths;
      safeUnlinkStoredPaths(oldPaths);

      await pool.query(
        `UPDATE patients SET consent_dialysis_image_paths = $1::jsonb, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(rels), req.params.id],
      );

      return success(res, { consent_dialysis_image_paths: rels }, '知情同意书图片已保存');
    } catch (err) { next(err); }
  },
);

// PUT /api/patients/:id
// patients:update 权限：admin, doctor（规范不含 head_nurse）
router.put('/:id', auth, rbac(['admin', 'doctor']), auditLog('patients', 'UPDATE'), async (req, res, next) => {
  try {
    if (!isValidUuid(req.params.id)) return error(res, '患者ID格式无效', 400);

    const {
      name, gender, dob, id_card, phone, family_contact, address,
      primary_diagnosis, present_illness, past_history, ckd_stage, comorbidities, dialysis_mode,
      dialysis_start_date,
      consent_dialysis, consent_dialysis_date, consent_cvc, consent_cvc_date,
      dialysis_schedule_code, dialysis_schedule_notes,
      responsible_nurse_id,
    } = req.body;

    const { rows: existingPatient } = await pool.query(
      'SELECT dialysis_schedule_code, dialysis_schedule_anchor_date FROM patients WHERE id = $1',
      [req.params.id],
    );
    if (existingPatient.length === 0) return notFound(res, '患者不存在');

    const hasDialysisCodeKey = Object.prototype.hasOwnProperty.call(req.body, 'dialysis_schedule_code');
    const dialysisCodeVal = hasDialysisCodeKey
      ? (typeof dialysis_schedule_code === 'string' ? dialysis_schedule_code.trim() || null : null)
      : null;

    const hasDialysisNotesKey = Object.prototype.hasOwnProperty.call(req.body, 'dialysis_schedule_notes');
    const dialysisNotesVal = hasDialysisNotesKey
      ? (typeof dialysis_schedule_notes === 'string' ? dialysis_schedule_notes.trim() || null : null)
      : null;

    const hasRespNurseKey = Object.prototype.hasOwnProperty.call(req.body, 'responsible_nurse_id');
    let respNurseId = null;
    if (hasRespNurseKey) {
      const rn = await resolveResponsibleNurseId(pool, responsible_nurse_id);
      if (rn.error) return error(res, rn.error);
      respNurseId = rn.id;
      if (!respNurseId) return error(res, '请选择责任护士');
    }

    const hasDialysisStartKey = Object.prototype.hasOwnProperty.call(req.body, 'dialysis_start_date');
    const dialysisStartVal = hasDialysisStartKey
      ? (
          dialysis_start_date != null && String(dialysis_start_date).trim()
            ? String(dialysis_start_date).trim().slice(0, 10)
            : null
        )
      : null;

    const ex = existingPatient[0];
    const nextDialysisCode = hasDialysisCodeKey ? dialysisCodeVal : ex.dialysis_schedule_code;
    const hasAnchorKey = Object.prototype.hasOwnProperty.call(req.body, 'dialysis_schedule_anchor_date');
    let nextAnchor = ex.dialysis_schedule_anchor_date;
    if (hasDialysisCodeKey && dialysisCodeVal !== 'qod') {
      nextAnchor = null;
    } else if (hasAnchorKey) {
      const raw = req.body.dialysis_schedule_anchor_date;
      nextAnchor = raw != null && String(raw).trim()
        ? String(raw).trim().slice(0, 10)
        : null;
    }
    if (nextDialysisCode === 'qod' && !nextAnchor) {
      return error(res, '选择隔日透析时请填写隔日锚点日期');
    }

    const hasProfileDryKey = Object.prototype.hasOwnProperty.call(req.body, 'profile_dry_weight');
    /** @type {{ dw: number, dwd: string, dwr: string | null } | null} */
    let profileDryParsed = null;
    if (hasProfileDryKey) {
      const rawDw = req.body.profile_dry_weight;
      if (rawDw === null || rawDw === undefined || rawDw === '') {
        return error(res, '干体重为必填项', 400);
      }
      const dw = parseFloat(String(rawDw));
      if (!Number.isFinite(dw) || dw < 20 || dw > 200) {
        return error(res, '干体重须在 20–200 kg 范围内', 400);
      }
      const rawDate = req.body.profile_dry_weight_date;
      const dwd =
        rawDate != null && String(rawDate).trim()
          ? String(rawDate).trim().slice(0, 10)
          : null;
      if (!dwd) {
        return error(res, '干体重评估日期为必填项', 400);
      }
      const dwr =
        req.body.profile_dry_weight_reason != null && String(req.body.profile_dry_weight_reason).trim()
          ? String(req.body.profile_dry_weight_reason).trim().slice(0, 2000)
          : null;
      profileDryParsed = { dw, dwd, dwr };
    }

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
         present_illness = COALESCE($9, present_illness),
         past_history = COALESCE($10, past_history),
         ckd_stage = COALESCE($11, ckd_stage),
         comorbidities = COALESCE($12, comorbidities),
         dialysis_mode = COALESCE($13, dialysis_mode),
         dialysis_start_date = CASE WHEN $14::boolean THEN $15::date ELSE dialysis_start_date END,
         consent_dialysis = COALESCE($16, consent_dialysis),
         consent_dialysis_date = CASE
           WHEN $16 = false THEN NULL
           WHEN $17::date IS NOT NULL THEN $17
           ELSE consent_dialysis_date
         END,
         consent_cvc = COALESCE($18, consent_cvc),
         consent_cvc_date = CASE
           WHEN $18 = false THEN NULL
           WHEN $19::date IS NOT NULL THEN $19
           ELSE consent_cvc_date
         END,
         dialysis_schedule_code = CASE WHEN $21::boolean THEN $20::varchar ELSE dialysis_schedule_code END,
         dialysis_schedule_notes = CASE WHEN $23::boolean THEN $22::text ELSE dialysis_schedule_notes END,
         responsible_nurse_id = CASE WHEN $25::boolean THEN $24::uuid ELSE responsible_nurse_id END,
         dialysis_schedule_anchor_date = $26::date,
         updated_at = NOW()
       WHERE id = $27
       RETURNING id, name, gender, status`,
      [
        name, gender, dob,
        id_card ? encrypt(id_card) : null,
        phone ? encrypt(phone) : null,
        family_contact ? JSON.stringify(family_contact) : null,
        address, primary_diagnosis, present_illness || null, past_history || null, ckd_stage,
        comorbidities || null,
        dialysis_mode,
        hasDialysisStartKey,
        dialysisStartVal,
        consent_dialysis ?? null,
        consent_dialysis_date || null,
        consent_cvc ?? null,
        consent_cvc_date ?? null,
        dialysisCodeVal,
        hasDialysisCodeKey,
        dialysisNotesVal,
        hasDialysisNotesKey,
        respNurseId,
        hasRespNurseKey,
        nextAnchor,
        req.params.id
      ]
    );

    if (rows.length === 0) return notFound(res, '患者不存在');

    const hasProfileAnticoagKey = Object.prototype.hasOwnProperty.call(req.body, 'profile_anticoagulant');
    if (hasProfileAnticoagKey) {
      const pa = normalizeProfileAnticoagulant(req.body.profile_anticoagulant);
      let prime = null;
      let maint = null;
      if (req.body.profile_heparin_prime_dose != null && req.body.profile_heparin_prime_dose !== '') {
        const n = parseInt(String(req.body.profile_heparin_prime_dose), 10);
        prime = Number.isFinite(n) ? n : null;
      }
      if (req.body.profile_heparin_maintain != null && req.body.profile_heparin_maintain !== '') {
        const f = parseFloat(String(req.body.profile_heparin_maintain));
        maint = Number.isFinite(f) ? f : null;
      }
      await pool.query(
        `UPDATE patients SET profile_anticoagulant = $1, profile_heparin_prime_dose = $2,
            profile_heparin_maintain = $3, updated_at = NOW()
         WHERE id = $4`,
        [pa, prime, maint, req.params.id],
      );
      await pool.query(
        `UPDATE prescriptions SET anticoagulant = $1, heparin_prime_dose = $2, heparin_maintain = $3, updated_at = NOW()
         WHERE patient_id = $4 AND is_current = true`,
        [pa, prime, maint, req.params.id],
      );
    }

    if (profileDryParsed) {
      const { dw, dwd, dwr } = profileDryParsed;
      await pool.query(
        `UPDATE patients SET profile_dry_weight = $1, profile_dry_weight_date = $2::date,
            profile_dry_weight_reason = $3, updated_at = NOW()
         WHERE id = $4`,
        [dw, dwd, dwr, req.params.id],
      );
      await pool.query(
        `UPDATE prescriptions SET dry_weight = $1, dry_weight_date = $2::date, dry_weight_reason = $3, updated_at = NOW()
         WHERE patient_id = $4 AND is_current = true`,
        [dw, dwd, dwr, req.params.id],
      );
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'machine_station')) {
      const raw = req.body.machine_station;
      const normalized =
        raw != null && String(raw).trim() ? String(raw).trim().slice(0, 80) : null;
      try {
        await pool.query(
          `UPDATE patients SET machine_station = $1, updated_at = NOW() WHERE id = $2`,
          [normalized, req.params.id],
        );
        await pool.query(
          `UPDATE schedules SET machine_station = $1 WHERE patient_id = $2`,
          [normalized, req.params.id],
        );
      } catch (syncErr) {
        if (!syncErr || syncErr.code !== '42703') throw syncErr;
      }
    }

    return success(res, rows[0], '患者信息更新成功');
  } catch (err) { next(err); }
});

// PATCH /api/patients/:id/status
// patients:update 权限：admin, doctor
router.patch('/:id/status', auth, rbac(['admin', 'doctor']), auditLog('patients', 'UPDATE'), async (req, res, next) => {
  try {
    if (!isValidUuid(req.params.id)) return error(res, '患者ID格式无效', 400);

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
    if (!isValidUuid(req.params.id)) return error(res, '患者ID格式无效', 400);

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
