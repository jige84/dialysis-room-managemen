const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateCreatePatientRequiredFields,
  normalizeCreateScheduleFields,
  normalizeUpdateScheduleFields,
  parseUpdateProfileDryWeight,
} = require('../../src/validators/patientsValidators');

test('patientsValidators: create required fields and qod anchor', () => {
  const missing = validateCreatePatientRequiredFields({});
  assert.equal(missing.ok, false);

  const ok = validateCreatePatientRequiredFields({
    name: 'A',
    gender: 'M',
    dob: '1990-01-01',
    dialysis_start_date: '2020-01-01',
    primary_diagnosis: 'CKD',
    patient_identifier: 'HD-001',
  });
  assert.equal(ok.ok, true);

  const qodMissingAnchor = normalizeCreateScheduleFields({
    dialysis_schedule_code: 'qod',
    dialysis_schedule_anchor_date: '',
  });
  assert.equal(qodMissingAnchor.ok, false);
});

test('patientsValidators: update schedule normalization keeps anchor behavior', () => {
  const existing = { dialysis_schedule_code: 'qod', dialysis_schedule_anchor_date: '2026-01-01' };

  const toNonQod = normalizeUpdateScheduleFields({ dialysis_schedule_code: 'other' }, existing);
  assert.equal(toNonQod.ok, true);
  assert.equal(toNonQod.value.nextAnchor, null);

  const keepQodNoAnchor = normalizeUpdateScheduleFields({ dialysis_schedule_code: 'qod' }, { dialysis_schedule_code: null, dialysis_schedule_anchor_date: null });
  assert.equal(keepQodNoAnchor.ok, false);
});

test('patientsValidators: dry weight parser validates range and required date', () => {
  const invalidRange = parseUpdateProfileDryWeight({
    profile_dry_weight: 10,
    profile_dry_weight_date: '2026-01-01',
  });
  assert.equal(invalidRange.ok, false);

  const missingDate = parseUpdateProfileDryWeight({
    profile_dry_weight: 60,
    profile_dry_weight_date: '',
  });
  assert.equal(missingDate.ok, false);

  const ok = parseUpdateProfileDryWeight({
    profile_dry_weight: 60,
    profile_dry_weight_date: '2026-01-01',
    profile_dry_weight_reason: 'follow-up',
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.dw, 60);
  assert.equal(ok.value.dwd, '2026-01-01');
});
