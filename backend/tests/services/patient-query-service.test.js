const test = require('node:test');
const assert = require('node:assert/strict');

const servicePath = require.resolve('../../src/services/PatientQueryService');
const repoPath = require.resolve('../../src/repositories/patientsRepository');

function loadServiceWithRepoMock(repoMock) {
  const originalRepo = require.cache[repoPath];
  const originalSvc = require.cache[servicePath];

  require.cache[repoPath] = { id: repoPath, filename: repoPath, loaded: true, exports: repoMock };
  delete require.cache[servicePath];
  const svc = require('../../src/services/PatientQueryService');

  return {
    svc,
    restore() {
      if (originalRepo) require.cache[repoPath] = originalRepo; else delete require.cache[repoPath];
      if (originalSvc) require.cache[servicePath] = originalSvc; else delete require.cache[servicePath];
    },
  };
}

test('PatientQueryService: listPatients returns paginated payload', async () => {
  const repoMock = {
    countPatients: async () => ({ rows: [{ count: '1' }] }),
    listPatients: async () => ({
      rows: [{
        id: 'p1',
        name: 'P1',
        dob: '1990-01-01',
        dialysis_start_date: '2020-01-01',
        phone_encrypted: null,
      }],
    }),
  };
  const { svc, restore } = loadServiceWithRepoMock(repoMock);
  try {
    const result = await svc.listPatients({}, { page: '1', page_size: '20' });
    assert.equal(result.total, 1);
    assert.equal(result.page, 1);
    assert.equal(result.pageSize, 20);
    assert.equal(result.list.length, 1);
    assert.equal(result.list[0].phone_encrypted, undefined);
  } finally {
    restore();
  }
});

test('PatientQueryService: getPatientDetail and consent image', async () => {
  const repoMock = {
    getConsentDialysisImagePaths: async () => ({ rows: [{ consent_dialysis_image_paths: ['uploads/a.jpg'] }] }),
    getPatientDetailCore: async () => ({
      rows: [{
        id: 'p1',
        name: 'P1',
        dob: '1990-01-01',
        dialysis_start_date: '2020-01-01',
        phone_encrypted: null,
        id_card_encrypted: null,
        consent_dialysis: true,
        consent_dialysis_date: '2026-01-01',
        consent_cvc: false,
        consent_cvc_date: null,
      }],
    }),
    listPatientActiveVascularAccesses: async () => ({ rows: [] }),
    listPatientRecentDialysis: async () => ({ rows: [] }),
    listPatientInfectionSummary: async () => ({ rows: [] }),
  };
  const { svc, restore } = loadServiceWithRepoMock(repoMock);
  try {
    const img = await svc.getConsentImagePath({}, 'p1', 0);
    assert.equal(img.exists, true);
    assert.equal(img.path, 'uploads/a.jpg');

    const detail = await svc.getPatientDetail({}, 'p1', 'nurse');
    assert.equal(detail.id, 'p1');
    assert.equal(Array.isArray(detail.vascular_accesses), true);
    assert.equal(detail.consents.dialysis, true);
  } finally {
    restore();
  }
});
