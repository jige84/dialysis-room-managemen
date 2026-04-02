/**
 * 耗材库存：处方匹配、FIFO 批次扣减、透析出库明细
 * 主要作用：透析记录创建时按当前处方与默认清单自动扣减库存。
 */
const logger = require('../utils/logger');

/** 每例透析默认额外扣减：分类 + 数量（与 consumable_stocks.category 对应） */
const DEFAULT_SESSION_ITEMS = [
  { category: 'blood_tubing', quantity: 1 },
  { category: 'needle', quantity: 1 },
];

/**
 * @param {import('pg').PoolClient} client
 * @param {object} params
 * @param {string} params.dialysisRecordId
 * @param {string} params.patientId
 * @param {string|null} params.prescriptionId
 * @param {string} params.sessionDate YYYY-MM-DD
 * @param {string} params.operatedBy user id
 */
async function consumeForDialysis(client, params) {
  const { dialysisRecordId, patientId, prescriptionId, sessionDate, operatedBy } = params;

  const { rows: existing } = await client.query(
    `SELECT 1 FROM consumables WHERE dialysis_record_id = $1 LIMIT 1`,
    [dialysisRecordId]
  );
  if (existing.length > 0) {
    logger.warn(`consumeForDialysis: skip duplicate for dialysis ${dialysisRecordId}`);
    return { skipped: true };
  }

  let rxId = prescriptionId;
  if (!rxId) {
    const { rows: rxRows } = await client.query(
      `SELECT id FROM prescriptions WHERE patient_id = $1 AND is_current = true LIMIT 1`,
      [patientId]
    );
    rxId = rxRows[0]?.id || null;
  }
  if (!rxId) {
    const err = new Error('无当前透析处方，无法自动扣减耗材，请先维护处方');
    err.statusCode = 422;
    throw err;
  }

  const { rows: rxList } = await client.query(
    `SELECT dialyzer_model, dialyzer_flux FROM prescriptions WHERE id = $1`,
    [rxId]
  );
  const rx = rxList[0];
  const dialyzerStock = await findDialyzerStock(client, rx.dialyzer_model, rx.dialyzer_flux);
  if (!dialyzerStock) {
    const err = new Error(
      `未找到与处方透析器匹配的库存目录（model=${rx.dialyzer_model || ''}, flux=${rx.dialyzer_flux || ''}），请在耗材管理中维护透析器条目与批次`
    );
    err.statusCode = 422;
    throw err;
  }

  await consumeFromFifo(client, {
    stockItemId: dialyzerStock.id,
    quantity: 1,
    dialysisRecordId,
    patientId,
    sessionDate,
    operatedBy,
  });

  for (const def of DEFAULT_SESSION_ITEMS) {
    const { rows: stockRows } = await client.query(
      `SELECT id FROM consumable_stocks WHERE category = $1 ORDER BY item_name LIMIT 1`,
      [def.category]
    );
    if (stockRows.length === 0) {
      const err = new Error(`缺少分类为「${def.category}」的耗材目录，无法自动扣减`);
      err.statusCode = 422;
      throw err;
    }
    await consumeFromFifo(client, {
      stockItemId: stockRows[0].id,
      quantity: def.quantity,
      dialysisRecordId,
      patientId,
      sessionDate,
      operatedBy,
    });
  }

  return { skipped: false };
}

/**
 * @param {import('pg').PoolClient} client
 * @param {string|null} dialyzerModel
 * @param {string|null} dialyzerFlux
 */
async function findDialyzerStock(client, dialyzerModel, dialyzerFlux) {
  const model = dialyzerModel && String(dialyzerModel).trim();
  if (model) {
    const { rows } = await client.query(
      `SELECT id, item_name, dialyzer_flux FROM consumable_stocks
       WHERE category = 'dialyzer'
         AND (
           item_name ILIKE '%' || $1 || '%'
           OR $1 ILIKE '%' || item_name || '%'
           OR (item_code IS NOT NULL AND (item_code ILIKE '%' || $1 || '%'))
         )
         AND ($2::text IS NULL OR dialyzer_flux IS NULL OR dialyzer_flux = $2)
       ORDER BY
         CASE WHEN dialyzer_flux IS NOT NULL AND $2::text IS NOT NULL AND dialyzer_flux = $2 THEN 0 ELSE 1 END,
         item_name
       LIMIT 1`,
      [model, dialyzerFlux]
    );
    if (rows.length > 0) return rows[0];
  }

  const { rows: fallback } = await client.query(
    `SELECT id, item_name, dialyzer_flux FROM consumable_stocks
     WHERE category = 'dialyzer'
       AND ($1::text IS NULL OR dialyzer_flux IS NULL OR dialyzer_flux = $1)
     ORDER BY item_name LIMIT 1`,
    [dialyzerFlux]
  );
  return fallback[0] || null;
}

/**
 * @param {import('pg').PoolClient} client
 * @param {object} p
 */
async function consumeFromFifo(client, p) {
  const { stockItemId, quantity, dialysisRecordId, patientId, sessionDate, operatedBy } = p;
  let remaining = quantity;

  while (remaining > 0) {
    const { rows } = await client.query(
      `SELECT id, quantity_remaining FROM consumable_batches
       WHERE stock_item_id = $1 AND quantity_remaining > 0
       ORDER BY expiry_date NULLS LAST, inbound_at
       LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [stockItemId]
    );

    if (rows.length === 0) {
      const { rows: nameRow } = await client.query(
        `SELECT item_name FROM consumable_stocks WHERE id = $1`,
        [stockItemId]
      );
      const label = nameRow[0]?.item_name || stockItemId;
      const err = new Error(`耗材「${label}」库存不足，无法完成透析出库`);
      err.statusCode = 400;
      throw err;
    }

    const batch = rows[0];
    const take = Math.min(remaining, batch.quantity_remaining);

    await client.query(
      `UPDATE consumable_batches SET quantity_remaining = quantity_remaining - $1 WHERE id = $2`,
      [take, batch.id]
    );
    await client.query(
      `UPDATE consumable_stocks
       SET current_stock = GREATEST(0, current_stock - $1), updated_at = NOW(), updated_by = $2
       WHERE id = $3`,
      [take, operatedBy, stockItemId]
    );

    await client.query(
      `INSERT INTO consumables (
         dialysis_record_id, stock_item_id, patient_id, outbound_date, quantity,
         batch_id, outbound_type, operated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,'dialysis',$7)`,
      [dialysisRecordId, stockItemId, patientId, sessionDate, take, batch.id, operatedBy]
    );

    remaining -= take;
  }
}

module.exports = {
  consumeForDialysis,
  findDialyzerStock,
  consumeFromFifo,
  DEFAULT_SESSION_ITEMS,
};
