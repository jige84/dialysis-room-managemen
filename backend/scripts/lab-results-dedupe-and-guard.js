/**
 * lab_results 数据清洗与唯一约束守护脚本（可选策略）
 *
 * 默认 dry-run：仅输出重复概览，不修改数据/索引。
 *
 * 用法：
 *   node scripts/lab-results-dedupe-and-guard.js --dry-run
 *   node scripts/lab-results-dedupe-and-guard.js --apply-cleanup
 *   node scripts/lab-results-dedupe-and-guard.js --apply-cleanup --apply-guard --guard=daily_unique
 *   node scripts/lab-results-dedupe-and-guard.js --drop-guard
 */
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { Pool } = require('pg');

const GUARD_NONE = 'none';
const GUARD_DAILY_UNIQUE = 'daily_unique';
const DAILY_UNIQUE_INDEX = 'uq_lab_results_patient_type_test_date';

function formatYmd(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function printUsageAndExit(code = 0) {
  console.log(`
Usage:
  node scripts/lab-results-dedupe-and-guard.js [options]

Options:
  --dry-run                 仅检查，不落库（默认）
  --apply-cleanup           执行重复数据清洗（按 patient_id+test_type+test_date 保留最新）
  --apply-guard             应用唯一策略（需配合 --guard）
  --guard=none|daily_unique 唯一策略类型，默认 none
  --drop-guard              删除唯一索引守护
  --sample=N                重复分组示例条数（默认 20）
  --help                    显示帮助
`);
  process.exit(code);
}

function parseArgs(argv) {
  const args = {
    dryRun: true,
    applyCleanup: false,
    applyGuard: false,
    dropGuard: false,
    guard: GUARD_NONE,
    sample: 20,
  };

  for (const token of argv) {
    if (token === '--help' || token === '-h') {
      printUsageAndExit(0);
    } else if (token === '--dry-run') {
      args.dryRun = true;
    } else if (token === '--apply-cleanup') {
      args.applyCleanup = true;
      args.dryRun = false;
    } else if (token === '--apply-guard') {
      args.applyGuard = true;
      args.dryRun = false;
    } else if (token === '--drop-guard') {
      args.dropGuard = true;
      args.dryRun = false;
    } else if (token.startsWith('--guard=')) {
      args.guard = token.slice('--guard='.length).trim();
    } else if (token.startsWith('--sample=')) {
      const n = Number.parseInt(token.slice('--sample='.length), 10);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error('--sample 必须是正整数');
      }
      args.sample = n;
    } else {
      throw new Error(`未知参数：${token}`);
    }
  }

  if (![GUARD_NONE, GUARD_DAILY_UNIQUE].includes(args.guard)) {
    throw new Error(`--guard 仅支持 ${GUARD_NONE} 或 ${GUARD_DAILY_UNIQUE}`);
  }
  if (args.applyGuard && args.guard === GUARD_NONE) {
    throw new Error('启用 --apply-guard 时，--guard 不能为 none');
  }
  if (args.applyGuard && args.dropGuard) {
    throw new Error('--apply-guard 与 --drop-guard 不能同时使用');
  }

  return args;
}

function createPool() {
  return new Pool({
    host: process.env.DB_HOST,
    port: Number.parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
}

async function fetchDuplicateSummary(client) {
  const summarySql = `
    WITH ranked AS (
      SELECT
        id,
        patient_id,
        test_type,
        test_date,
        ROW_NUMBER() OVER (
          PARTITION BY patient_id, test_type, test_date
          ORDER BY created_at DESC NULLS LAST, id DESC
        ) AS rn,
        COUNT(*) OVER (
          PARTITION BY patient_id, test_type, test_date
        ) AS cnt
      FROM lab_results
    ),
    dup_groups AS (
      SELECT patient_id, test_type, test_date, cnt
      FROM ranked
      WHERE rn = 1 AND cnt > 1
    )
    SELECT
      COUNT(*)::int AS duplicate_groups,
      COALESCE(SUM(cnt - 1), 0)::int AS redundant_rows,
      COALESCE(MAX(cnt), 0)::int AS max_group_size
    FROM dup_groups
  `;
  const { rows } = await client.query(summarySql);
  return rows[0] || { duplicate_groups: 0, redundant_rows: 0, max_group_size: 0 };
}

async function fetchDuplicateSamples(client, limit) {
  const sql = `
    WITH ranked AS (
      SELECT
        patient_id,
        test_type,
        test_date,
        ROW_NUMBER() OVER (
          PARTITION BY patient_id, test_type, test_date
          ORDER BY created_at DESC NULLS LAST, id DESC
        ) AS rn,
        COUNT(*) OVER (
          PARTITION BY patient_id, test_type, test_date
        ) AS cnt
      FROM lab_results
    ),
    dup_groups AS (
      SELECT patient_id, test_type, test_date, cnt
      FROM ranked
      WHERE rn = 1 AND cnt > 1
    )
    SELECT
      dg.patient_id,
      p.name AS patient_name,
      dg.test_type,
      dg.test_date,
      dg.cnt
    FROM dup_groups dg
    LEFT JOIN patients p ON p.id = dg.patient_id
    ORDER BY dg.cnt DESC, dg.test_date DESC
    LIMIT $1
  `;
  const { rows } = await client.query(sql, [limit]);
  return rows;
}

async function cleanupDuplicates(client) {
  const sql = `
    WITH ranked AS (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY patient_id, test_type, test_date
          ORDER BY created_at DESC NULLS LAST, id DESC
        ) AS rn
      FROM lab_results
    ),
    to_delete AS (
      SELECT id FROM ranked WHERE rn > 1
    )
    DELETE FROM lab_results lr
    USING to_delete d
    WHERE lr.id = d.id
  `;
  const result = await client.query(sql);
  return result.rowCount || 0;
}

async function hasGuardIndex(client) {
  const sql = `
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND tablename = 'lab_results'
      AND indexname = $1
    LIMIT 1
  `;
  const { rows } = await client.query(sql, [DAILY_UNIQUE_INDEX]);
  return rows.length > 0;
}

async function createGuardIndex(client, guard) {
  if (guard !== GUARD_DAILY_UNIQUE) return;
  await client.query(
    `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ${DAILY_UNIQUE_INDEX}
     ON lab_results(patient_id, test_type, test_date)`
  );
}

async function dropGuardIndex(client) {
  await client.query(`DROP INDEX CONCURRENTLY IF EXISTS ${DAILY_UNIQUE_INDEX}`);
}

function printSummaryBlock(title, summary) {
  console.log(`\n[${title}]`);
  console.log(`重复分组数: ${summary.duplicate_groups}`);
  console.log(`可清理冗余行: ${summary.redundant_rows}`);
  console.log(`最大重复组大小: ${summary.max_group_size}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pool = createPool();
  const client = await pool.connect();
  try {
    console.log('=== lab_results 去重与唯一策略工具 ===');
    console.log(`模式: ${args.dryRun ? 'dry-run' : 'apply'}`);
    console.log(`guard: ${args.guard}`);

    const indexExistsBefore = await hasGuardIndex(client);
    console.log(`当前唯一守护索引(${DAILY_UNIQUE_INDEX}): ${indexExistsBefore ? '已存在' : '不存在'}`);

    const before = await fetchDuplicateSummary(client);
    printSummaryBlock('清洗前', before);
    const samples = await fetchDuplicateSamples(client, args.sample);
    if (samples.length > 0) {
      console.log(`\n重复分组示例(最多 ${args.sample} 条):`);
      for (const row of samples) {
        const patient = row.patient_name || row.patient_id;
        console.log(`- ${formatYmd(row.test_date)} | ${patient} | ${row.test_type} | count=${row.cnt}`);
      }
    } else {
      console.log('\n未发现重复分组。');
    }

    if (args.dryRun) return;

    if (args.applyCleanup) {
      console.log('\n开始清洗重复数据...');
      await client.query('BEGIN');
      try {
        const deleted = await cleanupDuplicates(client);
        await client.query('COMMIT');
        console.log(`清洗完成，已删除冗余行: ${deleted}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }

    const afterCleanup = await fetchDuplicateSummary(client);
    printSummaryBlock('清洗后', afterCleanup);

    if (args.applyGuard) {
      if (afterCleanup.redundant_rows > 0) {
        throw new Error('仍存在重复数据，无法创建唯一索引；请先执行 --apply-cleanup');
      }
      console.log(`\n开始应用唯一守护策略: ${args.guard}`);
      await createGuardIndex(client, args.guard);
      console.log('唯一守护策略应用完成。');
    }

    if (args.dropGuard) {
      console.log('\n开始移除唯一守护索引...');
      await dropGuardIndex(client);
      console.log('唯一守护索引已移除。');
    }

    const indexExistsAfter = await hasGuardIndex(client);
    console.log(`\n最终唯一守护索引(${DAILY_UNIQUE_INDEX}): ${indexExistsAfter ? '已存在' : '不存在'}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`\n❌ 执行失败: ${err.message}`);
  process.exit(1);
});
