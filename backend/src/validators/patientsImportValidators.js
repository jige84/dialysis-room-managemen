const MAX_HISTORY_IMPORT_FILES = 300;

function mapImportUploadError(err, fallbackMessage) {
  if (!err) return fallbackMessage;
  if (err.code === 'LIMIT_FILE_COUNT') return `单次最多上传 ${MAX_HISTORY_IMPORT_FILES} 个 Excel 文件`;
  if (err.code === 'LIMIT_FILE_SIZE') return '单个文件不能超过 5MB';
  if (err.code === 'LIMIT_UNEXPECTED_FILE') return '上传字段不正确，请使用 files 字段上传 Excel 文件';
  return err.message || fallbackMessage;
}

function parseDryRunFlag(query) {
  const raw = String((query || {}).dry_run || '');
  return raw === '1' || raw.toLowerCase() === 'true';
}

function validateBulkImportFile(file) {
  if (!file || !file.buffer) {
    return { ok: false, message: '请上传 file 字段的 .xlsx 文件', statusCode: 400 };
  }
  return { ok: true, value: file };
}

function normalizeImportFiles(files) {
  return Array.isArray(files) ? files : [];
}

function validateHistoryImportFiles(files) {
  const normalized = normalizeImportFiles(files);
  if (normalized.length === 0) {
    return { ok: false, message: '请上传 files 字段的 .xlsx 文件', statusCode: 400 };
  }
  return { ok: true, value: normalized };
}

module.exports = {
  MAX_HISTORY_IMPORT_FILES,
  mapImportUploadError,
  parseDryRunFlag,
  validateBulkImportFile,
  validateHistoryImportFiles,
};
