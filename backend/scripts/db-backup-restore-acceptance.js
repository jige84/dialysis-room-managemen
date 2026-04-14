/**
 * 生产同构备份恢复验收脚本（严格模式）
 *
 * 流程：
 * 1) 执行 pg_dump 生成 custom dump
 * 2) 执行 pg_restore --list 校验备份可读
 * 3) 创建临时数据库并完整恢复
 * 4) 对 public schema 全表做行数一致性校验
 * 5) 清理临时数据库并输出报告
 *
 * 默认行为即包含恢复验证（需要 createdb 权限）。
 * 可选参数：
 *   --skip-restore-test   仅做备份与可读性检查（不建议生产验收使用）
 *   --keep-temp-db        保留恢复用临时数据库（排障时使用）
 *   --temp-db-name=NAME   指定临时数据库名
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { Pool } = require('pg');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env') });

const repoRoot = path.resolve(__dirname, '../..');
const outputRoot = path.join(
  repoRoot,
  'docs',
  'qa',
  'release-hardening',
  'generated',
  'db-acceptance'
);

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || '',
};
const adminDatabase = process.env.DB_ADMIN_DATABASE || 'postgres';

function nowIso() {
  return new Date().toISOString();
}

function runId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return [
    d.getFullYear(),
    pad(d.getMonth() + 1),
    pad(d.getDate()),
    '-',
    pad(d.getHours()),
    pad(d.getMinutes()),
    pad(d.getSeconds()),
  ].join('');
}

function parseArgs(argv) {
  const opts = {
    skipRestoreTest: false,
    keepTempDb: false,
    tempDbName: null,
  };

  for (const arg of argv) {
    if (arg === '--skip-restore-test') {
      opts.skipRestoreTest = true;
    } else if (arg === '--keep-temp-db') {
      opts.keepTempDb = true;
    } else if (arg.startsWith('--temp-db-name=')) {
      opts.tempDbName = arg.slice('--temp-db-name='.length).trim();
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return opts;
}

function isSafeIdentifier(name) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

function quoteIdentifier(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

function resolvePgCommand(cmd) {
  const binDir = process.env.PG_BIN_DIR;
  if (!binDir) return cmd;

  const candidate = path.join(binDir, process.platform === 'win32' ? `${cmd}.exe` : cmd);
  return candidate;
}

function execOrThrow(cmd, args, options = {}) {
  const res = spawnSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
  if (res.error) {
    throw res.error;
  }
  if (res.status !== 0) {
    const stderr = (res.stderr || '').trim();
    const stdout = (res.stdout || '').trim();
    throw new Error(
      `${cmd} exited with code ${res.status}. ${stderr || stdout || 'Unknown error'}`
    );
  }
  return res.stdout || '';
}

function toMs(durationNs) {
  return Number(durationNs) / 1e6;
}

async function measureStep(report, name, fn) {
  const startedAt = nowIso();
  const t0 = process.hrtime.bigint();
  try {
    const details = await fn();
    const durationMs = Math.round(toMs(process.hrtime.bigint() - t0));
    report.steps.push({
      name,
      status: 'passed',
      startedAt,
      endedAt: nowIso(),
      durationMs,
      details: details || null,
    });
    return details;
  } catch (error) {
    const durationMs = Math.round(toMs(process.hrtime.bigint() - t0));
    report.steps.push({
      name,
      status: 'failed',
      startedAt,
      endedAt: nowIso(),
      durationMs,
      error: error.message,
    });
    throw error;
  }
}

async function fetchRoleCapabilities(client) {
  const { rows } = await client.query(`
    SELECT
      current_user AS current_user,
      r.rolcreatedb AS role_can_createdb
    FROM pg_roles r
    WHERE r.rolname = current_user
  `);
  return rows[0] || { current_user: null, role_can_createdb: false };
}

async function listPublicTables(client) {
  const { rows } = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  if (rows.length === 0) {
    throw new Error('No tables found in public schema.');
  }
  return rows.map((r) => r.table_name);
}

async function rowCounts(client, schemaName, tables) {
  const counts = {};
  for (const table of tables) {
    const { rows } = await client.query(
      `SELECT COUNT(*)::bigint AS c FROM ${quoteIdentifier(schemaName)}.${quoteIdentifier(table)}`
    );
    counts[table] = Number(rows[0].c);
  }
  return counts;
}

function diffCounts(expected, actual) {
  const diff = [];
  for (const table of Object.keys(expected)) {
    if (expected[table] !== actual[table]) {
      diff.push({ table, expected: expected[table], actual: actual[table] });
    }
  }
  return diff;
}

async function terminateConnections(client, dbName) {
  await client.query(
    `
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = $1
        AND pid <> pg_backend_pid()
    `,
    [dbName]
  );
}

function formatMarkdown(report) {
  const lines = [];
  lines.push('# DB Backup/Restore Acceptance Report');
  lines.push('');
  lines.push(`- Run ID: \`${report.runId}\``);
  lines.push(`- Status: **${report.status}**`);
  lines.push(`- Generated At: ${report.generatedAt}`);
  lines.push(`- Source DB: \`${report.database}\``);
  lines.push(`- Admin DB: \`${report.adminDatabase}\``);
  lines.push(`- DB User: \`${report.user}\``);
  lines.push(`- Temp DB: \`${report.tempDbName || '(not used)'}\``);
  lines.push('');
  lines.push('## Steps');
  lines.push('');
  lines.push('| Step | Status | Duration(ms) |');
  lines.push('|---|---|---:|');
  for (const step of report.steps) {
    lines.push(`| ${step.name} | ${step.status} | ${step.durationMs} |`);
  }
  lines.push('');

  if (report.rowCountDiff.length > 0) {
    lines.push('## Row Count Differences');
    lines.push('');
    lines.push('| Table | Expected | Actual |');
    lines.push('|---|---:|---:|');
    for (const d of report.rowCountDiff) {
      lines.push(`| ${d.table} | ${d.expected} | ${d.actual} |`);
    }
    lines.push('');
  } else if (!report.skipRestoreTest) {
    lines.push('## Row Count Verification');
    lines.push('');
    lines.push('- All public tables match between source DB and restored temp DB.');
    lines.push('');
  }

  if (report.warning) {
    lines.push('## Warning');
    lines.push('');
    lines.push(`- ${report.warning}`);
    lines.push('');
  }

  lines.push('## Artifacts');
  lines.push('');
  lines.push(`- Backup dump: \`${report.artifacts.backupDump}\``);
  lines.push(`- Backup list: \`${report.artifacts.backupList}\``);
  lines.push(`- JSON report: \`${report.artifacts.reportJson}\``);
  lines.push(`- Markdown report: \`${report.artifacts.reportMd}\``);
  lines.push('');

  if (report.error) {
    lines.push('## Error');
    lines.push('');
    lines.push('```text');
    lines.push(report.error);
    lines.push('```');
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

async function main() {
  if (!dbConfig.database || !dbConfig.user) {
    throw new Error('DB_NAME / DB_USER is required in backend/.env');
  }

  const opts = parseArgs(process.argv.slice(2));
  const id = runId();
  const runDir = path.join(outputRoot, id);
  fs.mkdirSync(runDir, { recursive: true });

  const backupDump = path.join(runDir, `${dbConfig.database}-${id}.dump`);
  const backupList = path.join(runDir, `${dbConfig.database}-${id}.list`);
  const reportJson = path.join(runDir, 'db-acceptance-report.json');
  const reportMd = path.join(runDir, 'db-acceptance-report.md');

  const defaultTempDbName = `${dbConfig.database}_restore_verify_${id.replace('-', '_')}`;
  const tempDbNameRaw = opts.tempDbName || defaultTempDbName;
  const tempDbName = tempDbNameRaw.slice(0, 63);

  if (!isSafeIdentifier(tempDbName)) {
    throw new Error(`Invalid temp database name: ${tempDbName}`);
  }

  const report = {
    runId: id,
    generatedAt: nowIso(),
    status: 'running',
    database: dbConfig.database,
    adminDatabase,
    user: dbConfig.user,
    tempDbName: opts.skipRestoreTest ? null : tempDbName,
    skipRestoreTest: opts.skipRestoreTest,
    warning: null,
    steps: [],
    tableCount: 0,
    rowCountDiff: [],
    artifacts: {
      backupDump,
      backupList,
      reportJson,
      reportMd,
    },
    error: null,
  };

  const pgDumpCmd = resolvePgCommand('pg_dump');
  const pgRestoreCmd = resolvePgCommand('pg_restore');

  const pool = new Pool(dbConfig);
  const client = await pool.connect();
  let adminPool = null;
  let restorePool = null;

  try {
    await measureStep(report, 'precheck-pg-tools', async () => {
      execOrThrow(pgDumpCmd, ['--version'], { env: { ...process.env, PGPASSWORD: dbConfig.password } });
      execOrThrow(pgRestoreCmd, ['--version'], { env: { ...process.env, PGPASSWORD: dbConfig.password } });
      return { pgDumpCmd, pgRestoreCmd };
    });

    const capabilities = await measureStep(report, 'capability-check', async () =>
      fetchRoleCapabilities(client)
    );

    if (!opts.skipRestoreTest && !capabilities.role_can_createdb) {
      throw new Error(
        'Current DB role has no createdb privilege. Production acceptance requires full restore test.'
      );
    }

    if (opts.skipRestoreTest) {
      report.warning = 'Restore test was skipped by --skip-restore-test.';
    }

    const tables = await measureStep(report, 'list-public-tables', async () => listPublicTables(client));
    report.tableCount = tables.length;

    const sourceRowCounts = await measureStep(report, 'source-row-counts', async () =>
      rowCounts(client, 'public', tables)
    );

    await measureStep(report, 'backup-pg-dump', async () => {
      execOrThrow(
        pgDumpCmd,
        [
          '--format=custom',
          '--no-owner',
          '--no-privileges',
          '--host',
          dbConfig.host,
          '--port',
          String(dbConfig.port),
          '--username',
          dbConfig.user,
          '--dbname',
          dbConfig.database,
          '--file',
          backupDump,
        ],
        {
          env: {
            ...process.env,
            PGPASSWORD: dbConfig.password,
          },
        }
      );
      return { backupBytes: fs.statSync(backupDump).size };
    });

    await measureStep(report, 'backup-list-verify', async () => {
      const listOutput = execOrThrow(pgRestoreCmd, ['--list', backupDump], {
        env: {
          ...process.env,
          PGPASSWORD: dbConfig.password,
        },
      });
      fs.writeFileSync(backupList, listOutput, 'utf8');
      return { entries: listOutput.split(/\r?\n/).filter(Boolean).length };
    });

    if (!opts.skipRestoreTest) {
      adminPool = new Pool({ ...dbConfig, database: adminDatabase });
      const adminClient = await adminPool.connect();
      try {
        await measureStep(report, 'drop-temp-db-if-exists', async () => {
          await terminateConnections(adminClient, tempDbName);
          await adminClient.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(tempDbName)}`);
          return { tempDbName };
        });

        await measureStep(report, 'create-temp-db', async () => {
          await adminClient.query(`CREATE DATABASE ${quoteIdentifier(tempDbName)}`);
          return { tempDbName };
        });
      } finally {
        adminClient.release();
      }

      await measureStep(report, 'restore-to-temp-db', async () => {
        execOrThrow(
          pgRestoreCmd,
          [
            '--clean',
            '--if-exists',
            '--no-owner',
            '--no-privileges',
            '--host',
            dbConfig.host,
            '--port',
            String(dbConfig.port),
            '--username',
            dbConfig.user,
            '--dbname',
            tempDbName,
            backupDump,
          ],
          {
            env: {
              ...process.env,
              PGPASSWORD: dbConfig.password,
            },
          }
        );
        return { restoredTo: tempDbName };
      });

      restorePool = new Pool({ ...dbConfig, database: tempDbName });
      const restoreClient = await restorePool.connect();
      try {
        const restoredRowCounts = await measureStep(report, 'verify-restored-row-counts', async () =>
          rowCounts(restoreClient, 'public', tables)
        );
        report.rowCountDiff = diffCounts(sourceRowCounts, restoredRowCounts);
        if (report.rowCountDiff.length > 0) {
          throw new Error(`Row count mismatch: ${JSON.stringify(report.rowCountDiff)}`);
        }
      } finally {
        restoreClient.release();
      }
    }

    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = error.stack || error.message;
  } finally {
    if (restorePool) {
      await restorePool.end();
    }

    if (!opts.skipRestoreTest && adminPool) {
      const adminClient = await adminPool.connect();
      try {
        if (!opts.keepTempDb) {
          await terminateConnections(adminClient, tempDbName);
          await adminClient.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(tempDbName)}`);
        }
      } catch (cleanupError) {
        report.status = 'failed';
        const extra = `\nCleanupError: ${cleanupError.message}`;
        report.error = (report.error || '') + extra;
      } finally {
        adminClient.release();
      }
      await adminPool.end();
    }

    client.release();
    await pool.end();
  }

  fs.writeFileSync(reportJson, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(reportMd, formatMarkdown(report), 'utf8');

  console.log(`DB acceptance report generated:\n- ${reportJson}\n- ${reportMd}`);

  if (report.status !== 'passed') {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('db-backup-restore-acceptance failed:', error);
  process.exit(1);
});
