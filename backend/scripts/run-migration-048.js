/**
 * 执行 migrations/048_prescriptions_hdf_replacement.sql（HDF 置换液列）
 * 用法：在 backend 目录下 node scripts/run-migration-048.js
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { pool } = require('../src/config/database');

(async () => {
  const sqlPath = path.join(__dirname, '..', 'migrations', '048_prescriptions_hdf_replacement.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const client = await pool.connect();
  try {
    await client.query(sql);
    console.log('[OK] Migration 048 applied: hdf_replacement_mode, hdf_replacement_volume_l');
  } finally {
    client.release();
    await pool.end();
  }
})().catch((err) => {
  console.error('[FAIL]', err.message);
  process.exit(1);
});
