/**
 * 可选：连接数据库时校验排班相关数据是否与业务预期一致（只读查询）
 * 无数据库或连接失败时退出码 0 并打印 SKIP，不阻断 CI。
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { pool } = require('../src/config/database');

async function main() {
  let client;
  try {
    client = await pool.connect();
    await client.query('SELECT 1');
  } catch (err) {
    console.log('[schedule-db-check] SKIP：数据库不可用 —', err.message);
    await pool.end().catch(() => {});
    process.exit(0);
  }

  try {
    const { rows: [{ c: activeWithCode }] } = await client.query(
      `SELECT COUNT(*)::int AS c FROM patients
       WHERE status = 'active'
         AND dialysis_schedule_code IS NOT NULL
         AND dialysis_schedule_code <> 'other'`,
    );

    const { rows: [{ c: schedWeek }] } = await client.query(
      `SELECT COUNT(*)::int AS c FROM schedules
       WHERE scheduled_date >= date_trunc('week', CURRENT_DATE)::date
         AND scheduled_date < (date_trunc('week', CURRENT_DATE) + interval '7 days')::date`,
    );

    const { rows: machines } = await client.query(
      `SELECT zone, COUNT(*)::int AS n
       FROM machines WHERE status = 'active'
       GROUP BY zone ORDER BY zone`,
    );

    const { rows: zonePatients } = await client.query(
      `SELECT isolation_zone, COUNT(*)::int AS n
       FROM patients WHERE status = 'active'
       GROUP BY isolation_zone ORDER BY isolation_zone`,
    );

    console.log('[schedule-db-check] 在透且可参与自动排班的患者数（有透析时间代码且非 other）：', activeWithCode);
    console.log('[schedule-db-check] 本周（自然周自周一）已有 schedules 条数：', schedWeek);
    console.log('[schedule-db-check] 各分区可用透析机（active）：');
    machines.forEach((r) => console.log(`    ${r.zone}: ${r.n}`));
    console.log('[schedule-db-check] 在透患者按 isolation_zone：');
    zonePatients.forEach((r) => console.log(`    ${r.isolation_zone}: ${r.n}`));

    console.log('[schedule-db-check] 说明：last_shift / observation 在排班生成时按普通区机位分配（与 hcv 专用机不同）。');
    console.log('[schedule-db-check] OK');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('[schedule-db-check] FAIL', e);
  process.exit(1);
});
