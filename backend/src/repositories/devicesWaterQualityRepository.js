const PG_UNDEFINED_COLUMN = '42703';

function isWaterQualityUserColumnMissing(err) {
  if (!err || err.code !== PG_UNDEFINED_COLUMN) return false;
  const msg = String(err.message || '');
  return msg.includes('entered_by') || msg.includes('tested_by');
}

function isWaterQualityWaterMachineColumnMissing(err) {
  if (!err || err.code !== PG_UNDEFINED_COLUMN) return false;
  return String(err.message || '').includes('water_machine_id');
}

async function queryWaterQualityList(db, { where, params, limit, offset }) {
  const baseParams = [...params, limit, offset];
  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;

  async function runWithUser(userColumn, withMachineJoin) {
    const wmJoin = withMachineJoin
      ? 'LEFT JOIN water_machines wm ON wq.water_machine_id = wm.id'
      : '';
    const wmSelect = withMachineJoin ? 'wm.machine_no AS water_machine_no' : 'NULL::text AS water_machine_no';
    return db.query(
      `SELECT wq.*, u.real_name AS tested_by_name, ${wmSelect}
       FROM water_quality_records wq
       LEFT JOIN users u ON wq.${userColumn} = u.id
       ${wmJoin}
       ${where}
       ORDER BY wq.test_date DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      baseParams,
    );
  }

  async function runNoUser(withMachineJoin) {
    const wmJoin = withMachineJoin
      ? 'LEFT JOIN water_machines wm ON wq.water_machine_id = wm.id'
      : '';
    const wmSelect = withMachineJoin ? 'wm.machine_no AS water_machine_no' : 'NULL::text AS water_machine_no';
    return db.query(
      `SELECT wq.*, NULL::text AS tested_by_name, ${wmSelect}
       FROM water_quality_records wq
       ${wmJoin}
       ${where}
       ORDER BY wq.test_date DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      baseParams,
    );
  }

  async function tryUserColumn(userColumn) {
    try {
      return await runWithUser(userColumn, true);
    } catch (err) {
      if (err.code === PG_UNDEFINED_COLUMN && isWaterQualityWaterMachineColumnMissing(err)) {
        return runWithUser(userColumn, false);
      }
      throw err;
    }
  }

  async function tryNoUser() {
    try {
      return await runNoUser(true);
    } catch (err) {
      if (err.code === PG_UNDEFINED_COLUMN && isWaterQualityWaterMachineColumnMissing(err)) {
        return runNoUser(false);
      }
      throw err;
    }
  }

  try {
    return await tryUserColumn('entered_by');
  } catch (err) {
    if (!isWaterQualityUserColumnMissing(err)) throw err;
  }

  try {
    return await tryUserColumn('tested_by');
  } catch (err) {
    if (!isWaterQualityUserColumnMissing(err)) throw err;
  }

  return tryNoUser();
}

/**
 * values: [test_date, test_type, sample_point, result_value, result_unit, result_text, is_qualified, notes, userId]
 * waterMachineId: optional UUID string
 */
async function insertWaterQualityRecord(db, values, waterMachineId) {
  const wm = waterMachineId || null;
  const base8 = values.slice(0, 8);
  const userId = values[8];

  const insertEnteredByWithWm = () =>
    db.query(
      `INSERT INTO water_quality_records
         (test_date, test_type, sample_point, result_value, result_unit,
          result_text, is_qualified, notes, entered_by, water_machine_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [...base8, userId, wm],
    );

  const insertEnteredBy = () =>
    db.query(
      `INSERT INTO water_quality_records
         (test_date, test_type, sample_point, result_value, result_unit,
          result_text, is_qualified, notes, entered_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      values,
    );

  const insertTestedByWithWm = () =>
    db.query(
      `INSERT INTO water_quality_records
         (test_date, test_type, sample_point, result_value, result_unit,
          result_text, is_qualified, notes, tested_by, water_machine_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [...base8, userId, wm],
    );

  const insertTestedBy = () =>
    db.query(
      `INSERT INTO water_quality_records
         (test_date, test_type, sample_point, result_value, result_unit,
          result_text, is_qualified, notes, tested_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      values,
    );

  const insertWmOnly = () =>
    db.query(
      `INSERT INTO water_quality_records
         (test_date, test_type, sample_point, result_value, result_unit,
          result_text, is_qualified, notes, water_machine_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [...base8, wm],
    );

  const insertBare = () =>
    db.query(
      `INSERT INTO water_quality_records
         (test_date, test_type, sample_point, result_value, result_unit,
          result_text, is_qualified, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      base8,
    );

  try {
    return await insertEnteredByWithWm();
  } catch (err) {
    if (!isWaterQualityWaterMachineColumnMissing(err)) {
      if (!isWaterQualityUserColumnMissing(err)) throw err;
    }
  }

  try {
    return await insertEnteredBy();
  } catch (err) {
    if (!isWaterQualityUserColumnMissing(err)) throw err;
  }

  try {
    return await insertTestedByWithWm();
  } catch (err) {
    if (!isWaterQualityWaterMachineColumnMissing(err)) {
      if (!isWaterQualityUserColumnMissing(err)) throw err;
    }
  }

  try {
    return await insertTestedBy();
  } catch (err) {
    if (!isWaterQualityUserColumnMissing(err)) throw err;
  }

  try {
    return await insertWmOnly();
  } catch (err) {
    if (!isWaterQualityWaterMachineColumnMissing(err)) throw err;
  }

  return insertBare();
}

async function findWaterMachineById(db, waterMachineId) {
  return db.query(
    'SELECT 1 FROM water_machines WHERE id = $1::uuid LIMIT 1',
    [waterMachineId],
  );
}

async function updateWaterMachineLatestTest(db, testDate, resultCode, waterMachineId) {
  return db.query(
    `UPDATE water_machines
     SET last_water_test_date = $1::date,
         last_water_test_result = $2,
         updated_at = NOW()
     WHERE id = $3::uuid
       AND ($1::date >= COALESCE(last_water_test_date, '1900-01-01'::date))`,
    [testDate, resultCode, waterMachineId],
  );
}

async function getWaterMachineNoById(db, waterMachineId) {
  return db.query(
    'SELECT machine_no FROM water_machines WHERE id = $1',
    [waterMachineId],
  );
}

module.exports = {
  queryWaterQualityList,
  insertWaterQualityRecord,
  findWaterMachineById,
  updateWaterMachineLatestTest,
  getWaterMachineNoById,
};
