/**
 * 质控内部指标 API 与聚合 SQL 冒烟（需数据库；失败时 SKIP）
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { pool } = require('../src/config/database');
const QcRoutineMetricsService = require('../src/services/QcRoutineMetricsService');

async function main() {
  try {
    await pool.query('SELECT 1');
  } catch (err) {
    console.log('[test-qc-routine-metrics] SKIP:', err.message);
    process.exit(0);
  }

  try {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const data = await QcRoutineMetricsService.getRoutineMetrics(year, month);
    if (!data.metrics || data.metrics.length === 0) {
      console.error('[test-qc-routine-metrics] FAIL: empty metrics');
      process.exit(1);
    }
    const keys = data.metrics.map((m) => m.key);
    const expected = [
      'ktv_adequacy',
      'urr_adequacy',
      'anemia_control',
      'albumin_control',
      'ckd_mbd_control',
      'idwg_control',
      'bp_pre_control',
    ];
    const ok = expected.every((k) => keys.includes(k));
    if (!ok) {
      console.error('[test-qc-routine-metrics] FAIL: missing keys', keys);
      process.exit(1);
    }
    console.log('[test-qc-routine-metrics] OK', {
      period: `${data.period_start}..${data.period_end}`,
      n: data.metrics.length,
    });
  } catch (err) {
    console.error('[test-qc-routine-metrics] FAIL:', err.message);
    process.exit(1);
  } finally {
    await pool.end().catch(() => {});
  }
}

main();
