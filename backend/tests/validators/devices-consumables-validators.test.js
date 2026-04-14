const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateConsumableCreatePayload,
  validateConsumableInboundPayload,
  normalizeConsumableOutboundLinesQuery,
  validateConsumablePatientUsageQuery,
  validateConsumableStockPatchPayload,
} = require('../../src/validators/devicesConsumablesValidators');

test('devicesConsumablesValidators: create payload required fields', () => {
  const bad = validateConsumableCreatePayload({});
  assert.equal(bad.ok, false);
  assert.equal(bad.message, '品名、目录分类与单位为必填项');

  const ok = validateConsumableCreatePayload({ item_name: 'A', category: 'dialyzer', unit: '个' });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.item_name, 'A');
});

test('devicesConsumablesValidators: inbound payload required fields', () => {
  const bad = validateConsumableInboundPayload({ stock_item_id: 's1', quantity: 0, lot_no: '' });
  assert.equal(bad.ok, false);
  assert.equal(bad.message, '耗材、数量、批号为必填项');

  const ok = validateConsumableInboundPayload({ stock_item_id: 's1', quantity: 10, lot_no: 'L1' });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.quantity, 10);
});

test('devicesConsumablesValidators: list/patient/patch payload', () => {
  const list = normalizeConsumableOutboundLinesQuery({ page: '2', page_size: '15' });
  assert.equal(list.ok, true);
  assert.equal(list.value.page, 2);
  assert.equal(list.value.page_size, 15);

  const patientBad = validateConsumablePatientUsageQuery({});
  assert.equal(patientBad.ok, false);
  assert.equal(patientBad.message, 'patient_id 必填');

  const patchBad = validateConsumableStockPatchPayload({ notes: 'x' });
  assert.equal(patchBad.ok, false);
  assert.equal(patchBad.message, '数量为必填项');
});
