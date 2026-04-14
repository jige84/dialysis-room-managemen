const PatientBulkImportService = require('./PatientBulkImportService');
const PatientHistoryFolderImportService = require('./PatientHistoryFolderImportService');

const MAX_AUTO_IMPORT_FILES = 300;

function isXlsxFile(file) {
  const name = String(file?.originalname || file?.name || '').toLowerCase();
  return name.endsWith('.xlsx');
}

async function detectFileMode(file) {
  if (!file || !file.buffer || !isXlsxFile(file)) return 'unknown';
  try {
    const isTemplate = await PatientBulkImportService.detectTemplateWorkbook(file.buffer);
    if (isTemplate) return 'bulk_template';
  } catch (_) {
    // ignore template detection errors and continue with history detection
  }

  try {
    return await PatientHistoryFolderImportService.detectHistoryFileType(file);
  } catch (_) {
    return 'unknown';
  }
}

function toDetectedTypes(detections) {
  return Array.from(
    new Set(
      detections
        .map((item) => item.mode)
        .filter((mode) => mode && mode !== 'unknown'),
    ),
  );
}

function toAffectedPatientsFromBulk(result) {
  return result.imported.map((item) => ({
    id: item.id,
    name: item.name,
    action: result.dry_run ? 'preview' : 'created',
  }));
}

function toAffectedPatientsFromHistory(result) {
  return result.patients.map((item) => ({
    id: item.id,
    name: item.name,
    action: item.action,
  }));
}

function buildBulkAutoResult(result) {
  return {
    mode: 'bulk_template',
    dry_run: result.dry_run,
    files_count: 1,
    detected_file_types: ['bulk_template'],
    patients_created: result.imported_count,
    patients_updated: 0,
    labs_created: 0,
    orders_created: 0,
    dialysis_created: 0,
    row_errors: result.row_errors,
    unresolved_items: [],
    unsupported_files: [],
    affected_patients: toAffectedPatientsFromBulk(result),
    skipped_duplicates: result.skipped_duplicates,
  };
}

function buildHistoryAutoResult(result, detections) {
  return {
    mode: 'history_batch',
    dry_run: result.dry_run,
    files_count: result.files_count,
    detected_file_types: toDetectedTypes(detections),
    patients_created: result.patients_created,
    patients_updated: result.patients_updated,
    labs_created: result.labs_created,
    orders_created: result.orders_created,
    dialysis_created: result.dialysis_created || 0,
    row_errors: [],
    unresolved_items: result.unresolved_items,
    unsupported_files: result.unsupported_files,
    affected_patients: toAffectedPatientsFromHistory(result),
    skipped_duplicates: [],
  };
}

async function runImport(pool, files, options) {
  const { dryRun = false, actorUserId } = options || {};
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('请上传至少一个 Excel 文件');
  }
  if (files.length > MAX_AUTO_IMPORT_FILES) {
    throw new Error(`单次最多上传 ${MAX_AUTO_IMPORT_FILES} 个 Excel 文件`);
  }

  const validFiles = files.filter((file) => file?.buffer && isXlsxFile(file));
  if (validFiles.length === 0) {
    throw new Error('请上传 .xlsx 文件');
  }

  const detections = [];
  for (const file of validFiles) {
    detections.push({
      fileName: file.originalname || 'unknown.xlsx',
      mode: await detectFileMode(file),
    });
  }

  const templateFiles = detections.filter((item) => item.mode === 'bulk_template');
  if (templateFiles.length > 1) {
    throw new Error('标准模板导入一次只支持 1 个文件，请分开导入');
  }
  if (templateFiles.length === 1 && validFiles.length > 1) {
    throw new Error('标准模板文件不能与历史资料文件混合上传，请分开导入');
  }

  if (templateFiles.length === 1) {
    const templateFile = validFiles[0];
    const result = await PatientBulkImportService.runImport(pool, templateFile.buffer, {
      dryRun,
      createdByUserId: actorUserId,
    });
    return buildBulkAutoResult(result);
  }

  const historyResult = await PatientHistoryFolderImportService.runImport(pool, validFiles, {
    dryRun,
    actorUserId,
  });
  return buildHistoryAutoResult(historyResult, detections);
}

module.exports = {
  runImport,
};
