const DevicesWaterRepository = require('../repositories/devicesWaterRepository');

async function listWaterMachines(db) {
  return DevicesWaterRepository.listWaterMachines(db);
}

async function createWaterMachine(db, payload) {
  return DevicesWaterRepository.createWaterMachine(db, [
    payload.machine_no,
    payload.model,
    payload.brand,
    payload.location,
    payload.status,
    payload.last_disinfection_at,
    payload.next_disinfection_due,
    payload.notes,
  ]);
}

async function deleteWaterMachine(db, waterMachineId) {
  return DevicesWaterRepository.deleteWaterMachine(db, waterMachineId);
}

async function listWaterMachineMaintenance(db, waterMachineId) {
  return DevicesWaterRepository.listWaterMachineMaintenance(db, waterMachineId);
}

async function createWaterMachineMaintenance(db, waterMachineId, payload, userId) {
  return DevicesWaterRepository.createWaterMachineMaintenance(db, [
    waterMachineId,
    payload.maintenance_type,
    payload.maintenance_date,
    payload.next_due,
    payload.content,
    payload.result,
    payload.notes,
    userId,
  ]);
}

async function listLegacyMaintenance(db, query) {
  const offset = (query.page - 1) * query.page_size;
  return DevicesWaterRepository.listLegacyMaintenance(
    db,
    query.machine_id,
    query.page_size,
    offset,
  );
}

async function createLegacyMaintenance(db, payload, userId) {
  return DevicesWaterRepository.createLegacyMaintenance(db, [
    payload.machine_id,
    payload.maintenance_type,
    payload.maintenance_date,
    payload.next_due,
    payload.content,
    payload.result,
    payload.notes,
    userId,
  ]);
}

async function listWaterDailyInspections(db, query) {
  const offset = (query.page - 1) * query.page_size;
  const conditions = [];
  const params = [];
  let idx = 1;
  if (query.start_date) { conditions.push(`w.check_date >= $${idx++}`); params.push(query.start_date); }
  if (query.end_date) { conditions.push(`w.check_date <= $${idx++}`); params.push(query.end_date); }
  if (query.water_machine_id) { conditions.push(`w.water_machine_id = $${idx++}`); params.push(query.water_machine_id); }
  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return DevicesWaterRepository.listWaterDailyInspections(
    db,
    whereSql,
    params,
    query.page_size,
    offset,
  );
}

async function createWaterDailyInspection(db, payload, userId) {
  if (payload.water_machine_id) {
    const { rows: wmExists } = await DevicesWaterRepository.findWaterMachineById(db, payload.water_machine_id);
    if (wmExists.length === 0) {
      const err = new Error('关联的水机不存在');
      err.statusCode = 400;
      throw err;
    }
  }

  const { rows } = await DevicesWaterRepository.createWaterDailyInspection(db, [
    payload.water_machine_id,
    payload.check_date,
    payload.hardness,
    payload.total_chlorine,
    payload.tap_pressure,
    payload.sand_delta_p,
    payload.resin_delta_p,
    payload.carbon_delta_p,
    payload.ro_in_pressure,
    payload.ro_out_pressure,
    payload.feed_conductivity,
    payload.product_conductivity,
    payload.product_flow,
    payload.drain_flow,
    payload.feed_temp,
    payload.operator_name,
    payload.notes,
    userId,
  ]);
  const row = rows[0];

  let waterMachineNo = null;
  if (row.water_machine_id) {
    const { rows: wmRows } = await DevicesWaterRepository.findWaterMachineById(db, row.water_machine_id);
    waterMachineNo = wmRows[0]?.machine_no ?? null;
  }

  return {
    ...row,
    water_machine_no: waterMachineNo,
    entered_by_name: null,
  };
}

module.exports = {
  listWaterMachines,
  createWaterMachine,
  deleteWaterMachine,
  listWaterMachineMaintenance,
  createWaterMachineMaintenance,
  listLegacyMaintenance,
  createLegacyMaintenance,
  listWaterDailyInspections,
  createWaterDailyInspection,
};
