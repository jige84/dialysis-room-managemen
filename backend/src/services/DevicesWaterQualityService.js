const DevicesWaterQualityRepository = require('../repositories/devicesWaterQualityRepository');

function normalizeWaterQualityRows(rows) {
  return rows.map((row) => {
    const value = row.result_value != null ? Number(row.result_value) : null;
    const result =
      typeof row.result_text === 'string' && row.result_text.trim()
        ? row.result_text
        : row.is_qualified === null || row.is_qualified === undefined
          ? null
          : row.is_qualified
            ? 'qualified'
            : 'unqualified';
    return {
      ...row,
      result,
      tested_by_name: row.tested_by_name || null,
      bacteria_count: row.test_type && String(row.test_type).startsWith('bacteria_') ? value : null,
      endotoxin_value: row.test_type && String(row.test_type).startsWith('endotoxin_') ? value : null,
    };
  });
}

async function listWaterQuality(db, query) {
  const offset = (query.page - 1) * query.page_size;
  const conditions = [];
  const params = [];
  let idx = 1;
  if (query.start_date) { conditions.push(`wq.test_date >= $${idx++}`); params.push(query.start_date); }
  if (query.end_date) { conditions.push(`wq.test_date <= $${idx++}`); params.push(query.end_date); }
  if (query.water_machine_id) { conditions.push(`wq.water_machine_id = $${idx++}`); params.push(query.water_machine_id); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await DevicesWaterQualityRepository.queryWaterQualityList(db, {
    where,
    params,
    limit: query.page_size,
    offset,
  });
  return normalizeWaterQualityRows(rows);
}

function resolveResultCode(resultInput, isQualified) {
  if (resultInput === 'qualified' || resultInput === 'unqualified') return resultInput;
  if (isQualified === true) return 'qualified';
  if (isQualified === false) return 'unqualified';
  return null;
}

async function createWaterQuality(db, payload, userId) {
  if (payload.water_machine_id) {
    const { rows: wmExists } = await DevicesWaterQualityRepository.findWaterMachineById(db, payload.water_machine_id);
    if (wmExists.length === 0) {
      const err = new Error('关联的水机不存在');
      err.statusCode = 400;
      throw err;
    }
  }

  const { rows } = await DevicesWaterQualityRepository.insertWaterQualityRecord(
    db,
    [
      payload.test_date,
      payload.test_type,
      payload.sample_point,
      payload.result_value,
      payload.result_unit,
      payload.result_text,
      payload.is_qualified,
      payload.notes,
      userId,
    ],
    payload.water_machine_id,
  );
  const row = rows[0];
  const resultCode = resolveResultCode(payload.result_input, payload.is_qualified);
  const wmId = row.water_machine_id || payload.water_machine_id || null;

  if (wmId && resultCode) {
    try {
      await DevicesWaterQualityRepository.updateWaterMachineLatestTest(
        db,
        payload.test_date,
        resultCode,
        wmId,
      );
    } catch (err) {
      if (err.code !== '42P01') throw err;
    }
  }

  let waterMachineNo = null;
  if (wmId) {
    try {
      const { rows: wmRows } = await DevicesWaterQualityRepository.getWaterMachineNoById(db, wmId);
      waterMachineNo = wmRows[0]?.machine_no ?? null;
    } catch (err) {
      if (err.code !== '42P01') throw err;
    }
  }

  return {
    ...row,
    result: row.result_text || payload.result_input || null,
    tested_by_name: null,
    water_machine_no: waterMachineNo,
    bacteria_count: String(row.test_type).startsWith('bacteria_') && row.result_value != null ? Number(row.result_value) : null,
    endotoxin_value: String(row.test_type).startsWith('endotoxin_') && row.result_value != null ? Number(row.result_value) : null,
  };
}

module.exports = {
  listWaterQuality,
  createWaterQuality,
};
