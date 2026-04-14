const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeWaterQualityListQuery,
  normalizeWaterQualityCreatePayload,
} = require('../../src/validators/devicesWaterQualityValidators');

test('devicesWaterQualityValidators: list query validates water_machine_id', () => {
  const bad = normalizeWaterQualityListQuery({ water_machine_id: 'bad' });
  assert.equal(bad.ok, false);
  assert.equal(bad.statusCode, 400);

  const ok = normalizeWaterQualityListQuery({ page: '2', page_size: '50' });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.page, 2);
  assert.equal(ok.value.page_size, 50);
});

test('devicesWaterQualityValidators: create payload normalizes type and values', () => {
  const missingDate = normalizeWaterQualityCreatePayload({});
  assert.equal(missingDate.ok, false);
  assert.equal(missingDate.message, '检测日期为必填项');

  const missingType = normalizeWaterQualityCreatePayload({
    test_date: '2026-04-14',
  });
  assert.equal(missingType.ok, false);
  assert.equal(missingType.statusCode, 400);

  const ok = normalizeWaterQualityCreatePayload({
    test_date: '2026-04-14',
    bacteria_count: 12,
    sample_point: 'RO',
    result: 'qualified',
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.test_type, 'bacteria_water');
  assert.equal(ok.value.result_unit, 'CFU/mL');
  assert.equal(ok.value.is_qualified, true);
});
