const test = require('node:test');
const assert = require('node:assert/strict');

const servicePath = require.resolve('../../src/services/DevicesMachineService');
const repoPath = require.resolve('../../src/repositories/devicesMachineRepository');

function loadServiceWithRepoMock(repoMock) {
  const originalRepo = require.cache[repoPath];
  const originalService = require.cache[servicePath];

  require.cache[repoPath] = { id: repoPath, filename: repoPath, loaded: true, exports: repoMock };
  delete require.cache[servicePath];
  const service = require('../../src/services/DevicesMachineService');

  return {
    service,
    restore() {
      if (originalRepo) require.cache[repoPath] = originalRepo; else delete require.cache[repoPath];
      if (originalService) require.cache[servicePath] = originalService; else delete require.cache[servicePath];
    },
  };
}

test('DevicesMachineService: createMachineAlert maps severity/priority', async () => {
  let captured = null;
  const repoMock = {
    createMachineAlert: async (_db, params) => {
      captured = params;
      return { rows: [{ id: 'a1' }] };
    },
    listMachines: async () => ({ rows: [] }),
    createMachine: async () => ({ rows: [] }),
    updateMachineFields: async () => ({ rows: [] }),
    updateMachineStatus: async () => ({ rows: [] }),
    deleteMachine: async () => ({ rows: [] }),
    listMachineMaintenance: async () => ({ rows: [] }),
    createMachineMaintenance: async () => ({ rows: [] }),
    listMachineAlerts: async () => ({ rows: [] }),
  };

  const { service, restore } = loadServiceWithRepoMock(repoMock);
  try {
    await service.createMachineAlert({}, 'm1', {
      alert_type: 'machine_alarm',
      priority: 'high',
      severity: '',
      title: 't',
      message: 'm',
    });
    assert.equal(Array.isArray(captured), true);
    assert.equal(captured[0], 'm1');
    assert.equal(captured[3], 'critical');
  } finally {
    restore();
  }
});

test('DevicesMachineService: patchMachine delegates update fields', async () => {
  let captured = null;
  const repoMock = {
    updateMachineFields: async (_db, id, updates, values) => {
      captured = { id, updates, values };
      return { rows: [{ id }] };
    },
    listMachines: async () => ({ rows: [] }),
    createMachine: async () => ({ rows: [] }),
    updateMachineStatus: async () => ({ rows: [] }),
    deleteMachine: async () => ({ rows: [] }),
    listMachineMaintenance: async () => ({ rows: [] }),
    createMachineMaintenance: async () => ({ rows: [] }),
    listMachineAlerts: async () => ({ rows: [] }),
    createMachineAlert: async () => ({ rows: [] }),
  };

  const { service, restore } = loadServiceWithRepoMock(repoMock);
  try {
    const result = await service.patchMachine({}, 'm2', ['model'], ['A']);
    assert.equal(result.rows[0].id, 'm2');
    assert.deepEqual(captured, { id: 'm2', updates: ['model'], values: ['A'] });
  } finally {
    restore();
  }
});
