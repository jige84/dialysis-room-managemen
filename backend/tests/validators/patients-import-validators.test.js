const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseDryRunFlag,
  validateBulkImportFile,
  validateHistoryImportFiles,
  mapImportUploadError,
} = require('../../src/validators/patientsImportValidators');

test('patientsImportValidators: parseDryRunFlag supports 1/true', () => {
  assert.equal(parseDryRunFlag({ dry_run: '1' }), true);
  assert.equal(parseDryRunFlag({ dry_run: 'true' }), true);
  assert.equal(parseDryRunFlag({ dry_run: 'TRUE' }), true);
  assert.equal(parseDryRunFlag({ dry_run: '0' }), false);
});

test('patientsImportValidators: validates bulk and history files', () => {
  const badBulk = validateBulkImportFile(null);
  assert.equal(badBulk.ok, false);
  assert.equal(badBulk.statusCode, 400);

  const goodBulk = validateBulkImportFile({ buffer: Buffer.from('x') });
  assert.equal(goodBulk.ok, true);

  const badHistory = validateHistoryImportFiles([]);
  assert.equal(badHistory.ok, false);

  const goodHistory = validateHistoryImportFiles([{ originalname: 'a.xlsx' }]);
  assert.equal(goodHistory.ok, true);
  assert.equal(goodHistory.value.length, 1);
});

test('patientsImportValidators: maps multer upload errors', () => {
  assert.equal(
    mapImportUploadError({ code: 'LIMIT_FILE_SIZE' }, 'fallback'),
    '单个文件不能超过 5MB',
  );
  assert.equal(
    mapImportUploadError({ code: 'LIMIT_UNEXPECTED_FILE' }, 'fallback'),
    '上传字段不正确，请使用 files 字段上传 Excel 文件',
  );
  assert.equal(
    mapImportUploadError({ code: 'UNKNOWN', message: 'x' }, 'fallback'),
    'x',
  );
});
