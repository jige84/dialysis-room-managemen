require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'hemodialysis_db',
  user: 'hd_app',
  password: '840611',
});

async function seed() {
  const hash = await bcrypt.hash('Shangu@2026', 12);
  const users = [
    ['renjige',  hash, '\u4efb\u8ba1\u9601', 'admin'],
    ['yangchen', hash, '\u6768\u6668',         'head_nurse'],
    ['nurse01',  hash, '\u62a4\u58eb01',        'nurse'],
    ['doctor01', hash, '\u4e3b\u6cbb\u533b\u751f01', 'doctor'],
    ['qc01',     hash, '\u8d28\u63a701',        'qc'],
  ];
  for (const [u, h, n, r] of users) {
    await pool.query(
      'INSERT INTO users (username, password_hash, real_name, role) VALUES ($1,$2,$3,$4) ON CONFLICT (username) DO NOTHING',
      [u, h, n, r]
    );
    console.log('已插入用户:', u);
  }
  console.log('种子数据完成');
  await pool.end();
}

seed().catch(e => {
  console.error(e.message);
  process.exit(1);
});
