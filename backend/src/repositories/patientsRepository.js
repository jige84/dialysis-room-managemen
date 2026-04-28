async function createPatient(db, params) {
  return db.query(
    `INSERT INTO patients (
       name, gender, dob,
       id_card_encrypted, phone_encrypted,
       family_contact, address,
       primary_diagnosis, present_illness, past_history, ckd_stage, comorbidities,
       dialysis_start_date, dialysis_mode,
      patient_identifier,
      status,
       isolation_zone,
       consent_dialysis, consent_dialysis_date,
       dialysis_schedule_code, dialysis_schedule_notes, dialysis_schedule_anchor_date,
       responsible_nurse_id,
       created_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
    RETURNING id, name, gender, dob, primary_diagnosis, status, dialysis_start_date, patient_identifier`,
    params,
  );
}

async function getPatientScheduleState(db, patientId) {
  return db.query(
    'SELECT dialysis_schedule_code, dialysis_schedule_anchor_date FROM patients WHERE id = $1',
    [patientId],
  );
}

async function updatePatientCore(db, params) {
  return db.query(
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
       patient_identifier = COALESCE($14, patient_identifier),
       dialysis_start_date = CASE WHEN $15::boolean THEN $16::date ELSE dialysis_start_date END,
       consent_dialysis = COALESCE($17, consent_dialysis),
       consent_dialysis_date = CASE
         WHEN $17 = false THEN NULL
         WHEN $18::date IS NOT NULL THEN $18
         ELSE consent_dialysis_date
       END,
       consent_cvc = COALESCE($19, consent_cvc),
       consent_cvc_date = CASE
         WHEN $19 = false THEN NULL
         WHEN $20::date IS NOT NULL THEN $20
         ELSE consent_cvc_date
       END,
       dialysis_schedule_code = CASE WHEN $22::boolean THEN $21::varchar ELSE dialysis_schedule_code END,
       dialysis_schedule_notes = CASE WHEN $24::boolean THEN $23::text ELSE dialysis_schedule_notes END,
       responsible_nurse_id = CASE WHEN $26::boolean THEN $25::uuid ELSE responsible_nurse_id END,
       dialysis_schedule_anchor_date = $27::date,
       status = COALESCE($28::varchar, status),
       updated_at = NOW()
    WHERE id = $29
    RETURNING id, name, gender, status, patient_identifier`,
    params,
  );
}

async function updatePatientAnticoagulant(db, patientId, anticoagulant, prime, maintain) {
  return db.query(
    `UPDATE patients SET profile_anticoagulant = $1, profile_heparin_prime_dose = $2,
        profile_heparin_maintain = $3, updated_at = NOW()
     WHERE id = $4`,
    [anticoagulant, prime, maintain, patientId],
  );
}

async function updatePrescriptionAnticoagulant(db, patientId, anticoagulant, prime, maintain) {
  return db.query(
    `UPDATE prescriptions SET anticoagulant = $1, heparin_prime_dose = $2, heparin_maintain = $3, updated_at = NOW()
     WHERE patient_id = $4 AND is_current = true`,
    [anticoagulant, prime, maintain, patientId],
  );
}

async function updatePatientDryWeight(db, patientId, dryWeight, dryWeightDate, reason) {
  return db.query(
    `UPDATE patients SET profile_dry_weight = $1, profile_dry_weight_date = $2::date,
        profile_dry_weight_reason = $3, updated_at = NOW()
     WHERE id = $4`,
    [dryWeight, dryWeightDate, reason, patientId],
  );
}

async function updatePrescriptionDryWeight(db, patientId, dryWeight, dryWeightDate, reason) {
  return db.query(
    `UPDATE prescriptions SET dry_weight = $1, dry_weight_date = $2::date, dry_weight_reason = $3, updated_at = NOW()
     WHERE patient_id = $4 AND is_current = true`,
    [dryWeight, dryWeightDate, reason, patientId],
  );
}

async function updatePatientMachineStation(db, patientId, machineStation) {
  return db.query(
    `UPDATE patients SET machine_station = $1, updated_at = NOW() WHERE id = $2`,
    [machineStation, patientId],
  );
}

async function updateSchedulesMachineStation(db, patientId, machineStation) {
  return db.query(
    `UPDATE schedules SET machine_station = $1 WHERE patient_id = $2`,
    [machineStation, patientId],
  );
}

async function getConsentDialysisImagePaths(db, patientId) {
  return db.query(
    'SELECT consent_dialysis_image_paths FROM patients WHERE id = $1',
    [patientId],
  );
}

async function updateConsentDialysisImagePaths(db, patientId, imagePathsJson) {
  return db.query(
    `UPDATE patients SET consent_dialysis_image_paths = $1::jsonb, updated_at = NOW() WHERE id = $2`,
    [imagePathsJson, patientId],
  );
}

async function updatePatientStatus(db, patientId, status, statusNote, statusChangedAt) {
  return db.query(
    `UPDATE patients SET status = $1, status_note = $2, status_changed_at = $3, updated_at = NOW()
     WHERE id = $4 RETURNING id, name, status`,
    [status, statusNote, statusChangedAt, patientId],
  );
}

async function updatePatientIsolation(db, patientId, isolationZone) {
  return db.query(
    `UPDATE patients SET isolation_zone = $1, updated_at = NOW()
     WHERE id = $2 RETURNING id, name, isolation_zone`,
    [isolationZone, patientId],
  );
}

async function countPatients(db, whereSql, params) {
  return db.query(`SELECT COUNT(*) FROM patients p WHERE ${whereSql}`, params);
}

async function listPatients(db, whereSql, params, limit, offset) {
  return db.query(
    `SELECT p.id, p.name, p.gender, p.dob, p.primary_diagnosis, p.status, p.patient_identifier,
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
     WHERE ${whereSql}
     ORDER BY p.name
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );
}

async function getPatientStats(db) {
  return db.query(
    `SELECT
      COUNT(*) FILTER (WHERE status = 'active')                         as total_active,
      COUNT(*) FILTER (WHERE isolation_zone = 'normal')                 as zone_normal,
      COUNT(*) FILTER (WHERE isolation_zone = 'hbv')                   as zone_hbv,
      COUNT(*) FILTER (WHERE isolation_zone = 'hcv')                   as zone_hcv,
      COUNT(*) FILTER (WHERE isolation_zone = 'observation')            as zone_obs,
      (SELECT COUNT(*) FROM vascular_accesses WHERE access_type='avf' AND is_active=true) as va_avf,
      (SELECT COUNT(*) FROM vascular_accesses WHERE access_type='avg' AND is_active=true) as va_avg,
      (SELECT COUNT(*) FROM vascular_accesses WHERE access_type='tcc' AND is_active=true) as va_tcc,
      (SELECT COUNT(*) FROM vascular_accesses WHERE access_type='ncc' AND is_active=true) as va_ncc
     FROM patients WHERE status = 'active'`,
  );
}

async function getPatientDetailCore(db, patientId) {
  return db.query(
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
    [patientId],
  );
}

async function listPatientActiveVascularAccesses(db, patientId) {
  return db.query(
    `SELECT id, access_type, location, established_date, first_use_date,
            puncture_method, is_buttonhole, is_active, last_risk_score, last_risk_grade,
            last_ultrasound_date, ultrasound_result
     FROM vascular_accesses WHERE patient_id = $1 AND is_active = true`,
    [patientId],
  );
}

async function listPatientRecentDialysis(db, patientId) {
  return db.query(
    `SELECT id, session_date, shift, ktv, urr, uf_volume, coagulation_grade
     FROM dialysis_records WHERE patient_id = $1 ORDER BY session_date DESC LIMIT 3`,
    [patientId],
  );
}

async function listPatientInfectionSummary(db, patientId) {
  return db.query(
    `SELECT DISTINCT ON (test_type)
       test_type, result, test_date, next_due_date
     FROM infection_screenings
     WHERE patient_id = $1
     ORDER BY test_type, test_date DESC`,
    [patientId],
  );
}

async function lockPatientForDelete(db, patientId) {
  return db.query(
    `SELECT id, name, consent_dialysis_image_paths
     FROM patients
     WHERE id = $1
     FOR UPDATE`,
    [patientId],
  );
}

async function removePatientFromDefectReports(db, patientId) {
  return db.query(
    `UPDATE defect_reports d
     SET involved_patient_ids = COALESCE((
       SELECT array_agg(elem)
       FROM unnest(COALESCE(d.involved_patient_ids, ARRAY[]::uuid[])) AS elem
       WHERE elem <> $1::uuid
     ), ARRAY[]::uuid[])
     WHERE d.involved_patient_ids IS NOT NULL
       AND $1::uuid = ANY(d.involved_patient_ids)`,
    [patientId],
  );
}

const DELETABLE_TABLES = new Set([
  'alerts',
  'order_executions',
  'consumables',
  'dialysis_records',
  'prescriptions',
  'patient_schedule_rules',
  'schedules',
  'lab_results',
  'infection_screenings',
  'infection_monitoring',
  'cvc_risk_assessments',
  'vascular_punctures',
  'thrombolysis_records',
  'vascular_avf_assessments',
  'vascular_cvc_assessments',
  'vascular_accesses',
]);

async function deleteByPatientId(db, tableName, patientId) {
  if (!DELETABLE_TABLES.has(tableName)) {
    throw new Error(`Unsupported delete table: ${tableName}`);
  }
  return db.query(`DELETE FROM ${tableName} WHERE patient_id = $1`, [patientId]);
}

async function deleteLongTermOrderChildren(db, patientId) {
  return db.query(
    `DELETE FROM long_term_orders
     WHERE patient_id = $1 AND parent_order_id IS NOT NULL`,
    [patientId],
  );
}

async function deleteLongTermOrders(db, patientId) {
  return db.query(
    `DELETE FROM long_term_orders
     WHERE patient_id = $1`,
    [patientId],
  );
}

async function deletePatient(db, patientId) {
  return db.query(
    `DELETE FROM patients
     WHERE id = $1
     RETURNING id, name`,
    [patientId],
  );
}

module.exports = {
  createPatient,
  getPatientScheduleState,
  updatePatientCore,
  updatePatientAnticoagulant,
  updatePrescriptionAnticoagulant,
  updatePatientDryWeight,
  updatePrescriptionDryWeight,
  updatePatientMachineStation,
  updateSchedulesMachineStation,
  getConsentDialysisImagePaths,
  updateConsentDialysisImagePaths,
  updatePatientStatus,
  updatePatientIsolation,
  countPatients,
  listPatients,
  getPatientStats,
  getPatientDetailCore,
  listPatientActiveVascularAccesses,
  listPatientRecentDialysis,
  listPatientInfectionSummary,
  lockPatientForDelete,
  removePatientFromDefectReports,
  deleteByPatientId,
  deleteLongTermOrderChildren,
  deleteLongTermOrders,
  deletePatient,
};
