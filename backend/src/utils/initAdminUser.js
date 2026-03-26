/**
 * 初始化管理员账号
 * 运行：node src/utils/initAdminUser.js
 * 在数据库迁移完成后运行一次，创建初始用户
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

const INITIAL_PASSWORD = 'Shangu@2026';

const USERS = [
  { username: 'renjige',  real_name: '任计阁', role: 'admin' },
  { username: 'yangchen', real_name: '杨晨',   role: 'head_nurse' },
];

async function init() {
  const hash = await bcrypt.hash(INITIAL_PASSWORD, 12);
  console.log(`初始密码: ${INITIAL_PASSWORD}`);
  console.log(`密码Hash: ${hash}\n`);

  const client = await pool.connect();
  try {
    for (const user of USERS) {
      const { rows } = await client.query(
        `INSERT INTO users (username, password_hash, real_name, role)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (username) DO UPDATE SET
           password_hash = $2,
           updated_at = NOW()
         RETURNING id, username, real_name, role`,
        [user.username, hash, user.real_name, user.role]
      );
      console.log(`✅ 用户已创建/更新：${rows[0].real_name}（${rows[0].role}）账号：${rows[0].username}`);
    }
    console.log('\n初始用户创建完成！请首次登录后立即修改密码。');
  } finally {
    client.release();
    await pool.end();
  }
}

init().catch(err => {
  console.error('初始化失败：', err.message);
  process.exit(1);
});
