const test = require('node:test');
const assert = require('node:assert/strict');
const { redactForLog } = require('../../src/utils/logRedactor');

test('logRedactor masks sensitive keys', () => {
  const src = {
    password: 'Shangu@2026',
    token: 'abcdef1234567890',
    nested: {
      phone: '13812345678',
    },
  };

  const masked = redactForLog(src);
  assert.notEqual(masked.password, src.password);
  assert.notEqual(masked.token, src.token);
  assert.notEqual(masked.nested.phone, src.nested.phone);
  assert.equal(masked.nested.phone.includes('*'), true);
});

test('logRedactor masks id-card style number in plain text', () => {
  const line = '患者身份证 130123199901017654 已提交';
  const masked = redactForLog(line);
  assert.equal(masked.includes('********'), true);
});
