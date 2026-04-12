#!/usr/bin/env node
/**
 * 命令行批量导入患者（XLSX）
 * 用法：node scripts/import-patients-from-xlsx.js [--dry-run] path/to/file.xlsx
 * 环境：需配置 backend/.env（数据库、ENCRYPTION_KEY 等）；操作人默认取首个启用管理员，或设置 IMPORT_ACTOR_USER_ID。
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/database');
const PatientBulkImportService = require('../src/services/PatientBulkImportService');

async function resolveActorUserId() {
  const envId = process.env.IMPORT_ACTOR_USER_ID;
  if (envId && String(envId).trim()) return String(envId).trim();
  const { rows } = await pool.query(
    `SELECT id FROM users WHERE role = 'admin' AND is_active = true ORDER BY created_at ASC LIMIT 1`,
  );
  if (rows.length === 0) {
    throw new Error('未找到可用管理员账号，请在 .env 设置 IMPORT_ACTOR_USER_ID');
  }
  return rows[0].id;
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const fileArg = argv.find((a) => !a.startsWith('--') && a.length > 0);
  if (!fileArg) {
    console.error('用法: node scripts/import-patients-from-xlsx.js [--dry-run] <文件.xlsx>');
    process.exit(1);
  }
  const abs = path.isAbsolute(fileArg) ? fileArg : path.join(process.cwd(), fileArg);
  if (!fs.existsSync(abs)) {
    console.error('文件不存在:', abs);
    process.exit(1);
  }
  const buffer = fs.readFileSync(abs);
  const actorId = await resolveActorUserId();
  const result = await PatientBulkImportService.runImport(pool, buffer, {
    dryRun,
    createdByUserId: actorId,
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.row_errors.length > 0) {
    process.exitCode = 2;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => pool.end());
