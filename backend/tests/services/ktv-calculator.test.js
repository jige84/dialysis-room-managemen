const test = require('node:test');
const assert = require('node:assert/strict');
const KtvCalculator = require('../../src/services/KtvCalculator');

test('KtvCalculator: computes ktv/urr and threshold flags', () => {
  const result = KtvCalculator.calculate({
    preBUN: 22,
    postBUN: 8,
    ufVolumeMl: 2500,
    postWeightKg: 58,
    durationHours: 4,
  });

  assert.equal(typeof result.ktv, 'number');
  assert.equal(typeof result.urr, 'number');
  assert.equal(result.isKtvReached, result.ktv >= 1.2);
  assert.equal(result.isUrrReached, result.urr >= 65);
});

test('KtvCalculator: returns null metrics on invalid inputs', () => {
  const result = KtvCalculator.calculate({
    preBUN: 0,
    postBUN: 8,
    ufVolumeMl: 1000,
    postWeightKg: 60,
    durationHours: 4,
  });
  assert.deepEqual(result, {
    ktv: null,
    urr: null,
    isKtvReached: null,
    isUrrReached: null,
  });
});

