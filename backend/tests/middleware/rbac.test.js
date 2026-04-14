const test = require('node:test');
const assert = require('node:assert/strict');
const { rbac } = require('../../src/middleware/rbac');

function createRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test('rbac: quality and qc are treated as equivalent roles', () => {
  const mw = rbac(['quality']);
  const req = { user: { role: 'qc' } };
  const res = createRes();
  let nextCalled = false;

  mw(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});

test('rbac: rejects user without required role', () => {
  const mw = rbac(['doctor']);
  const req = { user: { role: 'nurse' } };
  const res = createRes();
  let nextCalled = false;

  mw(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 403);
});

