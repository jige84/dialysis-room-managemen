/**
 * 演示/开发用用户种子脚本（独立运行）
 * 主要作用：向 users 表批量插入预设角色账号，便于联调与演示环境快速就绪。
 * 主要功能：bcrypt 哈希密码后 INSERT；运行前需数据库已迁移且连接配置可用。
 */
require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

function requiredEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`缺少环境变量 ${name}，请先配置 .env（参考 backend/.env.example）`);
  return v;
}

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: requiredEnv('DB_NAME'),
  user: requiredEnv('DB_USER'),
  password: requiredEnv('DB_PASSWORD'),
});

async function seed() {
  const hash = await bcrypt.hash('Shangu@2026', 12);
  const users = [
    ['renjige',  hash, '\u4efb\u8ba1\u9601', 'admin'],
    ['yangchen', hash, '\u6768\u6668',         'head_nurse'],
    ['nurse01',  hash, '\u62a4\u58eb01',        'nurse'],
    ['doctor01', hash, '\u4e3b\u6cbb\u533b\u751f01', 'doctor'],
    ['qc01',     hash, '\u8d28\u63a701',        'quality'],
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
