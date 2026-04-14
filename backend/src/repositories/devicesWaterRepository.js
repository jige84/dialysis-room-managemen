async function listWaterMachines(db) {
  return db.query(
    `SELECT wm.*
     FROM water_machines wm
     ORDER BY wm.machine_no`,
  );
}

async function createWaterMachine(db, params) {
  return db.query(
    `INSERT INTO water_machines (
       machine_no, model, brand, location, status, last_disinfection_at, next_disinfection_due, notes
     ) VALUES ($1,$2,$3,$4,COALESCE($5,'active'),$6,$7,$8)
     RETURNING *`,
    params,
  );
}

async function deleteWaterMachine(db, waterMachineId) {
  return db.query(
    `DELETE FROM water_machines
     WHERE id = $1
     RETURNING id, machine_no`,
    [waterMachineId],
  );
}

async function listWaterMachineMaintenance(db, waterMachineId) {
  return db.query(
    `SELECT wm.*, u.real_name AS maintained_by_name
     FROM water_machine_maintenance wm
     LEFT JOIN users u ON wm.maintained_by = u.id
     WHERE wm.water_machine_id = $1
     ORDER BY wm.maintenance_date DESC`,
    [waterMachineId],
  );
}

async function createWaterMachineMaintenance(db, params) {
  return db.query(
    `INSERT INTO water_machine_maintenance (
       water_machine_id, maintenance_type, maintenance_date, next_due, content, result, notes, maintained_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    params,
  );
}

async function listLegacyMaintenance(db, machineId, pageSize, offset) {
  const params = [];
  let idx = 1;
  let where = '';
  if (machineId) {
    where = `WHERE mm.machine_id = $${idx++}`;
    params.push(machineId);
  }
  return db.query(
    `SELECT mm.*, m.machine_no, m.model,
            u.real_name AS maintained_by_name
     FROM machine_maintenance mm
     LEFT JOIN machines m ON mm.machine_id = m.id
     LEFT JOIN users u ON mm.maintained_by = u.id
     ${where}
     ORDER BY mm.maintenance_date DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, pageSize, offset],
  );
}

async function createLegacyMaintenance(db, params) {
  return db.query(
    `INSERT INTO machine_maintenance (
      machine_id, maintenance_type, maintenance_date, next_due, content, result, notes, maintained_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    params,
  );
}

async function listWaterDailyInspections(db, whereSql, params, pageSize, offset) {
  return db.query(
    `SELECT w.*, wm.machine_no AS water_machine_no, u.real_name AS entered_by_name
     FROM water_daily_inspections w
     LEFT JOIN water_machines wm ON w.water_machine_id = wm.id
     LEFT JOIN users u ON w.entered_by = u.id
     ${whereSql}
     ORDER BY w.check_date DESC, w.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pageSize, offset],
  );
}

async function createWaterDailyInspection(db, params) {
  return db.query(
    `INSERT INTO water_daily_inspections (
      water_machine_id, check_date,
      hardness, total_chlorine, tap_pressure,
      sand_delta_p, resin_delta_p, carbon_delta_p,
      ro_in_pressure, ro_out_pressure,
      feed_conductivity, product_conductivity,
      product_flow, drain_flow, feed_temp,
      operator_name, notes, entered_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
    RETURNING *`,
    params,
  );
}

async function findWaterMachineById(db, waterMachineId) {
  return db.query(
    'SELECT id, machine_no FROM water_machines WHERE id = $1::uuid LIMIT 1',
    [waterMachineId],
  );
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
  findWaterMachineById,
};
