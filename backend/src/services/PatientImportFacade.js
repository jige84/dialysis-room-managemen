const PatientBulkImportService = require('./PatientBulkImportService');
const PatientHistoryFolderImportService = require('./PatientHistoryFolderImportService');
const PatientImportAutoService = require('./PatientImportAutoService');

async function buildTemplateWorkbookBuffer() {
  return PatientBulkImportService.buildTemplateWorkbookBuffer();
}

async function importBulkTemplate(pool, fileBuffer, options) {
  const { dryRun = false, userId } = options || {};
  const result = await PatientBulkImportService.runImport(pool, fileBuffer, {
    dryRun,
    createdByUserId: userId,
  });
  const firstId = result.imported.length ? result.imported[0].id : null;
  return {
    data: {
      ...result,
      id: dryRun ? null : firstId,
    },
    message: dryRun ? '预检完成（未写入数据库）' : '批量导入完成',
  };
}

async function importAuto(pool, files, options) {
  const { dryRun = false, userId } = options || {};
  const result = await PatientImportAutoService.runImport(pool, files, {
    dryRun,
    actorUserId: userId,
  });
  const message =
    result.mode === 'bulk_template'
      ? (dryRun ? '标准模板预检完成（未写入数据库）' : '标准模板导入完成')
      : (dryRun ? '历史资料预检完成（未写入数据库）' : '历史资料导入完成');
  return {
    data: result,
    message,
  };
}

async function importHistoryFolder(pool, files, options) {
  const { dryRun = false, userId } = options || {};
  const result = await PatientHistoryFolderImportService.runImport(pool, files, {
    dryRun,
    actorUserId: userId,
  });
  return {
    data: result,
    message: dryRun ? '历史资料预检完成（未写入数据库）' : '历史资料导入完成',
  };
}

module.exports = {
  buildTemplateWorkbookBuffer,
  importBulkTemplate,
  importAuto,
  importHistoryFolder,
};
