/**
 * 数据层演练：备份 -> 迁移模拟 -> 回滚 -> 恢复校验
 *
 * 说明：
 * - 当前账号通常无 createdb 权限，因此默认采用“同库多 schema”演练。
 * - 该脚本不会修改业务 schema（public），只在 drill_* schema 内操作。
 * - 产物输出到 docs/qa/release-hardening/generated/db-drill/<run-id>/
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
  'db-drill'
);

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || '',
};

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

function quoteIdentifier(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

function qn(schema, table) {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
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
  const roleSql = `
    SELECT
      current_user AS current_user,
      r.rolcreatedb AS role_can_createdb,
      has_database_privilege(current_user, current_database(), 'CREATE') AS db_can_create
    FROM pg_roles r
    WHERE r.rolname = current_user
  `;
  const { rows } = await client.query(roleSql);
  if (rows.length === 0) {
    return {
      current_user: null,
      role_can_createdb: false,
      db_can_create: false,
    };
  }
  return rows[0];
}

async function listTargetTables(client) {
  const preferred = [
    'users',
    'patients',
    'dialysis_records',
    'dialysis_schedules',
    'prescriptions',
    'infection_screenings',
    'vascular_access_records',
    'qc_metrics',
    'devices',
    'alerts',
  ];

  const { rows } = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);

  const existing = rows.map((r) => r.table_name);
  const pick = [];

  for (const t of preferred) {
    if (existing.includes(t)) pick.push(t);
  }
  for (const t of existing) {
    if (pick.length >= 10) break;
    if (!pick.includes(t)) pick.push(t);
  }

  if (pick.length === 0) {
    throw new Error('No tables found in public schema; cannot run drill.');
  }
  return pick;
}

async function dropSchemaIfExists(client, schemaName) {
  await client.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`);
}

async function createSchema(client, schemaName) {
  await client.query(`CREATE SCHEMA ${quoteIdentifier(schemaName)}`);
}

async function cloneTables(client, sourceSchema, targetSchema, tables) {
  for (const table of tables) {
    await client.query(
      `CREATE TABLE ${qn(targetSchema, table)} (LIKE ${qn(sourceSchema, table)} INCLUDING ALL)`
    );
    await client.query(
      `INSERT INTO ${qn(targetSchema, table)} SELECT * FROM ${qn(sourceSchema, table)}`
    );
  }
}

async function rowCounts(client, schemaName, tables) {
  const counts = {};
  for (const table of tables) {
    const { rows } = await client.query(`SELECT COUNT(*)::bigint AS c FROM ${qn(schemaName, table)}`);
    counts[table] = Number(rows[0].c);
  }
  return counts;
}

async function simulateMigration(client, schemaName, tables) {
  for (const table of tables) {
    await client.query(
      `ALTER TABLE ${qn(schemaName, table)} ADD COLUMN IF NOT EXISTS __drill_tmp_flag boolean DEFAULT false`
    );
    await client.query(`
      WITH picked AS (
        SELECT ctid
        FROM ${qn(schemaName, table)}
        LIMIT 5
      )
      UPDATE ${qn(schemaName, table)} t
      SET __drill_tmp_flag = true
      WHERE t.ctid IN (SELECT ctid FROM picked)
    `);
  }
}

async function restoreFromBackupSchema(client, backupSchema, workSchema, tables) {
  for (const table of tables) {
    await client.query(`DROP TABLE IF EXISTS ${qn(workSchema, table)} CASCADE`);
    await client.query(
      `CREATE TABLE ${qn(workSchema, table)} (LIKE ${qn(backupSchema, table)} INCLUDING ALL)`
    );
    await client.query(
      `INSERT INTO ${qn(workSchema, table)} SELECT * FROM ${qn(backupSchema, table)}`
    );
  }
}

function diffCounts(expected, actual) {
  const diff = [];
  for (const table of Object.keys(expected)) {
    const e = expected[table];
    const a = actual[table];
    if (e !== a) {
      diff.push({ table, expected: e, actual: a });
    }
  }
  return diff;
}

function mergeLimitation(existing, nextText) {
  if (!nextText) return existing || null;
  if (!existing) return nextText;
  if (existing.includes(nextText)) return existing;
  return `${existing} ${nextText}`;
}

function formatMarkdown(report) {
  const lines = [];
  lines.push('# DB Drill Rehearsal Report');
  lines.push('');
  lines.push(`- Run ID: \`${report.runId}\``);
  lines.push(`- Status: **${report.status}**`);
  lines.push(`- Generated At: ${report.generatedAt}`);
  lines.push(`- DB: \`${report.database}\``);
  lines.push(`- User: \`${report.user}\``);
  lines.push('');
  lines.push('## Drill Mode');
  lines.push('');
  lines.push(`- Mode: ${report.mode}`);
  lines.push(`- Limitation: ${report.limitation || 'None'}`);
  lines.push('');
  lines.push('## Target Tables');
  lines.push('');
  for (const t of report.tables || []) {
    lines.push(`- ${t}`);
  }
  lines.push('');
  lines.push('## Step Results');
  lines.push('');
  lines.push('| Step | Status | Duration(ms) |');
  lines.push('|---|---|---:|');
  for (const step of report.steps) {
    lines.push(`| ${step.name} | ${step.status} | ${step.durationMs} |`);
  }
  lines.push('');
  if (report.rowCountDiff && report.rowCountDiff.length > 0) {
    lines.push('## Row Count Differences');
    lines.push('');
    lines.push('| Table | Expected | Actual |');
    lines.push('|---|---:|---:|');
    for (const d of report.rowCountDiff) {
      lines.push(`| ${d.table} | ${d.expected} | ${d.actual} |`);
    }
    lines.push('');
  } else if (report.status === 'passed') {
    lines.push('## Row Count Verification');
    lines.push('');
    lines.push('- All target tables recovered to backup row counts.');
    lines.push('');
  } else {
    lines.push('## Row Count Verification');
    lines.push('');
    lines.push('- Verification incomplete because drill run did not finish.');
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

  const id = runId();
  const runDir = path.join(outputRoot, id);
  fs.mkdirSync(runDir, { recursive: true });

  const backupDump = path.join(runDir, `${dbConfig.database}-${id}.dump`);
  const backupList = path.join(runDir, `${dbConfig.database}-${id}.list`);
  const reportJson = path.join(runDir, 'db-drill-report.json');
  const reportMd = path.join(runDir, 'db-drill-report.md');

  const report = {
    runId: id,
    generatedAt: nowIso(),
    status: 'running',
    database: dbConfig.database,
    user: dbConfig.user,
    mode: 'schema-level',
    limitation: null,
    backupMethod: 'pg_dump',
    tables: [],
    steps: [],
    rowCounts: {
      backup: {},
      afterRestore: {},
    },
    rowCountDiff: [],
    artifacts: {
      backupDump,
      backupList,
      reportJson,
      reportMd,
    },
    error: null,
  };

  const pool = new Pool(dbConfig);
  const client = await pool.connect();

  const backupSchema = `drill_backup_${id.replace('-', '_')}`;
  const workSchema = `drill_work_${id.replace('-', '_')}`;
  let externalDumpSucceeded = true;

  try {
    await measureStep(report, 'db-backup', async () => {
      try {
        execOrThrow(
          'pg_dump',
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
        const stat = fs.statSync(backupDump);
        report.backupMethod = 'pg_dump';
        return { backupBytes: stat.size, backupMethod: report.backupMethod };
      } catch (error) {
        externalDumpSucceeded = false;
        report.backupMethod = 'schema-clone-fallback';
        report.limitation = mergeLimitation(
          report.limitation,
          `External pg_dump unavailable (${error.message}); fallback to schema-level logical backup rehearsal.`
        );
        fs.writeFileSync(
          backupDump,
          `pg_dump unavailable in current environment.\nFallback mode: schema-clone.\nReason: ${error.message}\n`,
          'utf8'
        );
        return { backupMethod: report.backupMethod, fallbackReason: error.message };
      }
    });

    await measureStep(report, 'backup-verify-list', async () => {
      if (!externalDumpSucceeded) {
        const note =
          'Skipped pg_restore --list because external pg_dump is unavailable; schema-level rehearsal continues.';
        fs.writeFileSync(backupList, `${note}\n`, 'utf8');
        return { skipped: true, reason: note };
      }

      const listOutput = execOrThrow('pg_restore', ['--list', backupDump], {
        env: {
          ...process.env,
          PGPASSWORD: dbConfig.password,
        },
      });
      fs.writeFileSync(backupList, listOutput, 'utf8');
      return { entries: listOutput.split(/\r?\n/).filter(Boolean).length };
    });

    const capabilities = await measureStep(report, 'capability-check', async () =>
      fetchRoleCapabilities(client)
    );
    if (!capabilities.role_can_createdb) {
      report.limitation = mergeLimitation(
        report.limitation,
        'Current DB role has no createdb privilege; rehearsal executed in schema-level isolation.'
      );
    }

    const tables = await measureStep(report, 'target-table-selection', async () =>
      listTargetTables(client)
    );
    report.tables = tables;

    await measureStep(report, 'prepare-drill-schemas', async () => {
      await dropSchemaIfExists(client, backupSchema);
      await dropSchemaIfExists(client, workSchema);
      await createSchema(client, backupSchema);
      await createSchema(client, workSchema);
      return { backupSchema, workSchema };
    });

    await measureStep(report, 'clone-public-into-drill-schemas', async () => {
      await cloneTables(client, 'public', backupSchema, tables);
      await cloneTables(client, 'public', workSchema, tables);
      return { tableCount: tables.length };
    });

    report.rowCounts.backup = await measureStep(report, 'baseline-row-counts', async () =>
      rowCounts(client, backupSchema, tables)
    );

    await measureStep(report, 'simulate-migration-on-work-schema', async () => {
      await simulateMigration(client, workSchema, tables);
      return { modifiedTables: tables.length };
    });

    await measureStep(report, 'rollback-restore-from-backup-schema', async () => {
      await restoreFromBackupSchema(client, backupSchema, workSchema, tables);
      return { restoredTables: tables.length };
    });

    report.rowCounts.afterRestore = await measureStep(report, 'verify-row-counts-after-restore', async () =>
      rowCounts(client, workSchema, tables)
    );

    report.rowCountDiff = diffCounts(report.rowCounts.backup, report.rowCounts.afterRestore);
    if (report.rowCountDiff.length > 0) {
      throw new Error(`Row count mismatch after restore: ${JSON.stringify(report.rowCountDiff)}`);
    }

    await measureStep(report, 'cleanup-drill-schemas', async () => {
      await dropSchemaIfExists(client, workSchema);
      await dropSchemaIfExists(client, backupSchema);
      return { cleaned: true };
    });

    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = error.stack || error.message;
    try {
      await dropSchemaIfExists(client, workSchema);
      await dropSchemaIfExists(client, backupSchema);
    } catch (cleanupError) {
      report.error += `\nCleanupError: ${cleanupError.message}`;
    }
  } finally {
    client.release();
    await pool.end();
  }

  fs.writeFileSync(reportJson, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(reportMd, formatMarkdown(report), 'utf8');

  console.log(`DB drill report generated:\n- ${reportJson}\n- ${reportMd}`);

  if (report.status !== 'passed') {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('db-drill-rehearsal failed:', error);
  process.exit(1);
});
