const test = require('node:test');
const assert = require('node:assert/strict');

const facadePath = require.resolve('../../src/services/PatientImportFacade');
const bulkPath = require.resolve('../../src/services/PatientBulkImportService');
const autoPath = require.resolve('../../src/services/PatientImportAutoService');
const historyPath = require.resolve('../../src/services/PatientHistoryFolderImportService');

function loadFacadeWithMocks({ bulk, auto, history }) {
  const originalBulk = require.cache[bulkPath];
  const originalAuto = require.cache[autoPath];
  const originalHistory = require.cache[historyPath];
  const originalFacade = require.cache[facadePath];

  require.cache[bulkPath] = { id: bulkPath, filename: bulkPath, loaded: true, exports: bulk };
  require.cache[autoPath] = { id: autoPath, filename: autoPath, loaded: true, exports: auto };
  require.cache[historyPath] = { id: historyPath, filename: historyPath, loaded: true, exports: history };
  delete require.cache[facadePath];
  const facade = require('../../src/services/PatientImportFacade');

  return {
    facade,
    restore() {
      if (originalBulk) require.cache[bulkPath] = originalBulk; else delete require.cache[bulkPath];
      if (originalAuto) require.cache[autoPath] = originalAuto; else delete require.cache[autoPath];
      if (originalHistory) require.cache[historyPath] = originalHistory; else delete require.cache[historyPath];
      if (originalFacade) require.cache[facadePath] = originalFacade; else delete require.cache[facadePath];
    },
  };
}

test('PatientImportFacade: bulk template dryRun keeps id null and precheck message', async () => {
  const { facade, restore } = loadFacadeWithMocks({
    bulk: {
      runImport: async () => ({ dry_run: true, imported: [{ id: 'id-1', name: 'A' }], imported_count: 1 }),
      buildTemplateWorkbookBuffer: async () => Buffer.from('xlsx'),
    },
    auto: { runImport: async () => ({ mode: 'bulk_template' }) },
    history: { runImport: async () => ({}) },
  });

  try {
    const result = await facade.importBulkTemplate({}, Buffer.from('x'), { dryRun: true, userId: 'u1' });
    assert.equal(result.message, '预检完成（未写入数据库）');
    assert.equal(result.data.id, null);
  } finally {
    restore();
  }
});

test('PatientImportFacade: auto import message follows mode', async () => {
  const { facade, restore } = loadFacadeWithMocks({
    bulk: { runImport: async () => ({ imported: [] }), buildTemplateWorkbookBuffer: async () => Buffer.from('xlsx') },
    auto: { runImport: async () => ({ mode: 'history_batch', patients_created: 1 }) },
    history: { runImport: async () => ({}) },
  });

  try {
    const result = await facade.importAuto({}, [{ originalname: 'a.xlsx' }], { dryRun: false, userId: 'u1' });
    assert.equal(result.message, '历史资料导入完成');
    assert.equal(result.data.mode, 'history_batch');
  } finally {
    restore();
  }
});

test('PatientImportFacade: history folder dryRun message', async () => {
  const { facade, restore } = loadFacadeWithMocks({
    bulk: { runImport: async () => ({ imported: [] }), buildTemplateWorkbookBuffer: async () => Buffer.from('xlsx') },
    auto: { runImport: async () => ({ mode: 'history_batch' }) },
    history: { runImport: async () => ({ files_count: 2, dry_run: true }) },
  });

  try {
    const result = await facade.importHistoryFolder({}, [{ originalname: 'a.xlsx' }], { dryRun: true, userId: 'u1' });
    assert.equal(result.message, '历史资料预检完成（未写入数据库）');
    assert.equal(result.data.dry_run, true);
  } finally {
    restore();
  }
});
