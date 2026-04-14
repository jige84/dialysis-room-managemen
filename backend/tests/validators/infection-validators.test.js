const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeTestType,
  validateLatestBatchPayload,
  normalizeScreeningItemsPayload,
  validateMonitoringPayload,
  validateMonitoringBatchPayload,
} = require('../../src/validators/infectionValidators');

test('infectionValidators: normalize test type aliases', () => {
  assert.equal(normalizeTestType('hcv'), 'hcvab');
  assert.equal(normalizeTestType('tp'), 'syphilis_tppa');
  assert.equal(normalizeTestType('hbsag'), 'hbsag');
});

test('infectionValidators: latest batch payload and uuid filter', () => {
  const payload = validateLatestBatchPayload({
    patient_ids: [
      'b4c7b1cd-edce-49b5-ab72-87e82e0f57ce',
      'bad-id',
      'b4c7b1cd-edce-49b5-ab72-87e82e0f57ce',
    ],
  });
  assert.equal(payload.ok, true);
  assert.equal(payload.value.length, 1);
});

test('infectionValidators: screening and monitoring payload validation', () => {
  const screen = normalizeScreeningItemsPayload([]);
  assert.equal(screen.ok, false);

  const monitorMissing = validateMonitoringPayload({});
  assert.equal(monitorMissing.ok, false);

  const monitorOk = validateMonitoringPayload({
    patient_id: 'p1',
    monitor_year: 2026,
    monitor_month: 4,
  });
  assert.equal(monitorOk.ok, true);

  const batchMissing = validateMonitoringBatchPayload({});
  assert.equal(batchMissing.ok, false);

  const batchOk = validateMonitoringBatchPayload({ records: [] });
  assert.equal(batchOk.ok, true);
});
