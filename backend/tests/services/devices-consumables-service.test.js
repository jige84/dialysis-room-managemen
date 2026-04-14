const test = require('node:test');
const assert = require('node:assert/strict');

const servicePath = require.resolve('../../src/services/DevicesConsumablesService');
const repoPath = require.resolve('../../src/repositories/devicesConsumablesRepository');

function loadServiceWithRepoMock(repoMock) {
  const originalRepo = require.cache[repoPath];
  const originalService = require.cache[servicePath];

  require.cache[repoPath] = { id: repoPath, filename: repoPath, loaded: true, exports: repoMock };
  delete require.cache[servicePath];
  const service = require('../../src/services/DevicesConsumablesService');

  return {
    service,
    restore() {
      if (originalRepo) require.cache[repoPath] = originalRepo; else delete require.cache[repoPath];
      if (originalService) require.cache[servicePath] = originalService; else delete require.cache[servicePath];
    },
  };
}

test('DevicesConsumablesService: inbound uses transaction and returns batch row', async () => {
  const traces = [];
  const client = {
    async query(sql) { traces.push(sql); return { rows: [] }; },
    release() { traces.push('release'); },
  };

  const repoMock = {
    upsertConsumableBatch: async (_client, params) => ({ rows: [{ id: 'b1', lot_no: params[1] }] }),
    increaseConsumableStock: async () => ({}),
    listConsumableStocks: async () => ({ rows: [] }),
    createConsumableStock: async () => ({ rows: [] }),
    deleteConsumableStock: async () => ({ rows: [] }),
    getConsumableLastInbound: async () => ({ rows: [] }),
    listConsumableOutboundLines: async () => ({ rows: [] }),
    listConsumablePatientUsage: async () => ({ rows: [] }),
    countScheduledPatientsToday: async () => ({ rows: [{ scheduled_patients: 1 }] }),
    countConsumableOutboundToday: async () => ({ rows: [{ outbound_lines: 2 }] }),
    patchConsumableStockIncrease: async () => ({ rows: [] }),
    patchConsumableStockDecrease: async () => ({ rows: [] }),
    patchConsumableStockSet: async () => ({ rows: [] }),
  };
  const { service, restore } = loadServiceWithRepoMock(repoMock);
  try {
    const db = { connect: async () => client };
    const row = await service.inboundConsumable(db, {
      stock_item_id: 's1',
      lot_no: 'L1',
      quantity: 10,
      expiry_date: null,
      supplier: null,
      unit_price: null,
      notes: null,
    }, 'u1');
    assert.equal(row.id, 'b1');
    assert.equal(traces.some((s) => String(s).includes('BEGIN')), true);
    assert.equal(traces.some((s) => String(s).includes('COMMIT')), true);
  } finally {
    restore();
  }
});

test('DevicesConsumablesService: patch stock routes by operation', async () => {
  const calls = [];
  const repoMock = {
    patchConsumableStockIncrease: async () => { calls.push('in'); return { rows: [{ id: 's1' }] }; },
    patchConsumableStockDecrease: async () => { calls.push('out'); return { rows: [{ id: 's1' }] }; },
    patchConsumableStockSet: async () => { calls.push('set'); return { rows: [{ id: 's1' }] }; },
    upsertConsumableBatch: async () => ({ rows: [] }),
    increaseConsumableStock: async () => ({}),
    listConsumableStocks: async () => ({ rows: [] }),
    createConsumableStock: async () => ({ rows: [] }),
    deleteConsumableStock: async () => ({ rows: [] }),
    getConsumableLastInbound: async () => ({ rows: [] }),
    listConsumableOutboundLines: async () => ({ rows: [] }),
    listConsumablePatientUsage: async () => ({ rows: [] }),
    countScheduledPatientsToday: async () => ({ rows: [{ scheduled_patients: 1 }] }),
    countConsumableOutboundToday: async () => ({ rows: [{ outbound_lines: 2 }] }),
  };
  const { service, restore } = loadServiceWithRepoMock(repoMock);
  try {
    await service.patchConsumableStock({}, 's1', { operation: 'in', quantity: 1, notes: '' }, 'u1');
    await service.patchConsumableStock({}, 's1', { operation: 'out', quantity: 1, notes: '' }, 'u1');
    await service.patchConsumableStock({}, 's1', { operation: 'set', quantity: 1, notes: '' }, 'u1');
    assert.deepEqual(calls, ['in', 'out', 'set']);
  } finally {
    restore();
  }
});
