async function findOverdueScreenings(db) {
  return db.query(
    `WITH latest AS (
       SELECT DISTINCT ON (is2.patient_id, is2.test_type)
         p.id as patient_id, p.name, is2.test_type as screen_type, is2.test_date as screen_date,
         is2.result,
         EXTRACT(DAY FROM NOW() - is2.test_date) as days_since
       FROM patients p
       LEFT JOIN infection_screenings is2 ON is2.patient_id = p.id
       WHERE p.status = 'active'
       ORDER BY is2.patient_id, is2.test_type, is2.test_date DESC
     )
     SELECT * FROM latest WHERE days_since > 166 OR screen_date IS NULL
     ORDER BY days_since DESC NULLS FIRST`,
  );
}

async function findLatestScreeningsByPatientIds(db, patientIds) {
  return db.query(
    `SELECT DISTINCT ON (patient_id, test_type)
       patient_id,
       id,
       test_type AS screen_type,
       test_date AS screen_date,
       result,
       notes,
       next_due_date
     FROM infection_screenings
     WHERE patient_id = ANY($1::uuid[])
     ORDER BY patient_id, test_type, test_date DESC`,
    [patientIds],
  );
}

async function findScreeningsByPatientId(db, patientId) {
  return db.query(
    `SELECT is2.*, u.real_name as entered_by_name
     FROM infection_screenings is2
     LEFT JOIN users u ON is2.entered_by = u.id
     WHERE is2.patient_id = $1
     ORDER BY is2.test_date DESC`,
    [patientId],
  );
}

async function findLatestScreeningsByPatientId(db, patientId) {
  return db.query(
    `SELECT DISTINCT ON (test_type)
       id,
       test_type AS screen_type,
       test_date AS screen_date,
       result,
       notes,
       next_due_date
     FROM infection_screenings
     WHERE patient_id = $1
     ORDER BY test_type, test_date DESC`,
    [patientId],
  );
}

async function insertScreening(db, params) {
  return db.query(
    `INSERT INTO infection_screenings
       (patient_id, test_type, result, test_date, notes, entered_by, is_positive)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    params,
  );
}

async function updatePatientIsolationIfNormal(db, patientId, zone) {
  return db.query(
    `UPDATE patients SET isolation_zone = $1 WHERE id = $2 AND isolation_zone = 'normal'`,
    [zone, patientId],
  );
}

async function findMonitoringByMonth(db, year, month) {
  return db.query(
    `SELECT im.*, va.location, va.access_type, p.name as patient_name
     FROM infection_monitoring im
     JOIN vascular_accesses va ON im.vascular_access_id = va.id
     JOIN patients p ON im.patient_id = p.id
     WHERE im.monitor_year = $1 AND im.monitor_month = $2
     ORDER BY im.catheter_days DESC`,
    [year, month],
  );
}

async function upsertMonitoring(db, params) {
  return db.query(
    `INSERT INTO infection_monitoring
       (patient_id, vascular_access_id, monitor_year, monitor_month,
        catheter_days, infection_status, notes, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (patient_id, monitor_year, monitor_month)
     DO UPDATE SET catheter_days = $5, infection_status = $6,
                   notes = $7, vascular_access_id = COALESCE($2, infection_monitoring.vascular_access_id),
                   updated_at = NOW()
     RETURNING *`,
    params,
  );
}

async function upsertMonitoringBatch(db, params) {
  return db.query(
    `INSERT INTO infection_monitoring
       (patient_id, vascular_access_id, monitor_year, monitor_month,
        catheter_days, infection_status, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (patient_id, monitor_year, monitor_month)
     DO UPDATE SET catheter_days = $5, updated_at = NOW()`,
    params,
  );
}

async function findButtonholeMonitoring(db, whereSql, params) {
  return db.query(
    `SELECT im.*, p.name as patient_name, va.location
     FROM infection_monitoring im
     JOIN patients p ON im.patient_id = p.id
     JOIN vascular_accesses va ON im.vascular_access_id = va.id
     ${whereSql}
     ORDER BY im.monitor_year DESC, im.monitor_month DESC
     LIMIT 200`,
    params,
  );
}

module.exports = {
  findOverdueScreenings,
  findLatestScreeningsByPatientIds,
  findScreeningsByPatientId,
  findLatestScreeningsByPatientId,
  insertScreening,
  updatePatientIsolationIfNormal,
  findMonitoringByMonth,
  upsertMonitoring,
  upsertMonitoringBatch,
  findButtonholeMonitoring,
};
