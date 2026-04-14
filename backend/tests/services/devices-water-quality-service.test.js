const test = require('node:test');
const assert = require('node:assert/strict');

const servicePath = require.resolve('../../src/services/DevicesWaterQualityService');
const repoPath = require.resolve('../../src/repositories/devicesWaterQualityRepository');

function loadServiceWithRepoMock(repoMock) {
  const originalRepo = require.cache[repoPath];
  const originalService = require.cache[servicePath];

  require.cache[repoPath] = { id: repoPath, filename: repoPath, loaded: true, exports: repoMock };
  delete require.cache[servicePath];
  const service = require('../../src/services/DevicesWaterQualityService');

  return {
    service,
    restore() {
      if (originalRepo) require.cache[repoPath] = originalRepo; else delete require.cache[repoPath];
      if (originalService) require.cache[servicePath] = originalService; else delete require.cache[servicePath];
    },
  };
}

test('DevicesWaterQualityService: list normalizes bacteria/endotoxin fields', async () => {
  const repoMock = {
    queryWaterQualityList: async () => ({
      rows: [
        { test_type: 'bacteria_water', result_value: '11', result_text: null, is_qualified: true, tested_by_name: '' },
        { test_type: 'endotoxin_water', result_value: '0.4', result_text: 'ok', is_qualified: null, tested_by_name: 'A' },
      ],
    }),
    insertWaterQualityRecord: async () => ({ rows: [] }),
    findWaterMachineById: async () => ({ rows: [] }),
    updateWaterMachineLatestTest: async () => ({}),
    getWaterMachineNoById: async () => ({ rows: [] }),
  };
  const { service, restore } = loadServiceWithRepoMock(repoMock);
  try {
    const rows = await service.listWaterQuality({}, { page: 1, page_size: 20 });
    assert.equal(rows[0].bacteria_count, 11);
    assert.equal(rows[0].result, 'qualified');
    assert.equal(rows[1].endotoxin_value, 0.4);
    assert.equal(rows[1].result, 'ok');
  } finally {
    restore();
  }
});

test('DevicesWaterQualityService: create validates water machine existence', async () => {
  const repoMock = {
    findWaterMachineById: async () => ({ rows: [] }),
    queryWaterQualityList: async () => ({ rows: [] }),
    insertWaterQualityRecord: async () => ({ rows: [{ id: 'r1', test_type: 'bacteria_water', result_value: 3 }] }),
    updateWaterMachineLatestTest: async () => ({}),
    getWaterMachineNoById: async () => ({ rows: [{ machine_no: 'W01' }] }),
  };
  const { service, restore } = loadServiceWithRepoMock(repoMock);
  try {
    await assert.rejects(
      () => service.createWaterQuality({}, {
        test_date: '2026-04-14',
        test_type: 'bacteria_water',
        sample_point: '产水点',
        result_value: 3,
        result_unit: 'CFU/mL',
        result_text: null,
        is_qualified: true,
        notes: null,
        water_machine_id: 'wm1',
        result_input: 'qualified',
      }, 'u1'),
      (err) => err && err.statusCode === 400,
    );
  } finally {
    restore();
  }
});
