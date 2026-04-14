const test = require('node:test');
const assert = require('node:assert/strict');

const servicePath = require.resolve('../../src/services/DevicesWaterService');
const repoPath = require.resolve('../../src/repositories/devicesWaterRepository');

function loadServiceWithRepoMock(repoMock) {
  const originalRepo = require.cache[repoPath];
  const originalService = require.cache[servicePath];

  require.cache[repoPath] = { id: repoPath, filename: repoPath, loaded: true, exports: repoMock };
  delete require.cache[servicePath];
  const service = require('../../src/services/DevicesWaterService');

  return {
    service,
    restore() {
      if (originalRepo) require.cache[repoPath] = originalRepo; else delete require.cache[repoPath];
      if (originalService) require.cache[servicePath] = originalService; else delete require.cache[servicePath];
    },
  };
}

test('DevicesWaterService: list legacy maintenance with paging', async () => {
  let captured = null;
  const repoMock = {
    listLegacyMaintenance: async (_db, machineId, pageSize, offset) => {
      captured = { machineId, pageSize, offset };
      return { rows: [] };
    },
    listWaterMachines: async () => ({ rows: [] }),
    createWaterMachine: async () => ({ rows: [] }),
    deleteWaterMachine: async () => ({ rows: [] }),
    listWaterMachineMaintenance: async () => ({ rows: [] }),
    createWaterMachineMaintenance: async () => ({ rows: [] }),
    createLegacyMaintenance: async () => ({ rows: [] }),
    listWaterDailyInspections: async () => ({ rows: [] }),
    createWaterDailyInspection: async () => ({ rows: [{ id: 'i1', water_machine_id: null }] }),
    findWaterMachineById: async () => ({ rows: [] }),
  };
  const { service, restore } = loadServiceWithRepoMock(repoMock);
  try {
    await service.listLegacyMaintenance({}, { machine_id: 'm1', page: 2, page_size: 20 });
    assert.deepEqual(captured, { machineId: 'm1', pageSize: 20, offset: 20 });
  } finally {
    restore();
  }
});

test('DevicesWaterService: create daily inspection validates machine existence', async () => {
  const repoMock = {
    findWaterMachineById: async () => ({ rows: [] }),
    createWaterDailyInspection: async () => ({ rows: [{ id: 'i1', water_machine_id: null }] }),
    listWaterMachines: async () => ({ rows: [] }),
    createWaterMachine: async () => ({ rows: [] }),
    deleteWaterMachine: async () => ({ rows: [] }),
    listWaterMachineMaintenance: async () => ({ rows: [] }),
    createWaterMachineMaintenance: async () => ({ rows: [] }),
    listLegacyMaintenance: async () => ({ rows: [] }),
    createLegacyMaintenance: async () => ({ rows: [] }),
    listWaterDailyInspections: async () => ({ rows: [] }),
  };
  const { service, restore } = loadServiceWithRepoMock(repoMock);
  try {
    await assert.rejects(
      () => service.createWaterDailyInspection({}, { water_machine_id: 'wm1', check_date: '2026-04-14' }, 'u1'),
      (err) => err && err.statusCode === 400,
    );
  } finally {
    restore();
  }
});
