const DevicesMachineRepository = require('../repositories/devicesMachineRepository');

function mapSeverity(rawSeverity, rawPriority) {
  const severityMap = {
    low: 'info',
    medium: 'warning',
    high: 'critical',
    critical: 'emergency',
    info: 'info',
    warning: 'warning',
    emergency: 'emergency',
  };
  return severityMap[String(rawSeverity || rawPriority || 'medium')] || 'warning';
}

async function listMachines(db) {
  return DevicesMachineRepository.listMachines(db);
}

async function createMachine(db, payload) {
  return DevicesMachineRepository.createMachine(db, [
    payload.machine_no,
    payload.model,
    payload.brand,
    payload.zone,
    payload.status,
    payload.serial_no,
    payload.purchase_date,
    payload.notes,
    payload.bacterial_filter_installed_at,
    payload.bacterial_filter_max_days,
    payload.last_dialysate_lab_at,
    payload.last_disinfection_at,
  ]);
}

async function patchMachine(db, machineId, updates, values) {
  return DevicesMachineRepository.updateMachineFields(db, machineId, updates, values);
}

async function patchMachineStatus(db, machineId, status, notes) {
  return DevicesMachineRepository.updateMachineStatus(db, machineId, status, notes);
}

async function deleteMachine(db, machineId) {
  return DevicesMachineRepository.deleteMachine(db, machineId);
}

async function listMachineMaintenance(db, machineId) {
  return DevicesMachineRepository.listMachineMaintenance(db, machineId);
}

async function createMachineMaintenance(db, machineId, payload, userId) {
  return DevicesMachineRepository.createMachineMaintenance(db, [
    machineId,
    payload.maintenance_type,
    payload.maintenance_date,
    payload.next_due,
    payload.content,
    payload.result,
    payload.notes,
    userId,
  ]);
}

async function listMachineAlerts(db, machineId) {
  return DevicesMachineRepository.listMachineAlerts(db, machineId);
}

async function createMachineAlert(db, machineId, payload) {
  const nextAlertType = payload.alert_type || 'machine_alarm';
  const nextSeverity = mapSeverity(payload.severity, payload.priority);
  return DevicesMachineRepository.createMachineAlert(db, [
    machineId,
    nextAlertType,
    nextAlertType,
    nextSeverity,
    payload.title,
    payload.message,
  ]);
}

module.exports = {
  listMachines,
  createMachine,
  patchMachine,
  patchMachineStatus,
  deleteMachine,
  listMachineMaintenance,
  createMachineMaintenance,
  listMachineAlerts,
  createMachineAlert,
};
