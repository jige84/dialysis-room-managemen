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
const { encrypt } = require('../utils/encrypt');
const { success, created, paginated, error, notFound } = require('../utils/response');
const { isValidUuid, resolveResponsibleNurseId } = require('../utils/responsibleNurseUtils');
const PatientImportFacade = require('../services/PatientImportFacade');
const PatientMutationService = require('../services/PatientMutationService');
const PatientQueryService = require('../services/PatientQueryService');
const PatientDeletionService = require('../services/PatientDeletionService');
const {
  MAX_HISTORY_IMPORT_FILES,
  mapImportUploadError,
  parseDryRunFlag,
  validateBulkImportFile,
  validateHistoryImportFiles,
} = require('../validators/patientsImportValidators');
const {
  validateCreatePatientRequiredFields,
  normalizeCreateScheduleFields,
  normalizeUpdateScheduleFields,
  parseUpdateProfileDryWeight,
} = require('../validators/patientsValidators');

const consentUpload = createPatientConsentUploader();

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
    const result = await PatientQueryService.listPatients(pool, req.query);
    return paginated(res, result.list, result.total, result.page, result.pageSize);
  } catch (err) { next(err); }
});

// GET /api/patients/stats
router.get('/stats', auth, async (req, res, next) => {
  try {
    const { rows } = await PatientQueryService.getPatientStats(pool);
    return success(res, rows[0]);
  } catch (err) { next(err); }
});

// GET /api/patients/import/template — 下载标准导入表头（须早于 /:id）
router.get('/import/template', auth, rbac(['admin', 'doctor']), async (req, res, next) => {
  try {
    const buf = await PatientImportFacade.buildTemplateWorkbookBuffer();
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
      const fileValid = validateBulkImportFile(req.file);
      if (!fileValid.ok) return error(res, fileValid.message, fileValid.statusCode || 400);

      const dryRun = parseDryRunFlag(req.query);
      const result = await PatientImportFacade.importBulkTemplate(pool, fileValid.value.buffer, {
        dryRun,
        userId: req.user.id,
      });
      return success(res, result.data, result.message);
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
      const filesValid = validateHistoryImportFiles(req.files);
      if (!filesValid.ok) return error(res, filesValid.message, filesValid.statusCode || 400);

      const dryRun = parseDryRunFlag(req.query);
      const result = await PatientImportFacade.importAuto(pool, filesValid.value, {
        dryRun,
        userId: req.user.id,
      });
      return success(res, result.data, result.message);
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
      const filesValid = validateHistoryImportFiles(req.files);
      if (!filesValid.ok) return error(res, filesValid.message, filesValid.statusCode || 400);

      const dryRun = parseDryRunFlag(req.query);
      const result = await PatientImportFacade.importHistoryFolder(pool, filesValid.value, {
        dryRun,
        userId: req.user.id,
      });
      return success(res, result.data, result.message);
    } catch (err) { next(err); }
  },
);

// GET /api/patients/:id/consent-dialysis-image/:index — 按序号取第 N 张（须在无 index 路由之前注册）
router.get('/:id/consent-dialysis-image/:index', auth, async (req, res, next) => {
  try {
    if (!isValidUuid(req.params.id)) return error(res, '患者ID格式无效', 400);
    const idx = parseInt(req.params.index, 10);
    if (!Number.isFinite(idx) || idx < 0) return error(res, '无效的图片序号', 400);

    const image = await PatientQueryService.getConsentImagePath(pool, req.params.id, idx);
    if (!image.exists) return notFound(res, '患者不存在');
    const rel = image.path;
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

    const image = await PatientQueryService.getConsentImagePath(pool, req.params.id, 0);
    if (!image.exists) return notFound(res, '患者不存在');
    const rel = image.path;
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

    const patient = await PatientQueryService.getPatientDetail(pool, req.params.id, req.user.role);
    if (!patient) return notFound(res, '患者不存在');

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
      dialysis_schedule_code,
      responsible_nurse_id,
    } = req.body;

    const requiredValid = validateCreatePatientRequiredFields(req.body);
    if (!requiredValid.ok) return error(res, requiredValid.message);

    const scheduleValid = normalizeCreateScheduleFields(req.body);
    if (!scheduleValid.ok) return error(res, scheduleValid.message);
    const { scheduleNotes, scheduleAnchorDate } = scheduleValid.value;

    const rnResolved = await resolveResponsibleNurseId(pool, responsible_nurse_id);
    if (rnResolved.error) return error(res, rnResolved.error);
    if (!rnResolved.id) return error(res, '请选择责任护士');

    const { rows } = await PatientMutationService.createPatient(
      pool,
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
      ],
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

      const replaced = await PatientMutationService.replaceConsentDialysisImages(pool, req.params.id, rels);
      if (!replaced.found) {
        safeUnlinkStoredPaths(rels);
        return notFound(res, '患者不存在');
      }

      safeUnlinkStoredPaths(replaced.oldPaths);

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
      consent_dialysis, consent_dialysis_date, consent_cvc, consent_cvc_date,
      responsible_nurse_id,
    } = req.body;

    const { rows: existingPatient } = await PatientMutationService.getPatientScheduleState(pool, req.params.id);
    if (existingPatient.length === 0) return notFound(res, '患者不存在');

    const scheduleUpdateValid = normalizeUpdateScheduleFields(req.body, existingPatient[0]);
    if (!scheduleUpdateValid.ok) return error(res, scheduleUpdateValid.message);
    const {
      hasDialysisCodeKey,
      dialysisCodeVal,
      hasDialysisNotesKey,
      dialysisNotesVal,
      hasDialysisStartKey,
      dialysisStartVal,
      nextAnchor,
    } = scheduleUpdateValid.value;

    const hasRespNurseKey = Object.prototype.hasOwnProperty.call(req.body, 'responsible_nurse_id');
    let respNurseId = null;
    if (hasRespNurseKey) {
      const rn = await resolveResponsibleNurseId(pool, responsible_nurse_id);
      if (rn.error) return error(res, rn.error);
      respNurseId = rn.id;
      if (!respNurseId) return error(res, '请选择责任护士');
    }

    const profileDryValid = parseUpdateProfileDryWeight(req.body);
    if (!profileDryValid.ok) return error(res, profileDryValid.message, profileDryValid.statusCode || 400);
    const profileDryParsed = profileDryValid.value;

    const { rows } = await PatientMutationService.updatePatientCore(
      pool,
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
      ],
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
      await PatientMutationService.syncAnticoagulantProfile(pool, req.params.id, pa, prime, maint);
    }

    if (profileDryParsed) {
      const { dw, dwd, dwr } = profileDryParsed;
      await PatientMutationService.syncDryWeightProfile(pool, req.params.id, dw, dwd, dwr);
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'machine_station')) {
      const raw = req.body.machine_station;
      const normalized =
        raw != null && String(raw).trim() ? String(raw).trim().slice(0, 80) : null;
      await PatientMutationService.syncMachineStation(pool, req.params.id, normalized);
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

    const { rows } = await PatientMutationService.updatePatientStatus(
      pool,
      req.params.id,
      status,
      status_note,
      status_changed_at,
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

    const { rows } = await PatientMutationService.updatePatientIsolation(
      pool,
      req.params.id,
      isolation_zone,
    );
    if (rows.length === 0) return notFound(res, '患者不存在');
    return success(res, rows[0], '隔离状态已更新');
  } catch (err) { next(err); }
});

// DELETE /api/patients/:id
// patients:delete 权限：admin, head_nurse
router.delete('/:id', auth, rbac(['admin', 'head_nurse']), auditLog('patients', 'DELETE'), async (req, res, next) => {
  const patientId = req.params.id;
  if (!isValidUuid(patientId)) return error(res, '患者ID格式无效', 400);

  try {
    const result = await PatientDeletionService.deletePatientCascade(pool, patientId);
    if (result.notFound) return notFound(res, '患者不存在');
    safeUnlinkStoredPaths(result.consentImagePaths);
    return success(res, result.deleted, '患者档案已删除');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
