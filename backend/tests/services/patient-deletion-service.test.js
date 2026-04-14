const test = require('node:test');
const assert = require('node:assert/strict');

const servicePath = require.resolve('../../src/services/PatientDeletionService');
const repoPath = require.resolve('../../src/repositories/patientsRepository');

function loadServiceWithRepoMock(repoMock) {
  const originalRepo = require.cache[repoPath];
  const originalSvc = require.cache[servicePath];

  require.cache[repoPath] = { id: repoPath, filename: repoPath, loaded: true, exports: repoMock };
  delete require.cache[servicePath];
  const svc = require('../../src/services/PatientDeletionService');

  return {
    svc,
    restore() {
      if (originalRepo) require.cache[repoPath] = originalRepo; else delete require.cache[repoPath];
      if (originalSvc) require.cache[servicePath] = originalSvc; else delete require.cache[servicePath];
    },
  };
}

function createClient(recorder, lockRows, deleteRows) {
  return {
    async query(sql) {
      recorder.push(sql);
      if (String(sql).includes('BEGIN')) return { rows: [] };
      if (String(sql).includes('ROLLBACK')) return { rows: [] };
      if (String(sql).includes('COMMIT')) return { rows: [] };
      return { rows: [] };
    },
    release() {
      recorder.push('RELEASE');
    },
    __lockRows: lockRows,
    __deleteRows: deleteRows,
  };
}

test('PatientDeletionService: deletes patient in transaction', async () => {
  const recorder = [];
  const client = createClient(
    recorder,
    [{ id: 'p1', name: 'P1', consent_dialysis_image_paths: ['uploads/x.jpg'] }],
    [{ id: 'p1', name: 'P1' }],
  );

  const repoMock = {
    lockPatientForDelete: async () => ({ rows: client.__lockRows }),
    removePatientFromDefectReports: async () => ({}),
    deleteByPatientId: async () => ({}),
    deleteLongTermOrderChildren: async () => ({}),
    deleteLongTermOrders: async () => ({}),
    deletePatient: async () => ({ rows: client.__deleteRows }),
  };

  const { svc, restore } = loadServiceWithRepoMock(repoMock);
  try {
    const db = { connect: async () => client };
    const result = await svc.deletePatientCascade(db, 'p1');
    assert.equal(result.notFound, false);
    assert.equal(result.deleted.id, 'p1');
    assert.deepEqual(result.consentImagePaths, ['uploads/x.jpg']);
    assert.equal(recorder.some((x) => String(x).includes('BEGIN')), true);
    assert.equal(recorder.some((x) => String(x).includes('COMMIT')), true);
  } finally {
    restore();
  }
});

test('PatientDeletionService: returns notFound when lock row missing', async () => {
  const recorder = [];
  const client = createClient(recorder, [], []);
  const repoMock = {
    lockPatientForDelete: async () => ({ rows: [] }),
    removePatientFromDefectReports: async () => ({}),
    deleteByPatientId: async () => ({}),
    deleteLongTermOrderChildren: async () => ({}),
    deleteLongTermOrders: async () => ({}),
    deletePatient: async () => ({ rows: [] }),
  };

  const { svc, restore } = loadServiceWithRepoMock(repoMock);
  try {
    const db = { connect: async () => client };
    const result = await svc.deletePatientCascade(db, 'missing');
    assert.equal(result.notFound, true);
    assert.equal(recorder.some((x) => String(x).includes('ROLLBACK')), true);
  } finally {
    restore();
  }
});
