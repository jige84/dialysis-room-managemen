/**
 * 排班相关纯逻辑测试（无数据库依赖）
 * - DialysisScheduleExpansionService 展开规则
 * - 与 schedule.js 一致的 getWeekStart（周一）
 * - 与 schedule.js 一致的 mapIsolationToMachineZone
 */
const assert = require('assert');
const {
  expandDialysisScheduleCode,
  enumerateWeekDates,
} = require('../src/services/DialysisScheduleExpansionService');

/** 与 backend/src/routes/schedule.js 中 getWeekStart 一致 */
function getWeekStart(dateStr) {
  const d = new Date(dateStr);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - (day - 1));
  return d.toISOString().slice(0, 10);
}

/** 与 backend/src/routes/schedule.js 中 mapIsolationToMachineZone 一致 */
function mapIsolationToMachineZone(isolationZone) {
  if (isolationZone === 'hbv') return 'hbv';
  if (isolationZone === 'hcv') return 'hcv';
  return 'normal';
}

const weekStart = '2026-04-06'; // 周一

assert.deepStrictEqual(enumerateWeekDates(weekStart), [
  '2026-04-06',
  '2026-04-07',
  '2026-04-08',
  '2026-04-09',
  '2026-04-10',
  '2026-04-11',
  '2026-04-12',
]);

assert.strictEqual(getWeekStart('2026-04-07'), '2026-04-06', '周二应归到同一周一');
assert.strictEqual(getWeekStart('2026-04-12'), '2026-04-06', '周日应归到同一周一');
assert.strictEqual(getWeekStart('2026-04-06'), '2026-04-06', '周一自身');

assert.strictEqual(mapIsolationToMachineZone('hcv'), 'hcv');
assert.strictEqual(mapIsolationToMachineZone('hbv'), 'hbv');
assert.strictEqual(mapIsolationToMachineZone('normal'), 'normal');
assert.strictEqual(mapIsolationToMachineZone('last_shift'), 'normal', '末班专区走普通机位池');
assert.strictEqual(mapIsolationToMachineZone('observation'), 'normal');

const mwf = expandDialysisScheduleCode('tiw_mwf_morning', null, weekStart);
assert.strictEqual(mwf.length, 3);
assert(mwf.some((s) => s.scheduledDate === '2026-04-06' && s.shift === 'morning'));
assert(mwf.some((s) => s.scheduledDate === '2026-04-08' && s.shift === 'morning'));

const mwfPm = expandDialysisScheduleCode('tiw_mwf_afternoon', null, weekStart);
assert.strictEqual(mwfPm.length, 3);
assert(mwfPm.every((s) => s.shift === 'afternoon'));

const tts = expandDialysisScheduleCode('tiw_tts_morning', null, weekStart);
assert.strictEqual(tts.length, 3);
assert(tts.every((s) => s.scheduledDate >= '2026-04-07' && s.scheduledDate <= '2026-04-11'));
assert(tts.every((s) => s.shift === 'morning'));

const qod = expandDialysisScheduleCode('qod', '2026-04-06', weekStart);
assert.strictEqual(qod.length, 4, '锚点周一则本周一三五日同奇偶');
assert(qod.every((s) => s.shift === 'morning'));

assert.deepStrictEqual(expandDialysisScheduleCode('qod', null, weekStart), [], 'qod 无锚点则不展开');

const biw = expandDialysisScheduleCode('biw5_alt', null, weekStart);
assert(biw.length >= 1, 'biw5_alt 当周至少应有一天');
assert(biw.every((s) => s.shift === 'morning'));

assert.deepStrictEqual(expandDialysisScheduleCode('other', null, weekStart), []);

console.log('Schedule unit tests OK (expansion + week start + isolation map)');
