const DevicesConsumablesRepository = require('../repositories/devicesConsumablesRepository');

async function listConsumables(db) {
  return DevicesConsumablesRepository.listConsumableStocks(db);
}

async function createConsumable(db, payload, userId) {
  return DevicesConsumablesRepository.createConsumableStock(db, [
    payload.item_name,
    payload.category,
    payload.specification,
    payload.unit,
    payload.dialyzer_flux,
    payload.manufacturer,
    payload.registration_no,
    payload.storage_location,
    payload.alert_threshold,
    userId,
  ]);
}

async function deleteConsumable(db, stockItemId) {
  return DevicesConsumablesRepository.deleteConsumableStock(db, stockItemId);
}

async function getConsumableLastInbound(db, stockItemId) {
  return DevicesConsumablesRepository.getConsumableLastInbound(db, stockItemId);
}

async function inboundConsumable(db, payload, userId) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows: batchRows } = await DevicesConsumablesRepository.upsertConsumableBatch(client, [
      payload.stock_item_id,
      payload.lot_no,
      payload.expiry_date,
      payload.quantity,
      payload.supplier,
      payload.unit_price,
      userId,
      payload.notes,
    ]);
    await DevicesConsumablesRepository.increaseConsumableStock(
      client,
      payload.quantity,
      userId,
      payload.stock_item_id,
    );
    await client.query('COMMIT');
    return batchRows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function listConsumableOutboundLines(db, query) {
  const offset = (query.page - 1) * query.page_size;
  const cond = [];
  const params = [];
  let idx = 1;
  if (query.start_date) { cond.push(`c.outbound_date >= $${idx++}`); params.push(query.start_date); }
  if (query.end_date) { cond.push(`c.outbound_date <= $${idx++}`); params.push(query.end_date); }
  if (query.stock_item_id) { cond.push(`c.stock_item_id = $${idx++}`); params.push(query.stock_item_id); }
  const whereSql = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  return DevicesConsumablesRepository.listConsumableOutboundLines(
    db,
    whereSql,
    params,
    query.page_size,
    offset,
  );
}

async function listConsumablePatientUsage(db, query) {
  const cond = ['c.patient_id = $1'];
  const params = [query.patient_id];
  let idx = 2;
  if (query.stock_item_id) {
    cond.push(`c.stock_item_id = $${idx++}`);
    params.push(query.stock_item_id);
  }
  return DevicesConsumablesRepository.listConsumablePatientUsage(db, cond.join(' AND '), params);
}

async function getConsumablesTodaySummary(db) {
  const { rows: sched } = await DevicesConsumablesRepository.countScheduledPatientsToday(db);
  const { rows: outRows } = await DevicesConsumablesRepository.countConsumableOutboundToday(db);
  return {
    scheduled_patients: sched[0]?.scheduled_patients ?? 0,
    outbound_lines_today: outRows[0]?.outbound_lines ?? 0,
  };
}

async function patchConsumableStock(db, stockItemId, payload, userId) {
  if (payload.operation === 'in') {
    return DevicesConsumablesRepository.patchConsumableStockIncrease(
      db,
      payload.quantity,
      payload.notes,
      userId,
      stockItemId,
    );
  }
  if (payload.operation === 'out') {
    return DevicesConsumablesRepository.patchConsumableStockDecrease(
      db,
      payload.quantity,
      payload.notes,
      userId,
      stockItemId,
    );
  }
  return DevicesConsumablesRepository.patchConsumableStockSet(
    db,
    payload.quantity,
    payload.notes,
    userId,
    stockItemId,
  );
}

module.exports = {
  listConsumables,
  createConsumable,
  deleteConsumable,
  getConsumableLastInbound,
  inboundConsumable,
  listConsumableOutboundLines,
  listConsumablePatientUsage,
  getConsumablesTodaySummary,
  patchConsumableStock,
};
