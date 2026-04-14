async function listMachines(db) {
  return db.query(
    `SELECT m.*,
      COUNT(dr.id)::bigint AS total_sessions,
      COALESCE(SUM(dr.actual_duration), 0)::bigint AS total_runtime_minutes,
      COUNT(dr.id) FILTER (WHERE dr.session_date = CURRENT_DATE)::bigint AS today_sessions,
      lm.last_maintenance_date,
      lm.next_maintenance_due,
      COALESCE(aa.alert_count, 0)::int AS active_alert_count
    FROM machines m
    LEFT JOIN dialysis_records dr ON dr.machine_id = m.id
    LEFT JOIN LATERAL (
      SELECT maintenance_date AS last_maintenance_date, next_due AS next_maintenance_due
      FROM machine_maintenance mm
      WHERE mm.machine_id = m.id
      ORDER BY mm.maintenance_date DESC NULLS LAST
      LIMIT 1
    ) lm ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS alert_count FROM alerts al
      WHERE al.machine_id = m.id AND al.status = 'active'
    ) aa ON true
    GROUP BY m.id, lm.last_maintenance_date, lm.next_maintenance_due, aa.alert_count
    ORDER BY m.machine_no`,
  );
}

async function createMachine(db, params) {
  return db.query(
    `INSERT INTO machines (
      machine_no, model, brand, zone, status, serial_no, purchase_date, notes,
      bacterial_filter_installed_at, bacterial_filter_max_days, last_dialysate_lab_at, last_disinfection_at
    ) VALUES ($1,$2,$3,COALESCE($4,'normal'),COALESCE($5,'active'),$6,$7,$8,$9,$10,$11,$12)
    RETURNING *`,
    params,
  );
}

async function updateMachineFields(db, machineId, updates, values) {
  const clauses = updates.map((k, idx) => `${k} = $${idx + 1}`);
  clauses.push('updated_at = NOW()');
  return db.query(
    `UPDATE machines SET ${clauses.join(', ')} WHERE id = $${updates.length + 1} RETURNING *`,
    [...values, machineId],
  );
}

async function updateMachineStatus(db, machineId, status, notes) {
  return db.query(
    `UPDATE machines SET status = $1, notes = COALESCE($2, notes), updated_at = NOW()
     WHERE id = $3 RETURNING *`,
    [status, notes, machineId],
  );
}

async function deleteMachine(db, machineId) {
  return db.query(
    `DELETE FROM machines
     WHERE id = $1
     RETURNING id, machine_no`,
    [machineId],
  );
}

async function listMachineMaintenance(db, machineId) {
  return db.query(
    `SELECT mm.*, u.real_name AS maintained_by_name
     FROM machine_maintenance mm
     LEFT JOIN users u ON mm.maintained_by = u.id
     WHERE mm.machine_id = $1
     ORDER BY mm.maintenance_date DESC`,
    [machineId],
  );
}

async function createMachineMaintenance(db, params) {
  return db.query(
    `INSERT INTO machine_maintenance (
      machine_id, maintenance_type, maintenance_date, next_due, content, result, notes, maintained_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    params,
  );
}

async function listMachineAlerts(db, machineId) {
  return db.query(
    `SELECT * FROM alerts WHERE machine_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [machineId],
  );
}

async function createMachineAlert(db, params) {
  return db.query(
    `INSERT INTO alerts (
       machine_id, alert_rule_id, alert_type, severity, title, message, status, created_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, 'active', NOW())
     RETURNING *`,
    params,
  );
}

module.exports = {
  listMachines,
  createMachine,
  updateMachineFields,
  updateMachineStatus,
  deleteMachine,
  listMachineMaintenance,
  createMachineMaintenance,
  listMachineAlerts,
  createMachineAlert,
};
