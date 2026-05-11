async function listConsumableStocks(db) {
  return db.query(
    `SELECT cs.*, u.real_name AS updated_by_name,
      COALESCE(SUM(b.quantity_remaining), 0)::bigint AS batch_remaining_sum
     FROM consumable_stocks cs
     LEFT JOIN users u ON cs.updated_by = u.id
     LEFT JOIN consumable_batches b ON b.stock_item_id = cs.id
     GROUP BY cs.id, u.real_name
     ORDER BY cs.category, cs.item_name`,
  );
}

async function createConsumableStock(db, params) {
  return db.query(
    `INSERT INTO consumable_stocks (
      item_name, category, specification, unit, dialyzer_flux, manufacturer, registration_no, storage_location,
      alert_threshold, current_stock, updated_by, hemodialysis_piece_role
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,0),0,$10,$11)
    RETURNING *`,
    params,
  );
}

async function patchConsumableStockMeta(db, stockItemId, hemodialysisPieceRole) {
  return db.query(
    `UPDATE consumable_stocks
     SET hemodialysis_piece_role = $2, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [stockItemId, hemodialysisPieceRole],
  );
}

async function deleteConsumableStock(db, stockItemId) {
  return db.query(
    `DELETE FROM consumable_stocks
     WHERE id = $1
     RETURNING id, item_name, category`,
    [stockItemId],
  );
}

async function getConsumableLastInbound(db, stockItemId) {
  return db.query(
    `SELECT lot_no, expiry_date, supplier, unit_price, inbound_at, notes
     FROM consumable_batches
     WHERE stock_item_id = $1
     ORDER BY inbound_at DESC
     LIMIT 1`,
    [stockItemId],
  );
}

async function upsertConsumableBatch(client, params) {
  return client.query(
    `INSERT INTO consumable_batches (
      stock_item_id, lot_no, expiry_date, quantity_remaining, supplier, unit_price, created_by, notes
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT (stock_item_id, lot_no) DO UPDATE SET
      quantity_remaining = consumable_batches.quantity_remaining + EXCLUDED.quantity_remaining,
      supplier = COALESCE(EXCLUDED.supplier, consumable_batches.supplier),
      unit_price = COALESCE(EXCLUDED.unit_price, consumable_batches.unit_price)
    RETURNING *`,
    params,
  );
}

async function increaseConsumableStock(client, quantity, userId, stockItemId) {
  return client.query(
    `UPDATE consumable_stocks
     SET current_stock = current_stock + $1, updated_at = NOW(), updated_by = $2
     WHERE id = $3`,
    [quantity, userId, stockItemId],
  );
}

async function listConsumableOutboundLines(db, whereSql, params, pageSize, offset) {
  return db.query(
    `SELECT c.*, cs.item_name, cs.unit, cs.specification, p.name AS patient_name,
            u.real_name AS operated_by_name
     FROM consumables c
     JOIN consumable_stocks cs ON c.stock_item_id = cs.id
     JOIN patients p ON c.patient_id = p.id
     LEFT JOIN users u ON c.operated_by = u.id
     ${whereSql}
     ORDER BY c.outbound_date DESC, c.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pageSize, offset],
  );
}

async function listConsumablePatientUsage(db, whereSql, params) {
  return db.query(
    `SELECT c.*, cs.item_name, cs.unit
     FROM consumables c
     JOIN consumable_stocks cs ON c.stock_item_id = cs.id
     WHERE ${whereSql}
     ORDER BY c.outbound_date DESC
     LIMIT 200`,
    params,
  );
}

async function countScheduledPatientsToday(db) {
  return db.query(
    `SELECT COUNT(DISTINCT patient_id)::int AS scheduled_patients
     FROM schedules WHERE scheduled_date = CURRENT_DATE`,
  );
}

async function countConsumableOutboundToday(db) {
  return db.query(
    `SELECT COUNT(*)::int AS outbound_lines
     FROM consumables WHERE outbound_date = CURRENT_DATE`,
  );
}

async function patchConsumableStockIncrease(db, quantity, notes, userId, stockItemId) {
  return db.query(
    `UPDATE consumable_stocks
     SET current_stock = current_stock + $1, notes = COALESCE($2, notes), updated_by = $3, updated_at = NOW()
     WHERE id = $4 RETURNING *`,
    [quantity, notes, userId, stockItemId],
  );
}

async function patchConsumableStockDecrease(db, quantity, notes, userId, stockItemId) {
  return db.query(
    `UPDATE consumable_stocks
     SET current_stock = GREATEST(0, current_stock - $1), notes = COALESCE($2, notes), updated_by = $3, updated_at = NOW()
     WHERE id = $4 RETURNING *`,
    [quantity, notes, userId, stockItemId],
  );
}

async function patchConsumableStockSet(db, quantity, notes, userId, stockItemId) {
  return db.query(
    `UPDATE consumable_stocks
     SET current_stock = $1, notes = COALESCE($2, notes), updated_by = $3, updated_at = NOW()
     WHERE id = $4 RETURNING *`,
    [quantity, notes, userId, stockItemId],
  );
}

module.exports = {
  listConsumableStocks,
  createConsumableStock,
  patchConsumableStockMeta,
  deleteConsumableStock,
  getConsumableLastInbound,
  upsertConsumableBatch,
  increaseConsumableStock,
  listConsumableOutboundLines,
  listConsumablePatientUsage,
  countScheduledPatientsToday,
  countConsumableOutboundToday,
  patchConsumableStockIncrease,
  patchConsumableStockDecrease,
  patchConsumableStockSet,
};
