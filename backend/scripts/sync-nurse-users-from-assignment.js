/**
 * 从「责任护士所管病人.xlsx」同步护士姓名到 users 表（仅创建缺失账号）。
 * 默认创建为 nurse + is_active=false，方便后续管理员手动开通。
 */
const path = require('path');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const { pool } = require('../src/config/database');

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeName(value) {
  return normalizeWhitespace(value).replace(/\s+/g, '');
}

function cellText(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) {
      return value.richText.map((item) => item.text || '').join('').trim();
    }
    if (typeof value.text === 'string') return value.text.trim();
    if (Object.prototype.hasOwnProperty.call(value, 'result')) return cellText(value.result);
    return '';
  }
  return String(value).trim();
}

function isLikelyPersonName(text) {
  const name = normalizeName(text);
  if (!name) return false;
  if (name.length < 2 || name.length > 4) return false;
  if (/\d/.test(name)) return false;
  if (/(护士|签名|医生|透析|记录|姓名|住院号|上机|下机|核对|性别|年龄|诊断|病情)/.test(name)) return false;
  return true;
}

function pickNurseHeaderRow(sheet) {
  const maxRows = Math.min(sheet.rowCount, 8);
  let best = null;
  for (let rowIndex = 1; rowIndex <= maxRows; rowIndex += 1) {
    const row = sheet.getRow(rowIndex);
    const cols = [];
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      const name = normalizeName(cellText(cell.value));
      if (!isLikelyPersonName(name)) return;
      cols.push({
        col,
        name,
        bold: Boolean(cell.font && cell.font.bold),
      });
    });
    if (cols.length === 0) continue;
    const boldCount = cols.filter((c) => c.bold).length;
    const score = cols.length * 10 + boldCount * 3 - rowIndex;
    if (!best || score > best.score) best = { rowIndex, cols, score };
  }
  return best;
}

function makePendingUsername(baseName, used, startSeq) {
  let seq = startSeq;
  while (seq < startSeq + 5000) {
    const username = `pending_nurse_${seq}_${baseName}`;
    if (!used.has(username)) {
      used.add(username);
      return { username, nextSeq: seq + 1 };
    }
    seq += 1;
  }
  throw new Error('无法生成唯一的待开通用户名');
}

async function main() {
  const defaultFile = path.resolve(__dirname, '../../2026lishshuju/责任护士所管病人.xlsx');
  const inputPath = process.argv[2] ? path.resolve(process.argv[2]) : defaultFile;

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(inputPath);
  const sheet = workbook.worksheets.find((item) => item.name.includes('责护')) || workbook.worksheets[0];
  if (!sheet) throw new Error('未找到责任护士分配表工作表');

  const header = pickNurseHeaderRow(sheet);
  if (!header || header.cols.length === 0) {
    throw new Error('未识别到护士姓名表头');
  }

  const nurseNames = [...new Set(header.cols.map((col) => col.name).filter(Boolean))];
  if (nurseNames.length === 0) {
    throw new Error('未识别到任何护士姓名');
  }

  const { rows: existingUsers } = await pool.query(
    'SELECT id, username, real_name FROM users ORDER BY created_at ASC',
  );
  const byRealName = new Map(existingUsers.map((u) => [normalizeName(u.real_name), u]));
  const usedUsernames = new Set(existingUsers.map((u) => u.username));
  let seqBase = Date.now() % 1000000;
  const created = [];
  const skipped = [];

  for (const nurseName of nurseNames) {
    const existed = byRealName.get(nurseName);
    if (existed) {
      skipped.push({ nurseName, reason: `已存在账号(${existed.username})` });
      continue;
    }

    const picked = makePendingUsername(nurseName, usedUsernames, seqBase);
    seqBase = picked.nextSeq;
    const tempPassword = `Temp#${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const hash = await bcrypt.hash(tempPassword, 12);

    const { rows } = await pool.query(
      `INSERT INTO users (username, password_hash, real_name, role, is_active, menu_permissions)
       VALUES ($1, $2, $3, 'nurse', false, NULL)
       RETURNING id, username, real_name, role, is_active, created_at`,
      [picked.username, hash, nurseName],
    );
    created.push(rows[0]);
  }

  console.log(
    JSON.stringify(
      {
        file: inputPath,
        detected_nurse_names: nurseNames,
        created_count: created.length,
        skipped_count: skipped.length,
        created,
        skipped,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });

