/**
 * 历史患者 XLSX 批量导入
 * 主要作用：解析首行表头、映射中英列名、校验必填与枚举；dry-run 预览；正式导入时加密敏感字段并写入 patients。
 */
const ExcelJS = require('exceljs');
const { encrypt } = require('../utils/encrypt');
const {
  resolveResponsibleNurseId,
  resolveResponsibleNurseByRealName,
} = require('../utils/responsibleNurseUtils');

const MAX_ROWS = 2000;

/** 与前端 DIALYSIS_SCHEDULE_OPTIONS value 一致 */
const ALLOWED_SCHEDULE_CODES = new Set([
  'tiw_mwf_morning',
  'tiw_mwf_afternoon',
  'tiw_mwf_evening',
  'tiw_tts_morning',
  'tiw_tts_afternoon',
  'tiw_tts_evening',
  'biw5_alt',
  'qod',
  'other',
]);

const ALLOWED_ISOLATION = new Set(['normal', 'hbv', 'hcv', 'observation', 'last_shift']);

const ALLOWED_ANTICOAG = new Set(['heparin', 'lmwh', 'citrate', 'none']);

/**
 * 表头别名 → 内部字段名（normalizeHeader 后匹配）
 * @type {Record<string, string>}
 */
const HEADER_SYNONYMS = {
  name: 'name',
  姓名: 'name',
  患者姓名: 'name',
  gender: 'gender',
  性别: 'gender',
  dob: 'dob',
  出生日期: 'dob',
  birthday: 'dob',
  id_card: 'id_card',
  身份证: 'id_card',
  身份证号: 'id_card',
  phone: 'phone',
  手机: 'phone',
  电话: 'phone',
  address: 'address',
  地址: 'address',
  primary_diagnosis: 'primary_diagnosis',
  主要诊断: 'primary_diagnosis',
  诊断: 'primary_diagnosis',
  present_illness: 'present_illness',
  现病史: 'present_illness',
  past_history: 'past_history',
  既往史: 'past_history',
  ckd_stage: 'ckd_stage',
  ckdstage: 'ckd_stage',
  ckd分期: 'ckd_stage',
  comorbidities: 'comorbidities',
  合并症: 'comorbidities',
  dialysis_start_date: 'dialysis_start_date',
  开始透析日期: 'dialysis_start_date',
  透析开始日期: 'dialysis_start_date',
  dialysis_mode: 'dialysis_mode',
  透析模式: 'dialysis_mode',
  isolation_zone: 'isolation_zone',
  隔离区: 'isolation_zone',
  consent_dialysis: 'consent_dialysis',
  透析知情同意: 'consent_dialysis',
  consent_dialysis_date: 'consent_dialysis_date',
  透析知情签署日期: 'consent_dialysis_date',
  consent_cvc: 'consent_cvc',
  consent_cvc_date: 'consent_cvc_date',
  dialysis_schedule_code: 'dialysis_schedule_code',
  透析排班代码: 'dialysis_schedule_code',
  dialysis_schedule_notes: 'dialysis_schedule_notes',
  透析排班说明: 'dialysis_schedule_notes',
  dialysis_schedule_anchor_date: 'dialysis_schedule_anchor_date',
  隔日锚点日期: 'dialysis_schedule_anchor_date',
  machine_station: 'machine_station',
  机位: 'machine_station',
  responsible_nurse_id: 'responsible_nurse_id',
  责任护士id: 'responsible_nurse_id',
  责任护士uuid: 'responsible_nurse_id',
  responsible_nurse_name: 'responsible_nurse_name',
  责任护士: 'responsible_nurse_name',
  责任护士姓名: 'responsible_nurse_name',
  profile_anticoagulant: 'profile_anticoagulant',
  profile_heparin_prime_dose: 'profile_heparin_prime_dose',
  profile_heparin_maintain: 'profile_heparin_maintain',
  profile_dry_weight: 'profile_dry_weight',
  干体重: 'profile_dry_weight',
  profile_dry_weight_date: 'profile_dry_weight_date',
  干体重评估日期: 'profile_dry_weight_date',
  profile_dry_weight_reason: 'profile_dry_weight_reason',
  family_contact_name: 'family_contact_name',
  家属姓名: 'family_contact_name',
  family_contact_phone: 'family_contact_phone',
  家属电话: 'family_contact_phone',
};

function normalizeHeaderKey(cellValue) {
  if (cellValue == null || cellValue === '') return '';
  const s = String(cellValue).trim();
  const compact = s.replace(/\s+/g, '').toLowerCase();
  const noSpaceLower = s.replace(/\s+/g, '_').toLowerCase();
  if (HEADER_SYNONYMS[s]) return HEADER_SYNONYMS[s];
  if (HEADER_SYNONYMS[compact]) return HEADER_SYNONYMS[compact];
  if (HEADER_SYNONYMS[noSpaceLower]) return HEADER_SYNONYMS[noSpaceLower];
  if (HEADER_SYNONYMS[s.toLowerCase()]) return HEADER_SYNONYMS[s.toLowerCase()];
  return noSpaceLower;
}

/**
 * @param {unknown} v
 * @returns {string}
 */
function cellToString(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (Number.isInteger(v) && Math.abs(v) > 40000) return String(v);
    return String(v);
  }
  if (v instanceof Date) return formatLocalDate(v);
  return String(v).trim();
}

/**
 * @param {Date} d
 * @returns {string}
 */
function formatLocalDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Excel 序列日或字符串 → YYYY-MM-DD
 * @param {unknown} v
 * @returns {string}
 */
function parseDateCell(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date) return formatLocalDate(v);
  if (typeof v === 'number' && Number.isFinite(v) && v > 20000 && v < 80000) {
    const epoch = Date.UTC(1899, 11, 30);
    const ms = epoch + v * 86400000;
    const d = new Date(ms);
    return formatLocalDate(d);
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) {
    const y = m[1];
    const mo = m[2].padStart(2, '0');
    const da = m[3].padStart(2, '0');
    return `${y}-${mo}-${da}`;
  }
  return '';
}

/**
 * @param {unknown} raw
 * @returns {'M'|'F'|null}
 */
function parseGender(raw) {
  const s = cellToString(raw).toLowerCase();
  if (!s) return null;
  if (['m', '男', '1', 'male'].includes(s)) return 'M';
  if (['f', '女', '2', 'female'].includes(s)) return 'F';
  return null;
}

/**
 * @param {unknown} raw
 * @returns {boolean | null}
 */
function parseBool(raw) {
  if (raw === true || raw === false) return raw;
  const s = cellToString(raw).toLowerCase();
  if (!s) return null;
  if (['1', 'true', 'yes', 'y', '是'].includes(s)) return true;
  if (['0', 'false', 'no', 'n', '否'].includes(s)) return false;
  return null;
}

/**
 * @param {unknown} raw
 * @returns {string|null}
 */
function parseIsolationZone(raw) {
  const s = cellToString(raw).toLowerCase();
  if (!s) return 'normal';
  const map = {
    阴性: 'normal',
    普通: 'normal',
    normal: 'normal',
    乙肝: 'hbv',
    hbsag: 'hbv',
    hbv: 'hbv',
    丙肝: 'hcv',
    hcv: 'hcv',
    观察: 'observation',
    observation: 'observation',
    末班: 'last_shift',
    last_shift: 'last_shift',
  };
  const hit = map[s];
  if (hit && ALLOWED_ISOLATION.has(hit)) return hit;
  if (ALLOWED_ISOLATION.has(s)) return s;
  return null;
}

/**
 * @param {unknown} raw
 * @returns {string[]|null}
 */
function parseComorbidities(raw) {
  const s = cellToString(raw);
  if (!s) return null;
  const parts = s.split(/[,，、|;/]/).map((x) => x.trim()).filter(Boolean);
  return parts.length ? parts : null;
}

/**
 * @param {Record<string, string>} row
 * @param {import('pg').Pool} pool
 * @returns {Promise<{ ok: boolean, payload?: object, errors: string[] }>}
 */
async function validateAndBuildPayload(row, pool) {
  const errors = [];
  const name = cellToString(row.name);
  if (!name) errors.push('姓名必填');

  const gender = parseGender(row.gender);
  if (!gender) errors.push('性别须为 M/F 或 男/女');

  const dob = parseDateCell(row.dob);
  if (!dob) errors.push('出生日期无效或为空');

  const dialysisStart = parseDateCell(row.dialysis_start_date);
  if (!dialysisStart) errors.push('开始透析日期无效或为空');

  const primary = cellToString(row.primary_diagnosis);
  if (!primary) errors.push('主要诊断必填');

  let nurseId = null;
  const idRaw = cellToString(row.responsible_nurse_id);
  const nameRaw = cellToString(row.responsible_nurse_name);
  if (idRaw) {
    const r = await resolveResponsibleNurseId(pool, idRaw);
    if (r.error) errors.push(r.error);
    else nurseId = r.id;
  } else if (nameRaw) {
    const r = await resolveResponsibleNurseByRealName(pool, nameRaw);
    if (r.error) errors.push(r.error);
    else nurseId = r.id;
  } else {
    errors.push('须填写责任护士ID或责任护士姓名');
  }

  let ckdStage = null;
  if (row.ckd_stage !== undefined && cellToString(row.ckd_stage) !== '') {
    const n = parseInt(cellToString(row.ckd_stage), 10);
    if (!Number.isFinite(n) || n < 1 || n > 5) errors.push('CKD分期须为1-5');
    else ckdStage = n;
  }

  const iso = parseIsolationZone(row.isolation_zone);
  if (iso === null) errors.push('隔离区枚举无效');

  let scheduleCode = cellToString(row.dialysis_schedule_code) || null;
  if (scheduleCode && !ALLOWED_SCHEDULE_CODES.has(scheduleCode)) {
    errors.push('透析排班代码不在允许列表内');
  }

  const anchorStr = row.dialysis_schedule_anchor_date
    ? parseDateCell(row.dialysis_schedule_anchor_date)
    : '';
  const scheduleAnchor = scheduleCode === 'qod' ? (anchorStr || null) : null;
  if (scheduleCode === 'qod' && !scheduleAnchor) {
    errors.push('隔日透析须填写隔日锚点日期');
  }

  const scheduleNotes = cellToString(row.dialysis_schedule_notes) || null;

  let profileAnticoagulant = 'heparin';
  if (cellToString(row.profile_anticoagulant)) {
    const a = cellToString(row.profile_anticoagulant).toLowerCase();
    if (!ALLOWED_ANTICOAG.has(a)) errors.push('档案抗凝方案无效');
    else profileAnticoagulant = a;
  }

  let profileHeparinPrime = null;
  if (cellToString(row.profile_heparin_prime_dose) !== '') {
    const n = parseInt(cellToString(row.profile_heparin_prime_dose), 10);
    if (!Number.isFinite(n) || n < 0) errors.push('肝素首剂须为非负整数');
    else profileHeparinPrime = n;
  }

  let profileHeparinMaintain = null;
  if (cellToString(row.profile_heparin_maintain) !== '') {
    const n = parseFloat(cellToString(row.profile_heparin_maintain));
    if (!Number.isFinite(n) || n < 0) errors.push('肝素维持量无效');
    else profileHeparinMaintain = n;
  }

  let profileDryWeight = null;
  if (cellToString(row.profile_dry_weight) !== '') {
    const n = parseFloat(cellToString(row.profile_dry_weight));
    if (!Number.isFinite(n) || n <= 0 || n > 200) errors.push('干体重须在合理范围');
    else profileDryWeight = n;
  }

  const profileDryWeightDate = cellToString(row.profile_dry_weight_date)
    ? parseDateCell(row.profile_dry_weight_date)
    : null;
  if (cellToString(row.profile_dry_weight_date) && !profileDryWeightDate) {
    errors.push('干体重评估日期格式无效');
  }

  const profileDryWeightReason = cellToString(row.profile_dry_weight_reason) || null;

  const consentDialysis = parseBool(row.consent_dialysis);
  const consentDialysisDate = cellToString(row.consent_dialysis_date)
    ? parseDateCell(row.consent_dialysis_date)
    : null;
  if (cellToString(row.consent_dialysis_date) && !consentDialysisDate) {
    errors.push('透析知情签署日期格式无效');
  }

  const consentCvc = parseBool(row.consent_cvc);
  const consentCvcDate = cellToString(row.consent_cvc_date)
    ? parseDateCell(row.consent_cvc_date)
    : null;
  if (cellToString(row.consent_cvc_date) && !consentCvcDate) {
    errors.push('CVC知情签署日期格式无效');
  }

  const fcName = cellToString(row.family_contact_name);
  const fcPhone = cellToString(row.family_contact_phone);
  /** @type {{ name?: string, phone?: string } | null} */
  let familyContact = null;
  if (fcName || fcPhone) {
    familyContact = {};
    if (fcName) familyContact.name = fcName;
    if (fcPhone) familyContact.phone = fcPhone;
  }

  const idCard = cellToString(row.id_card) || null;
  const phone = cellToString(row.phone) || null;

  if (errors.length) return { ok: false, errors };

  const payload = {
    name,
    gender,
    dob,
    dialysis_start_date: dialysisStart,
    primary_diagnosis: primary,
    responsible_nurse_id: nurseId,
    id_card: idCard,
    phone,
    address: cellToString(row.address) || null,
    present_illness: cellToString(row.present_illness) || null,
    past_history: cellToString(row.past_history) || null,
    ckd_stage: ckdStage,
    comorbidities: parseComorbidities(row.comorbidities),
    dialysis_mode: cellToString(row.dialysis_mode) || 'HD',
    isolation_zone: iso || 'normal',
    consent_dialysis: consentDialysis ?? false,
    consent_dialysis_date: consentDialysisDate,
    consent_cvc: consentCvc ?? false,
    consent_cvc_date: consentCvcDate,
    dialysis_schedule_code: scheduleCode,
    dialysis_schedule_notes: scheduleNotes,
    dialysis_schedule_anchor_date: scheduleAnchor,
    machine_station: cellToString(row.machine_station) || null,
    profile_anticoagulant: profileAnticoagulant,
    profile_heparin_prime_dose: profileHeparinPrime,
    profile_heparin_maintain: profileHeparinMaintain,
    profile_dry_weight: profileDryWeight,
    profile_dry_weight_date: profileDryWeightDate,
    profile_dry_weight_reason: profileDryWeightReason,
    family_contact: familyContact,
  };

  return { ok: true, payload, errors: [] };
}

/**
 * @param {Buffer} buffer
 * @returns {Promise<{ headerMap: Map<number, string>, dataRows: Record<string, string>[] }>}
 */
async function parseSpreadsheet(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new Error('工作簿中无工作表');
  }

  let headerRowNum = 1;
  const headerRow = sheet.getRow(headerRowNum);
  /** @type {Map<number, string>} */
  const headerMap = new Map();
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    let hv = cell.value;
    if (hv && typeof hv === 'object' && 'richText' in hv && Array.isArray(hv.richText)) {
      hv = hv.richText.map((p) => p.text).join('');
    }
    const key = normalizeHeaderKey(hv);
    if (key) headerMap.set(colNumber, key);
  });

  if (headerMap.size === 0) {
    throw new Error('首行表头为空');
  }

  const dataRows = [];
  const maxRow = sheet.rowCount;
  for (let r = headerRowNum + 1; r <= maxRow; r += 1) {
    const row = sheet.getRow(r);
    let any = false;
    const obj = {};
    headerMap.forEach((field, col) => {
      const c = row.getCell(col);
      let v = c.value;
      if (v && typeof v === 'object' && 'richText' in v && Array.isArray(v.richText)) {
        v = v.richText.map((p) => p.text).join('');
      }
      if (v && typeof v === 'object' && 'text' in v) {
        v = v.text;
      }
      if (v && typeof v === 'object' && 'result' in v) {
        v = c.result;
      }
      const s = cellToString(v);
      if (s) any = true;
      obj[field] = s;
    });
    if (any) dataRows.push(obj);
    if (dataRows.length > MAX_ROWS) {
      throw new Error(`超过最大行数限制（${MAX_ROWS}）`);
    }
  }

  return { headerMap, dataRows };
}

/**
 * 判断工作簿是否为标准模板导入格式。
 * 规则保持轻量：至少包含患者模板的核心字段，且不是历史资料的散表。
 * @param {Buffer} buffer
 * @returns {Promise<boolean>}
 */
async function detectTemplateWorkbook(buffer) {
  const { headerMap } = await parseSpreadsheet(buffer);
  const keys = new Set(Array.from(headerMap.values()));
  const required = ['name', 'gender', 'dob', 'dialysis_start_date', 'primary_diagnosis'];
  const hasRequired = required.every((key) => keys.has(key));
  const hasResponsibleNurse = keys.has('responsible_nurse_id') || keys.has('responsible_nurse_name');
  return hasRequired && hasResponsibleNurse;
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} name
 * @param {string} dob
 * @returns {Promise<boolean>}
 */
async function isDuplicateActivePatient(pool, name, dob) {
  const { rows } = await pool.query(
    `SELECT 1 FROM patients
     WHERE name = $1 AND dob = $2 AND status = 'active' LIMIT 1`,
    [name, dob],
  );
  return rows.length > 0;
}

/**
 * @param {import('pg').Pool} pool
 * @param {object} payload
 * @param {string} createdByUserId
 */
async function insertPatientRow(pool, payload, createdByUserId) {
  const {
    name,
    gender,
    dob,
    dialysis_start_date,
    primary_diagnosis,
    responsible_nurse_id,
    id_card,
    phone,
    address,
    present_illness,
    past_history,
    ckd_stage,
    comorbidities,
    dialysis_mode,
    isolation_zone,
    consent_dialysis,
    consent_dialysis_date,
    consent_cvc,
    consent_cvc_date,
    dialysis_schedule_code,
    dialysis_schedule_notes,
    dialysis_schedule_anchor_date,
    machine_station,
    profile_anticoagulant,
    profile_heparin_prime_dose,
    profile_heparin_maintain,
    profile_dry_weight,
    profile_dry_weight_date,
    profile_dry_weight_reason,
    family_contact: familyContactObj,
  } = payload;

  const familyContactParam = familyContactObj ? JSON.stringify(familyContactObj) : null;

  const { rows } = await pool.query(
    `INSERT INTO patients (
       name, gender, dob,
       id_card_encrypted, phone_encrypted,
       family_contact, address,
       primary_diagnosis, present_illness, past_history, ckd_stage, comorbidities,
       dialysis_start_date, dialysis_mode,
       isolation_zone,
       consent_dialysis, consent_dialysis_date,
       consent_cvc, consent_cvc_date,
       dialysis_schedule_code, dialysis_schedule_notes, dialysis_schedule_anchor_date,
       machine_station,
       profile_anticoagulant, profile_heparin_prime_dose, profile_heparin_maintain,
       profile_dry_weight, profile_dry_weight_date, profile_dry_weight_reason,
       responsible_nurse_id,
       created_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31
     )
     RETURNING id, name`,
    [
      name,
      gender,
      dob,
      id_card ? encrypt(id_card) : null,
      phone ? encrypt(phone) : null,
      familyContactParam,
      address,
      primary_diagnosis,
      present_illness,
      past_history,
      ckd_stage,
      comorbidities,
      dialysis_start_date,
      dialysis_mode,
      isolation_zone,
      consent_dialysis,
      consent_dialysis_date,
      consent_cvc,
      consent_cvc_date,
      dialysis_schedule_code,
      dialysis_schedule_notes,
      dialysis_schedule_anchor_date,
      machine_station,
      profile_anticoagulant,
      profile_heparin_prime_dose,
      profile_heparin_maintain,
      profile_dry_weight,
      profile_dry_weight_date,
      profile_dry_weight_reason,
      responsible_nurse_id,
      createdByUserId,
    ],
  );
  return rows[0];
}

/**
 * @param {import('pg').Pool} pool
 * @param {Buffer} buffer
 * @param {{ dryRun: boolean, createdByUserId: string }} options
 */
async function runImport(pool, buffer, options) {
  const { dryRun, createdByUserId } = options;
  const { dataRows } = await parseSpreadsheet(buffer);

  /** @type {{ rowIndex: number, name?: string, errors: string[] }[]} */
  const rowErrors = [];
  /** @type {{ rowIndex: number, id: string, name: string }[]} */
  const imported = [];
  /** @type {{ rowIndex: number, name: string }[]} */
  const skippedDuplicates = [];

  let r = 2;
  for (const row of dataRows) {
    const built = await validateAndBuildPayload(row, pool);
    if (!built.ok) {
      rowErrors.push({ rowIndex: r, name: cellToString(row.name), errors: built.errors });
      r += 1;
      continue;
    }

    const { payload } = built;
    const dup = await isDuplicateActivePatient(pool, payload.name, payload.dob);
    if (dup) {
      skippedDuplicates.push({ rowIndex: r, name: payload.name });
      r += 1;
      continue;
    }

    if (dryRun) {
      imported.push({ rowIndex: r, id: '(preview)', name: payload.name });
    } else {
      try {
        const ins = await insertPatientRow(pool, payload, createdByUserId);
        imported.push({ rowIndex: r, id: ins.id, name: ins.name });
      } catch (e) {
        rowErrors.push({
          rowIndex: r,
          name: payload.name,
          errors: [e && e.message ? String(e.message) : '数据库写入失败'],
        });
      }
    }
    r += 1;
  }

  return {
    total_data_rows: dataRows.length,
    dry_run: dryRun,
    imported_count: imported.length,
    skipped_duplicate_count: skippedDuplicates.length,
    imported,
    skipped_duplicates: skippedDuplicates,
    row_errors: rowErrors,
  };
}

/**
 * @returns {Promise<Buffer>}
 */
async function buildTemplateWorkbookBuffer() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('患者导入');
  const headers = [
    'name',
    'gender',
    'dob',
    'dialysis_start_date',
    'primary_diagnosis',
    'responsible_nurse_name',
    'id_card',
    'phone',
    'isolation_zone',
    'dialysis_schedule_code',
    'dialysis_schedule_notes',
    'dialysis_schedule_anchor_date',
    'dialysis_mode',
    'address',
    'present_illness',
    'past_history',
    'ckd_stage',
    'comorbidities',
    'consent_dialysis',
    'consent_dialysis_date',
    'consent_cvc',
    'consent_cvc_date',
    'machine_station',
    'profile_anticoagulant',
    'profile_dry_weight',
    'profile_dry_weight_date',
    'family_contact_name',
    'family_contact_phone',
  ];
  ws.addRow(headers);
  ws.addRow([
    '示例患者', 'M', '1970-01-01', '2020-06-01', '慢性肾脏病5期', '张三',
    '', '', 'normal', 'tiw_mwf_morning', '', '', 'HD',
    '', '', '', '', '', '', '', '', '', '', 'heparin', '', '', '', '',
  ]);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
}

module.exports = {
  runImport,
  buildTemplateWorkbookBuffer,
  parseSpreadsheet,
  detectTemplateWorkbook,
  MAX_ROWS,
};
