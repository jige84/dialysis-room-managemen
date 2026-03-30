/**
 * 数据库结构迁移 CLI
 * 主要作用：按顺序执行 sql/migrations 下脚本，初始化或升级 PostgreSQL 表结构。
 * 主要功能：独立进程连接数据库；记录已执行迁移；失败时输出错误并退出非零码。
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

const MIGRATIONS_DIR = path.join(__dirname, '../../migrations');

async function runMigrations() {
  const client = await pool.connect();
  try {
    // 创建迁移追踪表
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id          SERIAL PRIMARY KEY,
        filename    VARCHAR(255) UNIQUE NOT NULL,
        executed_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // 读取所有SQL文件（按文件名排序）
    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    console.log(`\n🚀 数据库迁移开始，共 ${files.length} 个文件\n`);

    for (const file of files) {
      // 检查是否已执行
      const { rows } = await client.query(
        'SELECT id FROM schema_migrations WHERE filename = $1',
        [file]
      );

      if (rows.length > 0) {
        console.log(`  ✅ 已跳过（已执行）：${file}`);
        continue;
      }

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1)',
          [file]
        );
        await client.query('COMMIT');
        console.log(`  ✨ 执行成功：${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  ❌ 执行失败：${file}`);
        console.error(`     错误：${err.message}`);
        process.exit(1);
      }
    }

    console.log('\n✅ 所有迁移执行完成！\n');
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations().catch(err => {
  console.error('迁移脚本异常：', err.message);
  process.exit(1);
});
