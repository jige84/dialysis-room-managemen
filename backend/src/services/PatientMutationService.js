const PatientsRepository = require('../repositories/patientsRepository');

async function createPatient(db, params) {
  return PatientsRepository.createPatient(db, params);
}

async function getPatientScheduleState(db, patientId) {
  return PatientsRepository.getPatientScheduleState(db, patientId);
}

async function updatePatientCore(db, params) {
  return PatientsRepository.updatePatientCore(db, params);
}

async function syncAnticoagulantProfile(db, patientId, anticoagulant, prime, maintain) {
  await PatientsRepository.updatePatientAnticoagulant(db, patientId, anticoagulant, prime, maintain);
  await PatientsRepository.updatePrescriptionAnticoagulant(db, patientId, anticoagulant, prime, maintain);
}

async function syncDryWeightProfile(db, patientId, dryWeight, dryWeightDate, reason) {
  await PatientsRepository.updatePatientDryWeight(db, patientId, dryWeight, dryWeightDate, reason);
  await PatientsRepository.updatePrescriptionDryWeight(db, patientId, dryWeight, dryWeightDate, reason);
}

async function syncMachineStation(db, patientId, machineStation) {
  try {
    await PatientsRepository.updatePatientMachineStation(db, patientId, machineStation);
    await PatientsRepository.updateSchedulesMachineStation(db, patientId, machineStation);
  } catch (err) {
    if (!err || err.code !== '42703') throw err;
  }
}

async function replaceConsentDialysisImages(db, patientId, rels) {
  const { rows } = await PatientsRepository.getConsentDialysisImagePaths(db, patientId);
  if (rows.length === 0) {
    return { found: false, oldPaths: null };
  }

  const oldPaths = rows[0].consent_dialysis_image_paths;
  await PatientsRepository.updateConsentDialysisImagePaths(db, patientId, JSON.stringify(rels));
  return { found: true, oldPaths };
}

async function updatePatientStatus(db, patientId, status, statusNote, statusChangedAt) {
  return PatientsRepository.updatePatientStatus(db, patientId, status, statusNote, statusChangedAt);
}

async function updatePatientIsolation(db, patientId, isolationZone) {
  return PatientsRepository.updatePatientIsolation(db, patientId, isolationZone);
}

module.exports = {
  createPatient,
  getPatientScheduleState,
  updatePatientCore,
  syncAnticoagulantProfile,
  syncDryWeightProfile,
  syncMachineStation,
  replaceConsentDialysisImages,
  updatePatientStatus,
  updatePatientIsolation,
};
