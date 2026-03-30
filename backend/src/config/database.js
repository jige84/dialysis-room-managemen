/**
 * PostgreSQL 连接池配置与导出
 * 主要作用：为全项目提供共享的数据库连接池，避免重复建连。
 * 主要功能：按环境变量创建 pg.Pool；连接错误监听；提供 testConnection 供启动时自检。
 */
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host:     process.env.DB_HOST || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'hemodialysis_db',
  user:     process.env.DB_USER || 'hd_app',
  password: process.env.DB_PASSWORD,
  max:      parseInt(process.env.DB_POOL_MAX) || 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('[DB] 意外的数据库连接错误：', err);
});

// 测试数据库连接
async function testConnection() {
  try {
    const client = await pool.connect();
    const { rows } = await client.query('SELECT NOW() as now');
    client.release();
    console.log(`[DB] 数据库连接成功：${rows[0].now}`);
    return true;
  } catch (err) {
    console.error('[DB] 数据库连接失败：', err.message);
    return false;
  }
}

module.exports = { pool, testConnection };
