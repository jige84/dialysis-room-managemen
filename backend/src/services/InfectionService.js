const InfectionRepository = require('../repositories/infectionRepository');
const { formatDate } = require('../utils/dateUtils');
const { normalizeTestType } = require('../validators/infectionValidators');

async function listOverdueScreenings(db) {
  return InfectionRepository.findOverdueScreenings(db);
}

async function listLatestScreeningsBatch(db, patientIds) {
  return InfectionRepository.findLatestScreeningsByPatientIds(db, patientIds);
}

async function listScreeningsByPatient(db, patientId) {
  return InfectionRepository.findScreeningsByPatientId(db, patientId);
}

async function listLatestScreeningsByPatient(db, patientId) {
  return InfectionRepository.findLatestScreeningsByPatientId(db, patientId);
}

async function createScreenings(db, patientId, items, userId) {
  const results = [];

  for (const item of items) {
    const { screen_type, test_type, result, screen_date, test_date, notes } = item || {};
    const tt = normalizeTestType(test_type || screen_type);
    if (!tt || !result) continue;

    const { rows } = await InfectionRepository.insertScreening(db, [
      patientId,
      tt,
      result,
      test_date || screen_date || formatDate(new Date()),
      notes,
      userId,
      result === 'positive',
    ]);
    results.push(rows[0]);

    if ((tt === 'hbsag' || tt === 'hcvab') && result === 'positive') {
      const zone = tt === 'hbsag' ? 'hbv' : 'hcv';
      await InfectionRepository.updatePatientIsolationIfNormal(db, patientId, zone);
    }
  }

  return results;
}

async function listMonitoringByMonth(db, year, month) {
  return InfectionRepository.findMonitoringByMonth(db, year, month);
}

async function saveMonitoring(db, payload, userId) {
  const vaId = payload.vascular_access_id || payload.access_id;
  return InfectionRepository.upsertMonitoring(db, [
    payload.patient_id,
    vaId || null,
    payload.monitor_year,
    payload.monitor_month,
    payload.catheter_days || 0,
    payload.infection_status || 'none',
    payload.notes,
    userId,
  ]);
}

async function saveMonitoringBatch(db, payload, userId) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    let count = 0;
    for (const r of payload.records) {
      await InfectionRepository.upsertMonitoringBatch(client, [
        r.patient_id,
        r.vascular_access_id || r.access_id || null,
        payload.year,
        payload.month,
        r.catheter_days || 0,
        r.infection_status || 'none',
        userId,
      ]);
      count += 1;
    }
    await client.query('COMMIT');
    return { count };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function listButtonholeMonitoring(db, filters) {
  const conditions = ['va.is_buttonhole = true'];
  const params = [];
  let idx = 1;

  if (filters.patient_id) { conditions.push(`im.patient_id = $${idx++}`); params.push(filters.patient_id); }
  if (filters.year) { conditions.push(`im.monitor_year = $${idx++}`); params.push(parseInt(filters.year, 10)); }
  if (filters.month) { conditions.push(`im.monitor_month = $${idx++}`); params.push(parseInt(filters.month, 10)); }

  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return InfectionRepository.findButtonholeMonitoring(db, whereSql, params);
}

module.exports = {
  listOverdueScreenings,
  listLatestScreeningsBatch,
  listScreeningsByPatient,
  listLatestScreeningsByPatient,
  createScreenings,
  listMonitoringByMonth,
  saveMonitoring,
  saveMonitoringBatch,
  listButtonholeMonitoring,
};
