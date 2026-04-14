const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateWaterMachineCreatePayload,
  validateWaterMachineMaintenancePayload,
  validateLegacyMaintenancePayload,
  normalizeWaterDailyInspectionListQuery,
  validateWaterDailyInspectionCreatePayload,
} = require('../../src/validators/devicesWaterValidators');

test('devicesWaterValidators: water machine create requires machine_no', () => {
  const bad = validateWaterMachineCreatePayload({});
  assert.equal(bad.ok, false);
  assert.equal(bad.message, '水机编号为必填项');

  const ok = validateWaterMachineCreatePayload({ machine_no: 'W-01' });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.machine_no, 'W-01');
});

test('devicesWaterValidators: maintenance payload checks', () => {
  const bad = validateWaterMachineMaintenancePayload({ maintenance_type: 'routine' });
  assert.equal(bad.ok, false);

  const ok = validateWaterMachineMaintenancePayload({
    maintenance_type: 'routine',
    maintenance_date: '2026-04-14',
    content: 'check',
  });
  assert.equal(ok.ok, true);

  const legacyBad = validateLegacyMaintenancePayload({ maintenance_date: '2026-04-14' });
  assert.equal(legacyBad.ok, false);
});

test('devicesWaterValidators: daily inspection query/create', () => {
  const queryBad = normalizeWaterDailyInspectionListQuery({ water_machine_id: 'bad' });
  assert.equal(queryBad.ok, false);

  const queryOk = normalizeWaterDailyInspectionListQuery({ page: '2', page_size: '40' });
  assert.equal(queryOk.ok, true);
  assert.equal(queryOk.value.page, 2);
  assert.equal(queryOk.value.page_size, 40);

  const createBad = validateWaterDailyInspectionCreatePayload({});
  assert.equal(createBad.ok, false);

  const createOk = validateWaterDailyInspectionCreatePayload({
    check_date: '2026-04-14',
    operator_name: 'nurse',
  });
  assert.equal(createOk.ok, true);
  assert.equal(createOk.value.operator_name, 'nurse');
});
