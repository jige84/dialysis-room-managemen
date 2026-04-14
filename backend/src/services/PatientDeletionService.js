const PatientsRepository = require('../repositories/patientsRepository');

const CASCADE_DELETE_TABLES = [
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
];

async function deleteByPatientIdIgnoreMissingTable(client, tableName, patientId) {
  try {
    await PatientsRepository.deleteByPatientId(client, tableName, patientId);
  } catch (err) {
    if (err && err.code === '42P01') return;
    throw err;
  }
}

async function removeDefectReportLinksIgnoreMissing(client, patientId) {
  try {
    await PatientsRepository.removePatientFromDefectReports(client, patientId);
  } catch (err) {
    if (!err || (err.code !== '42P01' && err.code !== '42703')) throw err;
  }
}

async function deleteLongTermOrdersIgnoreMissing(client, patientId) {
  try {
    await PatientsRepository.deleteLongTermOrderChildren(client, patientId);
    await PatientsRepository.deleteLongTermOrders(client, patientId);
  } catch (err) {
    if (!err || err.code !== '42P01') throw err;
  }
}

async function deletePatientCascade(db, patientId) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const { rows: patientRows } = await PatientsRepository.lockPatientForDelete(client, patientId);
    if (patientRows.length === 0) {
      await client.query('ROLLBACK');
      return { notFound: true, deleted: null, consentImagePaths: null };
    }
    const current = patientRows[0];

    await removeDefectReportLinksIgnoreMissing(client, patientId);

    for (const tableName of CASCADE_DELETE_TABLES) {
      await deleteByPatientIdIgnoreMissingTable(client, tableName, patientId);
    }

    await deleteLongTermOrdersIgnoreMissing(client, patientId);

    const { rows: deletedRows } = await PatientsRepository.deletePatient(client, patientId);
    if (deletedRows.length === 0) {
      await client.query('ROLLBACK');
      return { notFound: true, deleted: null, consentImagePaths: null };
    }

    await client.query('COMMIT');
    return {
      notFound: false,
      deleted: deletedRows[0],
      consentImagePaths: current.consent_dialysis_image_paths,
    };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  deletePatientCascade,
};
