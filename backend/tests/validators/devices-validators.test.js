const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateMachineCreatePayload,
  buildMachinePatchPayload,
  validateMachineMaintenancePayload,
  normalizeMachineAlertPayload,
} = require('../../src/validators/devicesValidators');

test('devicesValidators: machine create requires machine_no', () => {
  const bad = validateMachineCreatePayload({});
  assert.equal(bad.ok, false);
  assert.equal(bad.message, '机器编号为必填项');

  const ok = validateMachineCreatePayload({ machine_no: 'M-01', model: 'X' });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.machine_no, 'M-01');
  assert.equal(ok.value.model, 'X');
});

test('devicesValidators: machine patch collects allowed fields', () => {
  const bad = buildMachinePatchPayload({});
  assert.equal(bad.ok, false);
  assert.equal(bad.message, '无有效更新字段');

  const ok = buildMachinePatchPayload({ model: 'A', status: 'active', other: 'x' });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value.updates, ['model', 'status']);
  assert.deepEqual(ok.value.values, ['A', 'active']);
});

test('devicesValidators: maintenance and alert payload checks', () => {
  const maintenanceBad = validateMachineMaintenancePayload({ maintenance_type: 'regular' });
  assert.equal(maintenanceBad.ok, false);

  const maintenanceOk = validateMachineMaintenancePayload({
    maintenance_type: 'regular',
    maintenance_date: '2026-04-14',
    content: 'check',
  });
  assert.equal(maintenanceOk.ok, true);

  const alertBad = normalizeMachineAlertPayload({ title: 'x' });
  assert.equal(alertBad.ok, false);

  const alertOk = normalizeMachineAlertPayload({ title: 'x', message: 'y', severity: 'high' });
  assert.equal(alertOk.ok, true);
  assert.equal(alertOk.value.alert_type, 'machine_alarm');
});
