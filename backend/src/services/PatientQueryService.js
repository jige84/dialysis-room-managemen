const { decrypt, maskIdCard, maskPhone } = require('../utils/encrypt');
const { calcAge, formatDuration } = require('../utils/dateUtils');
const PatientsRepository = require('../repositories/patientsRepository');

function normalizeConsentPaths(paths) {
  if (paths == null) return [];
  if (Array.isArray(paths)) {
    return paths.filter((p) => typeof p === 'string' && p.length > 0);
  }
  return [];
}

function buildListWhereAndParams(query) {
  const conditions = ['1=1'];
  const params = [];
  let idx = 1;

  if (query.status)         { conditions.push(`p.status = $${idx++}`);         params.push(query.status); }
  if (query.isolation_zone) { conditions.push(`p.isolation_zone = $${idx++}`); params.push(query.isolation_zone); }
  if (query.dialysis_mode)  { conditions.push(`p.dialysis_mode = $${idx++}`);  params.push(query.dialysis_mode); }
  if (query.ckd_stage)      { conditions.push(`p.ckd_stage = $${idx++}`);      params.push(parseInt(query.ckd_stage, 10)); }
  if (query.keyword) {
    conditions.push(`(p.name ILIKE $${idx} OR p.name ~ $${idx})`);
    params.push(`%${query.keyword}%`);
    idx += 1;
  }

  return {
    whereSql: conditions.join(' AND '),
    params,
  };
}

async function listPatients(db, query) {
  const page = Number(query.page || 1);
  const pageSize = Number(query.page_size || 20);
  const offset = (page - 1) * pageSize;
  const { whereSql, params } = buildListWhereAndParams(query);

  const countRes = await PatientsRepository.countPatients(db, whereSql, params);
  const total = parseInt(countRes.rows[0].count, 10);
  const { rows } = await PatientsRepository.listPatients(db, whereSql, params, pageSize, offset);

  const list = rows.map((row) => ({
    ...row,
    age: calcAge(row.dob),
    dialysis_age: row.dialysis_start_date ? formatDuration(row.dialysis_start_date) : '',
    phone_masked: maskPhone(decrypt(row.phone_encrypted)),
    phone_encrypted: undefined,
  }));

  return {
    list,
    total,
    page,
    pageSize,
  };
}

async function getPatientStats(db) {
  return PatientsRepository.getPatientStats(db);
}

async function getConsentImagePath(db, patientId, index) {
  const { rows } = await PatientsRepository.getConsentDialysisImagePaths(db, patientId);
  if (rows.length === 0) return { exists: false, path: null };
  const paths = normalizeConsentPaths(rows[0].consent_dialysis_image_paths);
  return {
    exists: true,
    path: paths[index] || null,
  };
}

async function getPatientDetail(db, patientId, role) {
  const { rows } = await PatientsRepository.getPatientDetailCore(db, patientId);
  if (rows.length === 0) return null;

  const patient = rows[0];
  const isPrivileged = ['admin', 'head_nurse'].includes(role);

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

  const { rows: vaRows } = await PatientsRepository.listPatientActiveVascularAccesses(db, patientId);
  patient.vascular_accesses = vaRows;

  const { rows: drRows } = await PatientsRepository.listPatientRecentDialysis(db, patientId);
  patient.recent_dialysis = drRows;

  const { rows: screenRows } = await PatientsRepository.listPatientInfectionSummary(db, patientId);
  patient.infection_screenings_summary = screenRows;

  patient.consents = {
    dialysis: patient.consent_dialysis || false,
    dialysis_date: patient.consent_dialysis_date || null,
    cvc: patient.consent_cvc || false,
    cvc_date: patient.consent_cvc_date || null,
  };

  return patient;
}

module.exports = {
  listPatients,
  getPatientStats,
  getConsentImagePath,
  getPatientDetail,
};
