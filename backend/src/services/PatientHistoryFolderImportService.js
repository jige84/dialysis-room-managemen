/**
 * 历史资料文件夹导入
 * 主要作用：解析多份历史 Excel，聚合为患者草稿，并按患者/化验/长期医嘱分批导入。
 * 首版范围：患者档案草稿、联系方式、责任护士、化验结果、长期医嘱；
 * 护理记录单支持最小可用自动导入（患者 + 日期 + 班次 + 核心体重/UF字段）。
 */
const ExcelJS = require('exceljs');
const { encrypt, decrypt } = require('../utils/encrypt');

const MAX_FILES = 300;
const MAX_FILE_SIZE = 5 * 1024 * 1024;

const LAB_FIELD_MAP = [
  { source: 'spKt/V（精准）', testType: 'ktv', unit: '' },
  { source: 'URR（%，自动）', testType: 'urr', unit: '%' },
  { source: '透前尿素氮C0（mmol/L）', testType: 'bun', unit: 'mmol/L' },
  { source: '透前β2-微球蛋白（mg/L）', testType: 'b2mg', unit: 'mg/L' },
  { source: '血红蛋白Hb（g/L）', testType: 'hb', unit: 'g/L' },
  { source: '血钙（mmol/L）', testType: 'ca', unit: 'mmol/L' },
  { source: '血磷（mmol/L）', testType: 'p', unit: 'mmol/L' },
  { source: 'iPTH（pg/mL）', testType: 'ipth', unit: 'pg/mL' },
];

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeName(value) {
  return normalizeWhitespace(value).replace(/\s+/g, '');
}

function normalizeIdCard(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeHeader(value) {
  return normalizeWhitespace(value).replace(/\s+/g, '');
}

function formatDateOnly(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDaysToDateKey(dateKey, offsetDays) {
  if (!dateKey || !Number.isFinite(offsetDays) || offsetDays === 0) return dateKey;
  const base = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(base.getTime())) return dateKey;
  base.setDate(base.getDate() + offsetDays);
  return formatDateOnly(base);
}

function cellToPlain(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date) return formatDateOnly(value);
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text || '').join('').trim();
    }
    if (typeof value.text === 'string') return value.text.trim();
    if (Object.prototype.hasOwnProperty.call(value, 'result')) return cellToPlain(value.result);
    if (Object.prototype.hasOwnProperty.call(value, 'error')) return '';
  }
  return String(value).trim();
}

function parseDateLike(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return formatDateOnly(value);
  if (typeof value === 'number' && Number.isFinite(value) && value > 20000 && value < 80000) {
    const epoch = Date.UTC(1899, 11, 30);
    return formatDateOnly(new Date(epoch + value * 86400000));
  }
  const text = cellToPlain(value);
  if (!text) return null;
  const normalized = text
    .replace(/[年/.]/g, '-')
    .replace(/月/g, '-')
    .replace(/日/g, '')
    .replace(/-+/g, '-')
    .trim();
  const ymd = normalized.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : formatDateOnly(parsed);
}

function parseGender(raw) {
  const text = normalizeWhitespace(raw).toLowerCase();
  if (!text) return null;
  if (['男', 'm', 'male', '1'].includes(text)) return 'M';
  if (['女', 'f', 'female', '2'].includes(text)) return 'F';
  return null;
}

function parseBoolean(raw) {
  const text = normalizeWhitespace(raw).toLowerCase();
  if (!text) return null;
  if (['是', 'true', '1', 'y', 'yes'].includes(text)) return true;
  if (['否', 'false', '0', 'n', 'no'].includes(text)) return false;
  return null;
}

function parseNumber(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(cellToPlain(raw));
  return Number.isFinite(n) ? n : null;
}

function parseSheetDateByName(sheetName, fileName) {
  const text = normalizeWhitespace(sheetName);
  if (!text) return null;
  const full = text.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:\s*\((\d+)\))?/);
  if (full) {
    const year = Number(full[1]);
    const month = Number(full[2]);
    const day = Number(full[3]);
    if (year >= 2000 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const base = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dupIndex = Number(full[4] || 1);
      if (Number.isFinite(dupIndex) && dupIndex > 1) return addDaysToDateKey(base, dupIndex - 1);
      return base;
    }
  }

  const monthDay = text.match(/(\d{1,2})\s*[-/.月]\s*(\d{1,2})(?:\s*\((\d+)\))?/);
  if (!monthDay) return null;
  const month = Number(monthDay[1]);
  const day = Number(monthDay[2]);
  if (!(month >= 1 && month <= 12 && day >= 1 && day <= 31)) return null;

  const yearFromFile = String(fileName || '').match(/(20\d{2})/);
  const year = yearFromFile ? Number(yearFromFile[1]) : new Date().getFullYear();
  const base = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const dupIndex = Number(monthDay[3] || 1);
  if (Number.isFinite(dupIndex) && dupIndex > 1) return addDaysToDateKey(base, dupIndex - 1);
  return base;
}

function inferPatientNameFromFileName(fileName) {
  const base = String(fileName || '').replace(/\.xlsx$/i, '');
  const matched = base.match(/^(.+?)[-_ ]*(?:护理|透析)记录单/);
  const name = normalizeName(matched ? matched[1] : '');
  return name || null;
}

function isLikelyPersonName(text) {
  const name = normalizeName(text);
  if (!name) return false;
  if (name.length < 2 || name.length > 4) return false;
  if (/\d/.test(name)) return false;
  if (/(护士|签名|医生|透析|记录|姓名|住院号|上机|下机|核对|性别|年龄|诊断|病情)/.test(name)) return false;
  return true;
}

function findTextNearLabel(sheet, labelKeywords, maxOffset = 16) {
  for (let rowIndex = 1; rowIndex <= sheet.rowCount; rowIndex += 1) {
    const row = sheet.getRow(rowIndex);
    for (let col = 1; col <= row.cellCount; col += 1) {
      const label = normalizeWhitespace(cellToPlain(row.getCell(col).value));
      if (!label) continue;
      if (!labelKeywords.some((keyword) => label.includes(keyword))) continue;

      for (let offset = 1; offset <= maxOffset; offset += 1) {
        const value = normalizeWhitespace(cellToPlain(row.getCell(col + offset).value));
        if (!value) continue;
        if (labelKeywords.some((keyword) => value.includes(keyword))) continue;
        return value;
      }
    }
  }
  return null;
}

function findNumberNearLabel(sheet, labelKeywords, maxOffset = 20) {
  for (let rowIndex = 1; rowIndex <= sheet.rowCount; rowIndex += 1) {
    const row = sheet.getRow(rowIndex);
    for (let col = 1; col <= row.cellCount; col += 1) {
      const label = normalizeWhitespace(cellToPlain(row.getCell(col).value));
      if (!label) continue;
      if (!labelKeywords.some((keyword) => label.includes(keyword))) continue;

      for (let offset = 1; offset <= maxOffset; offset += 1) {
        const value = parseNumber(row.getCell(col + offset).value);
        if (value != null) return value;
      }
    }
  }
  return null;
}

function parseSheetShift(sheetName) {
  const text = normalizeWhitespace(sheetName).toLowerCase();
  if (text.includes('晚') || text.includes('夜') || text.includes('evening')) return 'evening';
  if (text.includes('下午') || text.includes('中班') || text.includes('afternoon')) return 'afternoon';
  return 'morning';
}

function toDialysisDurationMinutes(hoursOrMinutes) {
  if (hoursOrMinutes == null) return null;
  if (hoursOrMinutes > 0 && hoursOrMinutes <= 24) {
    const minutes = Math.round(hoursOrMinutes * 60);
    return minutes >= 30 && minutes <= 24 * 60 ? minutes : null;
  }
  if (hoursOrMinutes > 24 && hoursOrMinutes <= 24 * 60) {
    const minutes = Math.round(hoursOrMinutes);
    return minutes >= 30 && minutes <= 24 * 60 ? minutes : null;
  }
  return null;
}

function normalizeDialysisWeight(value) {
  if (value == null) return null;
  if (value < 20 || value > 250) return null;
  return value;
}

function normalizeDialysisUf(value) {
  if (value == null) return null;
  if (value < 0 || value > 20) return null;
  return value;
}

function normalizeDialysisDurationHours(value) {
  if (value == null) return null;
  if (value < 0.5 || value > 8) return null;
  return value;
}

function normalizeDialysisFlowRate(value) {
  if (value == null) return null;
  if (value < 20 || value > 800) return null;
  return Math.round(value);
}

function normalizeHeparinDose(value) {
  if (value == null) return null;
  if (value < 100 || value > 20000) return null;
  return Math.round(value);
}

function normalizeDialysisTemperature(value) {
  if (value == null) return null;
  if (value < 30 || value > 45) return null;
  return Math.round(value * 10) / 10;
}

function normalizeCoagulationGrade(value) {
  if (value == null) return null;
  const rounded = Math.round(value);
  if (rounded < 0 || rounded > 3) return null;
  return rounded;
}

function parseTimeLabel(raw) {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    const hh = String(raw.getHours()).padStart(2, '0');
    const mm = String(raw.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw < 1) {
    const totalMinutes = Math.round(raw * 24 * 60);
    const hh = String(Math.floor(totalMinutes / 60) % 24).padStart(2, '0');
    const mm = String(totalMinutes % 60).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  const text = normalizeWhitespace(cellToPlain(raw)).replace(/：/g, ':');
  if (!text) return null;
  const normalizedDate = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (normalizedDate && text.length >= 10) {
    const parsedDateTime = new Date(text);
    if (!Number.isNaN(parsedDateTime.getTime())) {
      const hh = String(parsedDateTime.getHours()).padStart(2, '0');
      const mm = String(parsedDateTime.getMinutes()).padStart(2, '0');
      return `${hh}:${mm}`;
    }
  }
  const hhmm = text.match(/([01]?\d|2[0-3])\s*:\s*([0-5]\d)/);
  if (hhmm) {
    return `${String(Number(hhmm[1])).padStart(2, '0')}:${hhmm[2]}`;
  }
  const hourOnly = text.match(/^([01]?\d|2[0-3])$/);
  if (hourOnly) return `${String(Number(hourOnly[1])).padStart(2, '0')}:00`;
  return null;
}

function parseBpPair(raw) {
  const text = normalizeWhitespace(cellToPlain(raw)).replace(/[／]/g, '/');
  if (!text) return { systolic: null, diastolic: null };
  const match = text.match(/(\d{2,3})\s*\/\s*(\d{2,3})/);
  if (!match) return { systolic: null, diastolic: null };
  const systolic = Number(match[1]);
  const diastolic = Number(match[2]);
  if (!Number.isFinite(systolic) || !Number.isFinite(diastolic)) {
    return { systolic: null, diastolic: null };
  }
  return {
    systolic: systolic >= 50 && systolic <= 260 ? Math.round(systolic) : null,
    diastolic: diastolic >= 20 && diastolic <= 160 ? Math.round(diastolic) : null,
  };
}

function normalizeSmallInt(raw, min, max) {
  const value = parseNumber(raw);
  if (value == null) return null;
  const rounded = Math.round(value);
  if (rounded < min || rounded > max) return null;
  return rounded;
}

function getRowCellValueNear(row, startCol, maxSpan = 4) {
  if (!startCol || !Number.isFinite(startCol)) return null;
  for (let offset = 0; offset <= maxSpan; offset += 1) {
    const cell = row.getCell(startCol + offset);
    const text = normalizeWhitespace(cellToPlain(cell.value));
    if (text) return cell.value;
  }
  return null;
}

function findPersonNameNearLabel(sheet, labelKeywords, maxOffset = 80) {
  for (let rowIndex = 1; rowIndex <= sheet.rowCount; rowIndex += 1) {
    const row = sheet.getRow(rowIndex);
    for (let col = 1; col <= row.cellCount; col += 1) {
      const label = normalizeWhitespace(cellToPlain(row.getCell(col).value));
      if (!label) continue;
      if (!labelKeywords.some((keyword) => label.includes(keyword))) continue;

      for (let offset = 1; offset <= maxOffset; offset += 1) {
        const valueRaw = cellToPlain(row.getCell(col + offset).value);
        if (!valueRaw) continue;
        const value = normalizeName(valueRaw);
        if (!value) continue;
        if (isLikelyPersonName(value)) return value;
      }
    }
  }
  return null;
}

function parseNursingVitalSigns(sheet, sessionDate) {
  let headerRowIndex = null;
  const headerCols = {
    time: null,
    bp: null,
    pulse: null,
    ap: null,
    vp: null,
    tmp: null,
    bloodFlow: null,
    temp: null,
    note: null,
  };

  for (let rowIndex = 1; rowIndex <= sheet.rowCount; rowIndex += 1) {
    const row = sheet.getRow(rowIndex);
    let hasTime = false;
    let hasBp = false;
    let hasPulse = false;

    for (let col = 1; col <= row.cellCount; col += 1) {
      const text = normalizeHeader(cellToPlain(row.getCell(col).value));
      if (!text) continue;
      if (text.includes('时间')) {
        hasTime = true;
        if (!headerCols.time) headerCols.time = col;
      }
      if (text.includes('血压') || text === 'BP') {
        hasBp = true;
        if (!headerCols.bp) headerCols.bp = col;
      }
      if (text.includes('心率') || text.includes('脉搏') || text === 'P') {
        hasPulse = true;
        if (!headerCols.pulse) headerCols.pulse = col;
      }
      if ((text.includes('动脉压') || text.includes('AP')) && !headerCols.ap) headerCols.ap = col;
      if ((text.includes('静脉压') || text.includes('VP')) && !headerCols.vp) headerCols.vp = col;
      if ((text.includes('跨膜压') || text.includes('TMP')) && !headerCols.tmp) headerCols.tmp = col;
      if (text.includes('血流速') && !headerCols.bloodFlow) headerCols.bloodFlow = col;
      if ((text.includes('温度') || text.includes('体温')) && !headerCols.temp) headerCols.temp = col;
      if (text.includes('病情变化') && !headerCols.note) headerCols.note = col;
    }

    if (hasTime && hasBp && hasPulse) {
      headerRowIndex = rowIndex;
      break;
    }
  }

  if (!headerRowIndex || !headerCols.time) return [];

  const vitals = [];
  let emptyStreak = 0;
  const maxRows = Math.min(sheet.rowCount, headerRowIndex + 24);
  for (let rowIndex = headerRowIndex + 1; rowIndex <= maxRows; rowIndex += 1) {
    const row = sheet.getRow(rowIndex);
    const leftText = normalizeHeader(
      `${cellToPlain(row.getCell(1).value)} ${cellToPlain(row.getCell(2).value)} ${cellToPlain(row.getCell(3).value)}`
    );
    if (leftText.includes('下机后')) break;

    const timeLabel = parseTimeLabel(getRowCellValueNear(row, headerCols.time, 4));
    const bpValue = getRowCellValueNear(row, headerCols.bp, 8);
    const bp = parseBpPair(bpValue);
    const pulse = normalizeSmallInt(getRowCellValueNear(row, headerCols.pulse, 4), 20, 220);
    const ap = normalizeSmallInt(getRowCellValueNear(row, headerCols.ap, 4), -500, 100);
    const vp = normalizeSmallInt(getRowCellValueNear(row, headerCols.vp, 4), -50, 400);
    const tmp = normalizeSmallInt(getRowCellValueNear(row, headerCols.tmp, 4), -100, 400);
    const bodyTemp = normalizeDialysisTemperature(parseNumber(getRowCellValueNear(row, headerCols.temp, 4)));
    const note = normalizeWhitespace(cellToPlain(getRowCellValueNear(row, headerCols.note, 8))) || null;

    const hasMetric =
      bp.systolic != null ||
      bp.diastolic != null ||
      pulse != null ||
      ap != null ||
      vp != null ||
      tmp != null ||
      bodyTemp != null ||
      note;

    if (!hasMetric) {
      emptyStreak += 1;
      if (emptyStreak >= 6 && vitals.length > 0) break;
      continue;
    }
    emptyStreak = 0;

    vitals.push({
      sequence_no: vitals.length + 1,
      time_label: timeLabel || null,
      record_time: timeLabel ? `${sessionDate} ${timeLabel}:00` : null,
      systolic_bp: bp.systolic,
      diastolic_bp: bp.diastolic,
      heart_rate: pulse,
      arterial_pressure: ap,
      venous_pressure: vp,
      tmp,
      body_temp: bodyTemp,
      notes: note,
    });
  }

  return vitals;
}

function inferDobGenderFromIdCard(idCard) {
  const normalized = normalizeIdCard(idCard);
  const match = normalized.match(/^(\d{6})(\d{4})(\d{2})(\d{2})(\d{3})([\dX])$/);
  if (!match) return { dob: null, gender: null };
  return {
    dob: `${match[2]}-${match[3]}-${match[4]}`,
    gender: Number(match[5]) % 2 === 0 ? 'F' : 'M',
  };
}

function extractPrimaryDiagnosis(text) {
  const source = normalizeWhitespace(text);
  if (!source) return null;
  const parts = source
    .split(/(?=\d+[.、])/)
    .map((item) => item.replace(/^\d+[.、]\s*/, '').trim())
    .filter(Boolean);
  return parts[0] || source || null;
}

function buildOrderFrequency(raw) {
  const text = normalizeWhitespace(raw);
  const lower = text.toLowerCase();
  if (!text) return { frequency: 'custom', frequency_detail: null };
  if (text.includes('透析时使用')) return { frequency: 'every_session', frequency_detail: null };
  if (text.includes('每日1次') || lower === 'qd') return { frequency: 'qd', frequency_detail: null };
  if (text.includes('每日2次') || lower === 'bid') return { frequency: 'bid', frequency_detail: null };
  if (text.includes('每日3次') || lower === 'tid') return { frequency: 'tid', frequency_detail: null };
  if (text.includes('每周3次') || lower === 'tiw') return { frequency: 'tiw', frequency_detail: null };
  if (text.includes('每周2次') || lower === 'biw') return { frequency: 'biw', frequency_detail: null };
  if (text.includes('每周1次') || lower === 'qw') return { frequency: 'qw', frequency_detail: null };
  if (text.includes('每2周1次') || lower === 'q2w') return { frequency: 'q2w', frequency_detail: null };
  if (text.includes('每月1次') || lower === 'qm') return { frequency: 'qm', frequency_detail: null };
  return { frequency: 'custom', frequency_detail: text };
}

function buildExecuteTiming(raw) {
  const text = normalizeWhitespace(raw);
  if (!text) return 'anytime';
  if (text.includes('透析中')) return 'during_dialysis';
  if (text.includes('透析前')) return 'pre_dialysis';
  if (text.includes('下机前') || text.includes('透析后')) return 'post_dialysis';
  return 'anytime';
}

function buildOrderType(rawFrequency, rawType) {
  const freq = normalizeWhitespace(rawFrequency);
  const type = normalizeWhitespace(rawType);
  return freq.includes('透析时使用') || type.includes('透析') ? 'dialysis_drug' : 'interval_drug';
}

function buildNotes(parts) {
  return parts.filter(Boolean).join('；') || null;
}

function createEmptyParseResult() {
  return {
    patientDraftInputs: [],
    nurseAssignments: [],
    labEntries: [],
    orderEntries: [],
    dialysisEntries: [],
    unresolvedItems: [],
    unsupportedFiles: [],
  };
}

function mergeParseResult(target, next) {
  target.patientDraftInputs.push(...next.patientDraftInputs);
  target.nurseAssignments.push(...next.nurseAssignments);
  target.labEntries.push(...next.labEntries);
  target.orderEntries.push(...next.orderEntries);
  target.dialysisEntries.push(...next.dialysisEntries);
  target.unresolvedItems.push(...next.unresolvedItems);
  target.unsupportedFiles.push(...next.unsupportedFiles);
}

function rowToObject(row, headerMap) {
  const obj = {};
  headerMap.forEach((header, col) => {
    obj[header] = row.getCell(col).value;
  });
  return obj;
}

function classifyFile(fileName, workbook) {
  if (fileName.includes('患者联系方式登记表')) return 'contacts';
  if (fileName.includes('责任护士所管病人')) return 'nurse_assignment';
  if (fileName.includes('病历首页')) return 'medical_home';
  if (fileName.includes('化验记录表')) return 'labs';
  if (fileName.includes('医嘱记录单')) return 'orders';
  if (fileName.includes('护理记录单') || fileName.includes('透析记录单')) return 'nursing_record';

  const firstSheet = workbook.worksheets[0];
  const row1 = firstSheet ? firstSheet.getRow(1) : null;
  const row2 = firstSheet ? firstSheet.getRow(2) : null;
  const row1Text = row1
    ? row1.values.slice(1).map((value) => normalizeHeader(cellToPlain(value))).join('|')
    : '';
  const row2Text = row2
    ? row2.values.slice(1).map((value) => normalizeHeader(cellToPlain(value))).join('|')
    : '';

  if (row2Text.includes('家庭住址') && row2Text.includes('联系方式1')) return 'contacts';
  if (row1Text.includes('患者ID') && row1Text.includes('患者姓名') && row1Text.includes('简单病史')) return 'medical_home';
  if (row1Text.includes('spKt/V') || row1Text.includes('透前尿素氮C0')) return 'labs';
  if (row1Text.includes('用药品种') && row1Text.includes('是否持续使用')) return 'orders';
  if (row1Text.includes('透析记录') || row1Text.includes('血液透析间期') || row1Text.includes('上机前')) return 'nursing_record';
  return 'unknown';
}

async function detectHistoryFileType(file) {
  if (!file || !file.buffer) return 'unknown';
  const fileName = file.originalname || `file-${Date.now()}.xlsx`;
  const workbook = await loadWorkbookFromBuffer(file);
  return classifyFile(fileName, workbook);
}

class DraftStore {
  constructor() {
    this.drafts = [];
    this.codeMap = new Map();
    this.idCardMap = new Map();
    this.nameDobMap = new Map();
    this.nameMap = new Map();
    this.sequence = 1;
  }

  registerIndex(draft) {
    if (draft.patientCode) this.codeMap.set(draft.patientCode, draft);
    if (draft.id_card) this.idCardMap.set(draft.id_card, draft);
    if (draft.name && draft.dob) this.nameDobMap.set(`${draft.name}|${draft.dob}`, draft);
    if (draft.name) {
      const bucket = this.nameMap.get(draft.name) || [];
      if (!bucket.includes(draft)) bucket.push(draft);
      this.nameMap.set(draft.name, bucket);
    }
  }

  pickDraft(input) {
    if (input.patientCode && this.codeMap.has(input.patientCode)) return this.codeMap.get(input.patientCode);
    if (input.id_card && this.idCardMap.has(input.id_card)) return this.idCardMap.get(input.id_card);
    if (input.name && input.dob && this.nameDobMap.has(`${input.name}|${input.dob}`)) {
      return this.nameDobMap.get(`${input.name}|${input.dob}`);
    }
    if (input.name) {
      const byName = this.nameMap.get(input.name) || [];
      if (byName.length === 1) return byName[0];
    }
    return null;
  }

  createDraft(input) {
    const draft = {
      draftId: `draft-${this.sequence++}`,
      patientCode: input.patientCode || null,
      name: input.name || null,
      gender: input.gender || null,
      dob: input.dob || null,
      id_card: input.id_card || null,
      phone: input.phone || null,
      family_contact: input.family_contact_phone ? { phone: input.family_contact_phone } : null,
      address: input.address || null,
      primary_diagnosis: input.primary_diagnosis || null,
      present_illness: input.present_illness || null,
      past_history: input.past_history || null,
      dialysis_start_date: input.dialysis_start_date || null,
      sourceFiles: new Set([input.fileName]),
      rowRefs: [`${input.fileName}:${input.rowIndex}`],
      responsibleNurseNames: new Set(),
    };
    this.drafts.push(draft);
    this.registerIndex(draft);
    return draft;
  }

  upsert(input) {
    const draft = this.pickDraft(input) || this.createDraft(input);
    if (input.patientCode && !draft.patientCode) draft.patientCode = input.patientCode;
    if (input.name && !draft.name) draft.name = input.name;
    if (input.gender && !draft.gender) draft.gender = input.gender;
    if (input.dob && !draft.dob) draft.dob = input.dob;
    if (input.id_card && !draft.id_card) draft.id_card = input.id_card;
    if (input.phone && !draft.phone) draft.phone = input.phone;
    if (input.family_contact_phone) {
      draft.family_contact = draft.family_contact || {};
      if (!draft.family_contact.phone) draft.family_contact.phone = input.family_contact_phone;
    }
    if (input.address && !draft.address) draft.address = input.address;
    if (input.primary_diagnosis && !draft.primary_diagnosis) draft.primary_diagnosis = input.primary_diagnosis;
    if (input.present_illness && !draft.present_illness) draft.present_illness = input.present_illness;
    if (input.past_history && !draft.past_history) draft.past_history = input.past_history;
    if (input.dialysis_start_date && !draft.dialysis_start_date) draft.dialysis_start_date = input.dialysis_start_date;
    draft.sourceFiles.add(input.fileName);
    draft.rowRefs.push(`${input.fileName}:${input.rowIndex}`);
    if (draft.id_card && (!draft.dob || !draft.gender)) {
      const inferred = inferDobGenderFromIdCard(draft.id_card);
      if (!draft.dob && inferred.dob) draft.dob = inferred.dob;
      if (!draft.gender && inferred.gender) draft.gender = inferred.gender;
    }
    this.registerIndex(draft);
    return draft;
  }
}

async function loadWorkbookFromBuffer(file) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(file.buffer);
  return workbook;
}

async function parseContactsWorkbook(workbook, fileName) {
  const result = createEmptyParseResult();
  const sheet = workbook.worksheets.find((item) => item.rowCount > 1) || workbook.worksheets[0];
  if (!sheet) {
    result.unsupportedFiles.push({ fileName, reason: '工作簿为空' });
    return result;
  }

  const headerRow = sheet.getRow(2);
  const headers = new Map();
  headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
    headers.set(col, normalizeHeader(cellToPlain(cell.value)));
  });

  for (let rowIndex = 3; rowIndex <= sheet.rowCount; rowIndex += 1) {
    const row = rowToObject(sheet.getRow(rowIndex), headers);
    const name = normalizeName(row.姓名);
    const idCard = normalizeIdCard(row.证件号);
    const phone1 = normalizeWhitespace(row.联系方式1);
    const phone2 = normalizeWhitespace(row.联系方式2);
    const address = normalizeWhitespace(row.家庭住址);
    if (!name && !idCard && !phone1 && !phone2 && !address) continue;
    result.patientDraftInputs.push({
      source: 'contacts',
      fileName,
      rowIndex,
      patientCode: null,
      name,
      id_card: idCard || null,
      phone: phone1 || null,
      family_contact_phone: phone2 || null,
      address: address || null,
    });
  }

  return result;
}

async function parseNurseAssignmentWorkbook(workbook, fileName) {
  const result = createEmptyParseResult();
  const sheet = workbook.worksheets.find((item) => item.name.includes('责护')) || workbook.worksheets[0];
  if (!sheet) {
    result.unsupportedFiles.push({ fileName, reason: '未找到责任护士分配表' });
    return result;
  }

  function parseNurseColumnsFromRow(row) {
    const cols = [];
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      const nurseName = normalizeName(cellToPlain(cell.value));
      if (!nurseName) return;
      if (!isLikelyPersonName(nurseName)) return;
      cols.push({
        col,
        nurseName,
        isBold: Boolean(cell.font && cell.font.bold),
      });
    });
    return cols;
  }

  const candidateRows = Math.min(sheet.rowCount, 8);
  let best = null;
  for (let rowIndex = 1; rowIndex <= candidateRows; rowIndex += 1) {
    const row = sheet.getRow(rowIndex);
    const cols = parseNurseColumnsFromRow(row);
    if (cols.length === 0) continue;
    const boldCount = cols.filter((item) => item.isBold).length;
    const score = cols.length * 10 + boldCount * 3 - rowIndex;
    if (!best || score > best.score) {
      best = { rowIndex, cols, score };
    }
  }

  const fallbackCols = parseNurseColumnsFromRow(sheet.getRow(2));
  const nurseColumns = (best && best.cols.length >= 2 ? best.cols : fallbackCols)
    .map((item) => ({ col: item.col, nurseName: item.nurseName }));
  const headerRowIndex = best && best.cols.length >= 2 ? best.rowIndex : 2;

  if (nurseColumns.length === 0) {
    result.unresolvedItems.push({
      category: 'nurse_assignment',
      fileName,
      rowIndex: 1,
      patientName: null,
      reason: '责任护士表头未识别到护士姓名列，请检查首行/次行是否为护士姓名',
    });
    return result;
  }

  for (const nurseColumn of nurseColumns) {
    for (let rowIndex = headerRowIndex + 1; rowIndex <= sheet.rowCount; rowIndex += 1) {
      const patientName = normalizeName(cellToPlain(sheet.getRow(rowIndex).getCell(nurseColumn.col).value));
      if (!patientName || !isLikelyPersonName(patientName)) continue;
      result.patientDraftInputs.push({
        source: 'nurse_assignment',
        fileName,
        rowIndex,
        patientCode: null,
        name: patientName,
      });
      result.nurseAssignments.push({
        fileName,
        rowIndex,
        patientName,
        nurseName: nurseColumn.nurseName,
      });
    }
  }

  return result;
}

async function parseMedicalHomeWorkbook(workbook, fileName) {
  const result = createEmptyParseResult();
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    result.unsupportedFiles.push({ fileName, reason: '病历首页工作表为空' });
    return result;
  }

  const headers = new Map();
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
    headers.set(col, normalizeHeader(cellToPlain(cell.value)));
  });

  const merged = {};
  for (let rowIndex = 2; rowIndex <= sheet.rowCount; rowIndex += 1) {
    const row = rowToObject(sheet.getRow(rowIndex), headers);
    Object.keys(row).forEach((key) => {
      const value = cellToPlain(row[key]);
      if (value && !merged[key]) merged[key] = value;
    });
  }

  const name = normalizeName(merged.患者姓名);
  if (!name) {
    result.unresolvedItems.push({
      category: 'patient_draft',
      fileName,
      rowIndex: 2,
      patientName: null,
      reason: '病历首页未识别到患者姓名',
    });
    return result;
  }

  result.patientDraftInputs.push({
    source: 'medical_home',
    fileName,
    rowIndex: 2,
    patientCode: normalizeWhitespace(merged.患者ID) || null,
    name,
    gender: parseGender(merged.性别),
    dialysis_start_date: parseDateLike(merged.透析起始日期),
    present_illness: normalizeWhitespace(merged.患者一般情况) || null,
    past_history: normalizeWhitespace(merged.简单病史) || null,
    primary_diagnosis: extractPrimaryDiagnosis(merged.简单病史),
  });
  return result;
}

async function parseLabWorkbook(workbook, fileName) {
  const result = createEmptyParseResult();
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    result.unsupportedFiles.push({ fileName, reason: '化验记录工作表为空' });
    return result;
  }

  const headers = new Map();
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
    headers.set(col, normalizeHeader(cellToPlain(cell.value)));
  });

  let currentPatientCode = '';
  let currentPatientName = '';
  let currentDate = null;
  for (let rowIndex = 3; rowIndex <= sheet.rowCount; rowIndex += 1) {
    const row = rowToObject(sheet.getRow(rowIndex), headers);
    const patientCode = normalizeWhitespace(row.患者ID) || currentPatientCode;
    const patientName = normalizeName(row.患者姓名) || currentPatientName;
    const testDate = parseDateLike(row['化验日期（2025-01-01）']) || currentDate;
    const metrics = LAB_FIELD_MAP.map((item) => ({
      ...item,
      value: parseNumber(row[item.source]),
    })).filter((item) => item.value != null);

    if (!patientName && !patientCode && !testDate && metrics.length === 0) continue;
    currentPatientCode = patientCode;
    currentPatientName = patientName;
    currentDate = testDate;

    if (!patientName) {
      result.unresolvedItems.push({
        category: 'lab_patient',
        fileName,
        rowIndex,
        patientName: null,
        reason: '化验记录缺少患者姓名，无法关联患者',
      });
      continue;
    }
    if (!testDate) {
      if (metrics.length > 0) {
        result.unresolvedItems.push({
          category: 'lab_date',
          fileName,
          rowIndex,
          patientName,
          reason: '化验记录缺少有效日期，已跳过该行',
        });
      }
      continue;
    }

    result.patientDraftInputs.push({
      source: 'labs',
      fileName,
      rowIndex,
      patientCode: patientCode || null,
      name: patientName,
    });

    const notes = buildNotes([
      parseNumber(row['透后尿素氮C1（mmol/L）']) != null ? `透后尿素氮C1=${parseNumber(row['透后尿素氮C1（mmol/L）'])} mmol/L` : null,
      parseNumber(row['透后β2-微球蛋白（mg/L）']) != null ? `透后β2-微球蛋白=${parseNumber(row['透后β2-微球蛋白（mg/L）'])} mg/L` : null,
      parseNumber(row['透前体重（kg）']) != null ? `透前体重=${parseNumber(row['透前体重（kg）'])} kg` : null,
      parseNumber(row['透后体重（kg）']) != null ? `透后体重=${parseNumber(row['透后体重（kg）'])} kg` : null,
      parseNumber(row['超滤量UF（kg）']) != null ? `UF=${parseNumber(row['超滤量UF（kg）'])} kg` : null,
      normalizeWhitespace(row['综合达标判定']) ? `综合达标判定=${normalizeWhitespace(row['综合达标判定'])}` : null,
      normalizeWhitespace(row.数据备注) ? `备注=${normalizeWhitespace(row.数据备注)}` : null,
      '来源=历史化验记录表',
    ]);

    metrics.forEach((metric) => {
      result.labEntries.push({
        fileName,
        rowIndex,
        patientCode: patientCode || null,
        patientName,
        test_date: testDate,
        test_type: metric.testType,
        value: metric.value,
        unit: metric.unit,
        notes,
      });
    });
  }

  return result;
}

async function parseOrderWorkbook(workbook, fileName) {
  const result = createEmptyParseResult();
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    result.unsupportedFiles.push({ fileName, reason: '医嘱记录工作表为空' });
    return result;
  }

  const headers = new Map();
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
    headers.set(col, normalizeHeader(cellToPlain(cell.value)));
  });

  let currentPatientCode = '';
  let currentPatientName = '';
  let currentDate = null;
  for (let rowIndex = 2; rowIndex <= sheet.rowCount; rowIndex += 1) {
    const row = rowToObject(sheet.getRow(rowIndex), headers);
    const patientCode = normalizeWhitespace(row.患者ID) || currentPatientCode;
    const patientName = normalizeName(row.患者姓名) || currentPatientName;
    const orderDate = parseDateLike(row['用药日期（2025-01-01）']) || currentDate;
    const drugName = normalizeWhitespace(row['用药品种（手动录入）']);
    const isContinuous = parseBoolean(row['是否持续使用（是/否）']);

    if (!patientCode && !patientName && !drugName) continue;
    currentPatientCode = patientCode;
    currentPatientName = patientName;
    currentDate = orderDate;

    if (!patientName) {
      result.unresolvedItems.push({
        category: 'order_patient',
        fileName,
        rowIndex,
        patientName: null,
        reason: '医嘱记录缺少患者姓名，无法关联患者',
      });
      continue;
    }
    if (!drugName) continue;

    result.patientDraftInputs.push({
      source: 'orders',
      fileName,
      rowIndex,
      patientCode: patientCode || null,
      name: patientName,
    });

    if (isContinuous === false) {
      result.unresolvedItems.push({
        category: 'order_not_continuous',
        fileName,
        rowIndex,
        patientName,
        reason: `医嘱「${drugName}」标记为非持续使用，首版未自动导入`,
      });
      continue;
    }

    const rawType = normalizeWhitespace(row.用药类型);
    const rawFrequency = normalizeWhitespace(row.用药频次);
    const rawRoute = normalizeWhitespace(row.用药方法);
    const doseText = normalizeWhitespace(row.用药剂量);
    const unit = normalizeWhitespace(row.剂量规格);
    const doctorName = normalizeName(row.医生签名);
    const freq = buildOrderFrequency(rawFrequency);

    result.orderEntries.push({
      fileName,
      rowIndex,
      patientCode: patientCode || null,
      patientName,
      valid_from: orderDate,
      order_type: buildOrderType(rawFrequency, rawType),
      drug_name: drugName,
      dose: doseText || null,
      dose_unit: unit || null,
      route: rawRoute || null,
      frequency: freq.frequency,
      frequency_detail: freq.frequency_detail,
      execute_timing: buildExecuteTiming(rawRoute),
      doctor_name: doctorName || null,
      notes: buildNotes([
        rawType ? `原始类型=${rawType}` : null,
        rawFrequency ? `原始频次=${rawFrequency}` : null,
        normalizeWhitespace(row.备注) ? `备注=${normalizeWhitespace(row.备注)}` : null,
        '来源=历史医嘱记录单',
      ]),
    });
  }

  return result;
}

async function parseNursingRecordWorkbook(workbook, fileName) {
  const result = createEmptyParseResult();
  const fileNamePatient = inferPatientNameFromFileName(fileName);
  let parsedCount = 0;

  for (let sheetIndex = 0; sheetIndex < workbook.worksheets.length; sheetIndex += 1) {
    const sheet = workbook.worksheets[sheetIndex];
    if (!sheet) continue;

    const patientNameFromSheet = findTextNearLabel(sheet, ['姓名']);
    const patientNameRaw = isLikelyPersonName(patientNameFromSheet) ? patientNameFromSheet : fileNamePatient;
    const patientName = normalizeName(patientNameRaw);
    const sessionDate = parseSheetDateByName(sheet.name, fileName);
    const shift = parseSheetShift(sheet.name);

    if (!patientName) {
      result.unresolvedItems.push({
        category: 'dialysis_patient',
        fileName,
        rowIndex: sheetIndex + 1,
        patientName: null,
        reason: `护理记录单工作表「${sheet.name}」未识别到患者姓名，无法导入透析记录`,
      });
      continue;
    }
    if (!sessionDate) {
      result.unresolvedItems.push({
        category: 'dialysis_date',
        fileName,
        rowIndex: sheetIndex + 1,
        patientName,
        reason: `护理记录单工作表「${sheet.name}」未识别到透析日期，已留待人工处理`,
      });
      continue;
    }

    const preWeight = normalizeDialysisWeight(findNumberNearLabel(sheet, ['透前体重'], 40));
    const postWeight = normalizeDialysisWeight(findNumberNearLabel(sheet, ['透后体重'], 40));
    const ufVolume = normalizeDialysisUf(findNumberNearLabel(sheet, ['实际脱水', '实际超滤量'], 40));
    const durationHours = normalizeDialysisDurationHours(findNumberNearLabel(sheet, ['实际透析时间'], 40));
    const bloodFlowRate = normalizeDialysisFlowRate(findNumberNearLabel(sheet, ['血流速'], 40));
    const dialysateTemp = normalizeDialysisTemperature(findNumberNearLabel(sheet, ['温度', '体温'], 40));
    const heparinPrimeDose = normalizeHeparinDose(findNumberNearLabel(sheet, ['首剂'], 40));
    const coagulationGrade = normalizeCoagulationGrade(findNumberNearLabel(sheet, ['滤器凝血', '凝血情况'], 40));
    const diagnosisText = normalizeWhitespace(findTextNearLabel(sheet, ['诊断'], 60));
    const accessHint = normalizeWhitespace(findTextNearLabel(sheet, ['通路', '置管', '内瘘'], 60));
    let isAvfSession = null;
    if (accessHint) {
      if (/(导管|置管|tcc|cvc)/i.test(accessHint)) isAvfSession = false;
      if (/(内瘘|avf|avg)/i.test(accessHint)) isAvfSession = true;
    }

    const nurseName =
      findPersonNameNearLabel(sheet, ['上机护士', '护士签名', '穿刺护士', '二次核对护士'], 80) ||
      (() => {
        const nurseNameRaw = findTextNearLabel(sheet, ['上机护士', '护士签名', '穿刺护士', '二次核对护士'], 80);
        return isLikelyPersonName(nurseNameRaw) ? normalizeName(nurseNameRaw) : null;
      })();

    const vitalSigns = parseNursingVitalSigns(sheet, sessionDate);
    const notes = buildNotes([
      `来源=历史护理记录单:${fileName}/${sheet.name}`,
      preWeight != null ? `透前体重=${preWeight}kg` : null,
      postWeight != null ? `透后体重=${postWeight}kg` : null,
      ufVolume != null ? `实际超滤量=${ufVolume}` : null,
      durationHours != null ? `实际透析时长=${durationHours}h` : null,
      bloodFlowRate != null ? `血流速=${bloodFlowRate}` : null,
      dialysateTemp != null ? `透析液温度=${dialysateTemp}` : null,
      heparinPrimeDose != null ? `肝素首剂=${heparinPrimeDose}` : null,
      coagulationGrade != null ? `滤器凝血分级=${coagulationGrade}` : null,
      diagnosisText ? `诊断=${diagnosisText}` : null,
      vitalSigns.length ? `生命体征行数=${vitalSigns.length}` : null,
      nurseName ? `表内护士=${nurseName}` : null,
    ]);

    result.patientDraftInputs.push({
      source: 'nursing_record',
      fileName,
      rowIndex: sheetIndex + 1,
      patientCode: null,
      name: patientName,
    });

    result.dialysisEntries.push({
      fileName,
      sheetName: sheet.name,
      rowIndex: sheetIndex + 1,
      patientCode: null,
      patientName,
      session_date: sessionDate,
      shift,
      pre_weight: preWeight,
      post_weight: postWeight,
      uf_volume: ufVolume,
      actual_duration: toDialysisDurationMinutes(durationHours),
      blood_flow_rate: bloodFlowRate,
      dialysate_temp: dialysateTemp,
      heparin_prime_dose: heparinPrimeDose,
      coagulation_grade: coagulationGrade,
      is_avf_session: isAvfSession,
      vital_signs: vitalSigns,
      nurse_name: nurseName,
      notes,
    });
    parsedCount += 1;
  }

  if (parsedCount === 0) {
    result.unresolvedItems.push({
      category: 'nursing_record',
      fileName,
      rowIndex: 1,
      patientName: fileNamePatient,
      reason: '已识别为护理记录单，但未提取到可自动导入的透析记录，请人工补录',
    });
  }
  return result;
}

async function parseFiles(files) {
  if (!Array.isArray(files) || files.length === 0) throw new Error('请至少上传一个 Excel 文件');
  if (files.length > MAX_FILES) throw new Error(`单次最多上传 ${MAX_FILES} 个文件`);

  const aggregate = createEmptyParseResult();
  for (const file of files) {
    if (!file || !file.buffer) continue;
    const fileName = file.originalname || `file-${Date.now()}.xlsx`;
    if (file.size > MAX_FILE_SIZE) {
      aggregate.unsupportedFiles.push({
        fileName,
        reason: `文件超过 ${Math.floor(MAX_FILE_SIZE / 1024 / 1024)}MB 限制`,
      });
      continue;
    }
    const workbook = await loadWorkbookFromBuffer(file);
    const fileType = classifyFile(fileName, workbook);
    let parsed = createEmptyParseResult();
    if (fileType === 'contacts') parsed = await parseContactsWorkbook(workbook, fileName);
    else if (fileType === 'nurse_assignment') parsed = await parseNurseAssignmentWorkbook(workbook, fileName);
    else if (fileType === 'medical_home') parsed = await parseMedicalHomeWorkbook(workbook, fileName);
    else if (fileType === 'labs') parsed = await parseLabWorkbook(workbook, fileName);
    else if (fileType === 'orders') parsed = await parseOrderWorkbook(workbook, fileName);
    else if (fileType === 'nursing_record') parsed = await parseNursingRecordWorkbook(workbook, fileName);
    else parsed.unsupportedFiles.push({ fileName, reason: '未识别的历史资料类型' });
    mergeParseResult(aggregate, parsed);
  }
  return aggregate;
}

async function loadExistingPatients(client) {
  const { rows } = await client.query(
    `SELECT id, name, dob, gender, id_card_encrypted, phone_encrypted, family_contact, address,
            primary_diagnosis, present_illness, past_history, dialysis_start_date, responsible_nurse_id
       FROM patients`
  );
  return rows.map((row) => {
    let decryptedIdCard = null;
    let decryptedPhone = null;
    try {
      decryptedIdCard = decrypt(row.id_card_encrypted);
    } catch (_) {
      decryptedIdCard = null;
    }
    try {
      decryptedPhone = decrypt(row.phone_encrypted);
    } catch (_) {
      decryptedPhone = null;
    }
    return {
      ...row,
      name_normalized: normalizeName(row.name),
      dob_key: row.dob ? formatDateOnly(new Date(row.dob)) : null,
      id_card_plain: normalizeIdCard(decryptedIdCard),
      phone_plain: normalizeWhitespace(decryptedPhone),
    };
  });
}

async function loadUsersForImport(client) {
  const { rows } = await client.query(
    `SELECT id, real_name, role
       FROM users
      WHERE is_active = true
        AND role IN ('doctor', 'nurse', 'head_nurse')
      ORDER BY real_name ASC`
  );
  const nursesByName = new Map();
  const doctorsByName = new Map();
  rows.forEach((row) => {
    const key = normalizeName(row.real_name);
    if (!key) return;
    if (row.role === 'doctor') {
      const list = doctorsByName.get(key) || [];
      list.push(row);
      doctorsByName.set(key, list);
      return;
    }
    const list = nursesByName.get(key) || [];
    list.push(row);
    nursesByName.set(key, list);
  });
  return { nursesByName, doctorsByName };
}

function mergeNurseAssignments(store, nurseAssignments, unresolvedItems) {
  nurseAssignments.forEach((assignment) => {
    const draft = store.upsert({
      source: 'nurse_assignment',
      fileName: assignment.fileName,
      rowIndex: assignment.rowIndex,
      patientCode: null,
      name: assignment.patientName,
    });
    draft.responsibleNurseNames.add(assignment.nurseName);
    if (draft.responsibleNurseNames.size > 1) {
      unresolvedItems.push({
        category: 'responsible_nurse_conflict',
        fileName: assignment.fileName,
        rowIndex: assignment.rowIndex,
        patientName: assignment.patientName,
        reason: `同一患者在责任护士分配表中出现多个责任护士：${Array.from(draft.responsibleNurseNames).join('、')}`,
      });
    }
  });
}

function findExistingPatientMatches(draft, existingPatients) {
  if (draft.id_card) {
    return {
      strategy: 'id_card',
      matches: existingPatients.filter((item) => item.id_card_plain && item.id_card_plain === draft.id_card),
    };
  }
  if (draft.name && draft.dob) {
    return {
      strategy: 'name_dob',
      matches: existingPatients.filter((item) => item.name_normalized === draft.name && item.dob_key === draft.dob),
    };
  }
  if (draft.name) {
    return {
      strategy: 'name',
      matches: existingPatients.filter((item) => item.name_normalized === draft.name),
    };
  }
  return { strategy: 'none', matches: [] };
}

function buildFamilyContactJson(value) {
  if (!value || typeof value !== 'object') return null;
  const obj = {};
  if (normalizeWhitespace(value.name)) obj.name = normalizeWhitespace(value.name);
  if (normalizeWhitespace(value.phone)) obj.phone = normalizeWhitespace(value.phone);
  return Object.keys(obj).length ? obj : null;
}

function wouldUpdatePatientFromDraft(existingPatient, draft) {
  const existingFamily = buildFamilyContactJson(existingPatient.family_contact);
  const nextFamily = buildFamilyContactJson(draft.family_contact);
  return Boolean(
    (!existingPatient.id_card_plain && draft.id_card)
    || (!existingPatient.phone_plain && draft.phone)
    || (!existingPatient.address && draft.address)
    || (!existingPatient.primary_diagnosis && draft.primary_diagnosis)
    || (!existingPatient.present_illness && draft.present_illness)
    || (!existingPatient.past_history && draft.past_history)
    || (!existingPatient.dialysis_start_date && draft.dialysis_start_date)
    || (!existingPatient.responsible_nurse_id && draft.responsible_nurse_id)
    || (!existingFamily && nextFamily)
  );
}

async function createPatientDraftRecord(client, draft, actorUserId) {
  const familyContact = buildFamilyContactJson(draft.family_contact);
  const { rows } = await client.query(
    `INSERT INTO patients (
       name, gender, dob,
       id_card_encrypted, phone_encrypted, family_contact, address,
       primary_diagnosis, present_illness, past_history,
       dialysis_start_date, dialysis_mode, isolation_zone,
       responsible_nurse_id, created_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'HD','normal',$12,$13
     )
     RETURNING id, name`,
    [
      draft.name,
      draft.gender,
      draft.dob,
      draft.id_card ? encrypt(draft.id_card) : null,
      draft.phone ? encrypt(draft.phone) : null,
      familyContact ? JSON.stringify(familyContact) : null,
      draft.address || null,
      draft.primary_diagnosis || null,
      draft.present_illness || null,
      draft.past_history || null,
      draft.dialysis_start_date || null,
      draft.responsible_nurse_id || null,
      actorUserId,
    ],
  );
  return rows[0];
}

async function updatePatientFromDraft(client, existingPatient, draft) {
  if (!wouldUpdatePatientFromDraft(existingPatient, draft)) return false;

  const sets = [];
  const params = [];
  let index = 1;
  const existingFamily = buildFamilyContactJson(existingPatient.family_contact);
  const nextFamily = existingFamily || buildFamilyContactJson(draft.family_contact);

  if (!existingPatient.id_card_plain && draft.id_card) {
    sets.push(`id_card_encrypted = $${index++}`);
    params.push(encrypt(draft.id_card));
  }
  if (!existingPatient.phone_plain && draft.phone) {
    sets.push(`phone_encrypted = $${index++}`);
    params.push(encrypt(draft.phone));
  }
  if (!existingPatient.address && draft.address) {
    sets.push(`address = $${index++}`);
    params.push(draft.address);
  }
  if (!existingPatient.primary_diagnosis && draft.primary_diagnosis) {
    sets.push(`primary_diagnosis = $${index++}`);
    params.push(draft.primary_diagnosis);
  }
  if (!existingPatient.present_illness && draft.present_illness) {
    sets.push(`present_illness = $${index++}`);
    params.push(draft.present_illness);
  }
  if (!existingPatient.past_history && draft.past_history) {
    sets.push(`past_history = $${index++}`);
    params.push(draft.past_history);
  }
  if (!existingPatient.dialysis_start_date && draft.dialysis_start_date) {
    sets.push(`dialysis_start_date = $${index++}`);
    params.push(draft.dialysis_start_date);
  }
  if (!existingPatient.responsible_nurse_id && draft.responsible_nurse_id) {
    sets.push(`responsible_nurse_id = $${index++}`);
    params.push(draft.responsible_nurse_id);
  }
  if (!existingFamily && nextFamily) {
    sets.push(`family_contact = $${index++}::jsonb`);
    params.push(JSON.stringify(nextFamily));
  }

  if (sets.length === 0) return false;
  params.push(existingPatient.id);
  await client.query(
    `UPDATE patients SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${index}`,
    params,
  );
  return true;
}

function resolveResponsibleNurseIdForDraft(draft, nursesByName, unresolvedItems) {
  if (!draft.responsibleNurseNames || draft.responsibleNurseNames.size === 0) return null;
  const names = Array.from(draft.responsibleNurseNames);
  if (names.length !== 1) return null;
  const name = names[0];
  const matched = nursesByName.get(name) || [];
  if (matched.length === 1) return matched[0].id;
  unresolvedItems.push({
    category: matched.length === 0 ? 'responsible_nurse_missing' : 'responsible_nurse_ambiguous',
    fileName: Array.from(draft.sourceFiles)[0] || '责任护士分配表',
    rowIndex: null,
    patientName: draft.name,
    reason:
      matched.length === 0
        ? `未在系统中找到责任护士「${name}」`
        : `责任护士「${name}」在系统中不唯一，已留待人工处理`,
  });
  return null;
}

async function ensurePatientBindings(client, store, existingPatients, users, actorUserId, unresolvedItems) {
  const bindings = new Map();
  const patientResults = [];
  let patientsCreated = 0;
  let patientsUpdated = 0;

  for (const draft of store.drafts) {
    if (!draft.name) {
      unresolvedItems.push({
        category: 'patient_draft',
        fileName: Array.from(draft.sourceFiles)[0] || 'unknown',
        rowIndex: null,
        patientName: null,
        reason: '患者草稿缺少姓名，无法导入',
      });
      continue;
    }

    draft.responsible_nurse_id = resolveResponsibleNurseIdForDraft(draft, users.nursesByName, unresolvedItems);
    const existing = findExistingPatientMatches(draft, existingPatients);
    if (existing.matches.length > 1) {
      unresolvedItems.push({
        category: 'patient_match_ambiguous',
        fileName: Array.from(draft.sourceFiles)[0] || 'unknown',
        rowIndex: null,
        patientName: draft.name,
        reason: `患者匹配不唯一（策略 ${existing.strategy}）`,
      });
      continue;
    }
    if (existing.matches.length === 1) {
      const matched = existing.matches[0];
      bindings.set(draft.draftId, { patient_id: matched.id, patient_name: matched.name });
      if (wouldUpdatePatientFromDraft(matched, draft)) {
        await updatePatientFromDraft(client, matched, draft);
        patientsUpdated += 1;
        patientResults.push({
          action: 'updated',
          draft_id: draft.draftId,
          id: matched.id,
          name: matched.name,
          matched_by: existing.strategy,
          sources: Array.from(draft.sourceFiles),
        });
      }
      continue;
    }
    const created = await createPatientDraftRecord(client, draft, actorUserId);
    bindings.set(draft.draftId, { patient_id: created.id, patient_name: created.name });
    patientsCreated += 1;
    patientResults.push({
      action: 'created',
      draft_id: draft.draftId,
      id: created.id,
      name: created.name,
      matched_by: 'new_draft',
      sources: Array.from(draft.sourceFiles),
    });
  }

  return { bindings, patientResults, patientsCreated, patientsUpdated };
}

function locateDraftForReference(store, ref) {
  return store.pickDraft({
    patientCode: ref.patientCode || null,
    name: ref.patientName || null,
    dob: null,
    id_card: null,
  });
}

async function labExists(client, patientId, testType, testDate, value) {
  const { rows } = await client.query(
    `SELECT 1 FROM lab_results
      WHERE patient_id = $1 AND test_type = $2 AND test_date = $3 AND value = $4
      LIMIT 1`,
    [patientId, testType, testDate, value],
  );
  return rows.length > 0;
}

async function orderExists(client, patientId, order) {
  const { rows } = await client.query(
    `SELECT 1 FROM long_term_orders
      WHERE patient_id = $1
        AND status = 'active'
        AND order_type = $2
        AND drug_name = $3
        AND COALESCE(dose, '') = COALESCE($4, '')
        AND COALESCE(dose_unit, '') = COALESCE($5, '')
        AND COALESCE(route, '') = COALESCE($6, '')
        AND frequency = $7
        AND COALESCE(frequency_detail, '') = COALESCE($8, '')
      LIMIT 1`,
    [
      patientId,
      order.order_type,
      order.drug_name,
      order.dose || '',
      order.dose_unit || '',
      order.route || '',
      order.frequency,
      order.frequency_detail || '',
    ],
  );
  return rows.length > 0;
}

function buildNursingSourceTag(entry) {
  if (!entry || !entry.fileName || !entry.sheetName) return null;
  return `来源=历史护理记录单:${entry.fileName}/${entry.sheetName}`;
}

function mergeNotes(existingNotes, incomingNotes) {
  const oldText = normalizeWhitespace(existingNotes);
  const nextText = normalizeWhitespace(incomingNotes);
  if (!nextText) return oldText || null;
  if (!oldText) return nextText;
  if (oldText.includes(nextText)) return oldText;
  return `${oldText}；${nextText}`;
}

async function findExistingDialysisRecord(client, patientId, entry) {
  const sourceTag = buildNursingSourceTag(entry);
  if (sourceTag) {
    const bySource = await client.query(
      `SELECT id, patient_id, session_date, shift, pre_weight, post_weight, uf_volume, actual_duration,
              blood_flow_rate, dialysate_temp, heparin_prime_dose, coagulation_grade, is_avf_session, notes
         FROM dialysis_records
        WHERE patient_id = $1
          AND COALESCE(notes, '') LIKE $2
        ORDER BY created_at DESC
        LIMIT 1`,
      [patientId, `%${sourceTag}%`],
    );
    if (bySource.rows.length > 0) return bySource.rows[0];
  }

  const { rows } = await client.query(
    `SELECT id, patient_id, session_date, shift, pre_weight, post_weight, uf_volume, actual_duration,
            blood_flow_rate, dialysate_temp, heparin_prime_dose, coagulation_grade, is_avf_session, notes
       FROM dialysis_records
      WHERE patient_id = $1
        AND session_date = $2
        AND shift = $3
      ORDER BY created_at DESC
      LIMIT 1`,
    [patientId, entry.session_date, entry.shift || 'morning'],
  );
  return rows[0] || null;
}

async function insertVitalSignsForDialysis(
  client,
  actorUserId,
  dialysisRecordId,
  patientId,
  vitalSigns,
  sessionDateKey = null,
) {
  if (!Array.isArray(vitalSigns) || vitalSigns.length === 0) return 0;
  const existingCountRes = await client.query(
    'SELECT COUNT(*)::int AS c FROM vital_signs WHERE dialysis_record_id = $1',
    [dialysisRecordId],
  );
  if ((existingCountRes.rows[0]?.c || 0) > 0) return 0;

  let inserted = 0;
  for (let i = 0; i < vitalSigns.length; i += 1) {
    const item = vitalSigns[i] || {};
    const hasPayload = Boolean(
      item.systolic_bp != null ||
      item.diastolic_bp != null ||
      item.heart_rate != null ||
      item.arterial_pressure != null ||
      item.venous_pressure != null ||
      item.tmp != null ||
      item.body_temp != null ||
      normalizeWhitespace(item.notes) ||
      normalizeWhitespace(item.time_label),
    );
    if (!hasPayload) continue;

    const sequenceNo = Number.isFinite(Number(item.sequence_no))
      ? Math.max(1, Math.min(32767, Math.round(Number(item.sequence_no))))
      : i + 1;
    let recordTime = normalizeWhitespace(item.record_time);
    if (!recordTime && normalizeWhitespace(item.time_label)) {
      const t = parseTimeLabel(item.time_label);
      if (t) {
        const d = sessionDateKey || formatDateOnly(new Date());
        recordTime = `${d} ${t}:00`;
      }
    }
    if (!recordTime) {
      const baseMinutes = 6 * 60 + (sequenceNo - 1) * 50;
      const hh = String(Math.floor(baseMinutes / 60) % 24).padStart(2, '0');
      const mm = String(baseMinutes % 60).padStart(2, '0');
      const d = sessionDateKey || formatDateOnly(new Date());
      recordTime = `${d} ${hh}:${mm}:00`;
    }

    await client.query(
      `INSERT INTO vital_signs (
         dialysis_record_id, patient_id, record_time, time_label, sequence_no,
         systolic_bp, diastolic_bp, heart_rate, arterial_pressure, venous_pressure, tmp, body_temp,
         notes, recorded_by
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14
       )`,
      [
        dialysisRecordId,
        patientId,
        recordTime,
        item.time_label || null,
        sequenceNo,
        item.systolic_bp != null ? item.systolic_bp : null,
        item.diastolic_bp != null ? item.diastolic_bp : null,
        item.heart_rate != null ? item.heart_rate : null,
        item.arterial_pressure != null ? item.arterial_pressure : null,
        item.venous_pressure != null ? item.venous_pressure : null,
        item.tmp != null ? item.tmp : null,
        item.body_temp != null ? item.body_temp : null,
        normalizeWhitespace(item.notes) || null,
        actorUserId,
      ],
    );
    inserted += 1;
  }
  return inserted;
}

async function patchExistingDialysisRecord(client, existingRow, entry) {
  const sets = [];
  const params = [];
  let index = 1;
  const nullableFields = [
    'pre_weight',
    'post_weight',
    'uf_volume',
    'actual_duration',
    'blood_flow_rate',
    'dialysate_temp',
    'heparin_prime_dose',
    'coagulation_grade',
  ];

  nullableFields.forEach((field) => {
    if (existingRow[field] == null && entry[field] != null) {
      sets.push(`${field} = $${index++}`);
      params.push(entry[field]);
    }
  });

  if (existingRow.is_avf_session == null && entry.is_avf_session != null) {
    sets.push(`is_avf_session = $${index++}`);
    params.push(entry.is_avf_session);
  }

  const mergedNotes = mergeNotes(existingRow.notes, entry.notes);
  if (mergedNotes !== (existingRow.notes || null)) {
    sets.push(`notes = $${index++}`);
    params.push(mergedNotes);
  }

  if (sets.length === 0) return existingRow;
  params.push(existingRow.id);
  const { rows } = await client.query(
    `UPDATE dialysis_records
        SET ${sets.join(', ')}, updated_at = NOW()
      WHERE id = $${index}
      RETURNING id, patient_id, session_date, shift, pre_weight, post_weight, uf_volume, actual_duration,
                blood_flow_rate, dialysate_temp, heparin_prime_dose, coagulation_grade, is_avf_session, notes`,
    params,
  );
  return rows[0] || existingRow;
}

async function insertLabEntry(client, actorUserId, binding, entry) {
  const { rows } = await client.query(
    `INSERT INTO lab_results (
       patient_id, test_type, value, unit, test_date, entered_by, notes
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, patient_id, test_type, value, unit, test_date`,
    [
      binding.patient_id,
      entry.test_type,
      entry.value,
      entry.unit,
      entry.test_date,
      actorUserId,
      entry.notes,
    ],
  );
  return rows[0];
}

async function insertOrderEntry(client, actorUserId, binding, entry, doctorsByName, unresolvedItems) {
  let orderedBy = actorUserId;
  let notes = entry.notes;
  if (entry.doctor_name) {
    const doctors = doctorsByName.get(entry.doctor_name) || [];
    if (doctors.length === 1) {
      orderedBy = doctors[0].id;
    } else {
      notes = buildNotes([
        notes,
        `医生签名低置信匹配=${entry.doctor_name}`,
        '本条医嘱已使用当前导入操作者作为开立人',
      ]);
      unresolvedItems.push({
        category: doctors.length === 0 ? 'doctor_missing' : 'doctor_ambiguous',
        fileName: entry.fileName,
        rowIndex: entry.rowIndex,
        patientName: entry.patientName,
        reason:
          doctors.length === 0
            ? `未找到医生签名「${entry.doctor_name}」，已回退为当前导入人`
            : `医生签名「${entry.doctor_name}」匹配到多个账号，已回退为当前导入人`,
      });
    }
  }

  const { rows } = await client.query(
    `INSERT INTO long_term_orders (
       patient_id, prescription_id, order_type, drug_name, drug_spec,
       dose, dose_unit, route, frequency, frequency_detail, execute_timing,
       valid_from, valid_until, notes, ordered_by
     ) VALUES (
       $1,NULL,$2,$3,NULL,$4,$5,$6,$7,$8,$9,$10,NULL,$11,$12
     )
     RETURNING id, patient_id, drug_name, order_type, frequency`,
    [
      binding.patient_id,
      entry.order_type,
      entry.drug_name,
      entry.dose || null,
      entry.dose_unit || null,
      entry.route || null,
      entry.frequency,
      entry.frequency_detail || null,
      entry.execute_timing || 'anytime',
      entry.valid_from || formatDateOnly(new Date()),
      notes,
      orderedBy,
    ],
  );
  return rows[0];
}

function resolveDialysisNurseId(entry, draft, users, actorUserId, unresolvedItems) {
  if (!entry.nurse_name) return draft.responsible_nurse_id || actorUserId;
  const nurses = users.nursesByName.get(entry.nurse_name) || [];
  if (nurses.length === 1) return nurses[0].id;

  unresolvedItems.push({
    category: nurses.length === 0 ? 'dialysis_nurse_missing' : 'dialysis_nurse_ambiguous',
    fileName: entry.fileName,
    rowIndex: entry.rowIndex,
    patientName: entry.patientName,
    reason:
      nurses.length === 0
        ? `透析记录护士「${entry.nurse_name}」未在系统找到，已回退到默认导入人员`
        : `透析记录护士「${entry.nurse_name}」匹配到多个账号，已回退到默认导入人员`,
  });
  return draft.responsible_nurse_id || actorUserId;
}

async function insertDialysisEntry(client, actorUserId, draft, binding, entry, users, unresolvedItems) {
  const nurseId = resolveDialysisNurseId(entry, draft, users, actorUserId, unresolvedItems);
  const { rows } = await client.query(
    `INSERT INTO dialysis_records (
       patient_id, session_date, shift, nurse_id,
       pre_weight, post_weight, uf_volume, actual_duration,
       blood_flow_rate, dialysate_temp, heparin_prime_dose, coagulation_grade, is_avf_session,
       notes
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14
     )
     RETURNING id, patient_id, session_date, shift, pre_weight, post_weight, uf_volume, actual_duration,
               blood_flow_rate, dialysate_temp, heparin_prime_dose, coagulation_grade, is_avf_session, notes`,
    [
      binding.patient_id,
      entry.session_date,
      entry.shift || 'morning',
      nurseId,
      entry.pre_weight != null ? entry.pre_weight : null,
      entry.post_weight != null ? entry.post_weight : null,
      entry.uf_volume != null ? entry.uf_volume : null,
      entry.actual_duration != null ? entry.actual_duration : null,
      entry.blood_flow_rate != null ? entry.blood_flow_rate : null,
      entry.dialysate_temp != null ? entry.dialysate_temp : null,
      entry.heparin_prime_dose != null ? entry.heparin_prime_dose : null,
      entry.coagulation_grade != null ? entry.coagulation_grade : null,
      entry.is_avf_session != null ? entry.is_avf_session : null,
      entry.notes || null,
    ],
  );
  const saved = rows[0];
  await insertVitalSignsForDialysis(
    client,
    actorUserId,
    saved.id,
    binding.patient_id,
    entry.vital_signs || [],
    entry.session_date || null,
  );
  return saved;
}

async function upsertDialysisEntry(client, actorUserId, draft, binding, entry, users, unresolvedItems) {
  const existing = await findExistingDialysisRecord(client, binding.patient_id, entry);
  if (existing) {
    const patched = await patchExistingDialysisRecord(client, existing, entry);
    await insertVitalSignsForDialysis(
      client,
      actorUserId,
      patched.id,
      binding.patient_id,
      entry.vital_signs || [],
      entry.session_date || null,
    );
    return { created: false, row: patched };
  }

  const inserted = await insertDialysisEntry(
    client,
    actorUserId,
    draft,
    binding,
    entry,
    users,
    unresolvedItems,
  );
  return { created: true, row: inserted };
}

function pushReferenceUnresolved(unresolvedItems, category, entry, reason) {
  unresolvedItems.push({
    category,
    fileName: entry.fileName,
    rowIndex: entry.rowIndex,
    patientName: entry.patientName,
    reason,
  });
}

async function buildImportPlan(client, files) {
  const parsed = await parseFiles(files);
  const draftStore = new DraftStore();
  parsed.patientDraftInputs.forEach((input) => {
    draftStore.upsert(input);
  });
  mergeNurseAssignments(draftStore, parsed.nurseAssignments, parsed.unresolvedItems);

  const existingPatients = await loadExistingPatients(client);
  const users = await loadUsersForImport(client);
  const bindingPlans = new Map();
  const patientPreview = [];
  let createdPreview = 0;
  let updatedPreview = 0;

  for (const draft of draftStore.drafts) {
    if (!draft.name) {
      parsed.unresolvedItems.push({
        category: 'patient_draft',
        fileName: Array.from(draft.sourceFiles)[0] || 'unknown',
        rowIndex: null,
        patientName: null,
        reason: '患者草稿缺少姓名，无法导入',
      });
      continue;
    }

    draft.responsible_nurse_id = resolveResponsibleNurseIdForDraft(draft, users.nursesByName, parsed.unresolvedItems);
    const existing = findExistingPatientMatches(draft, existingPatients);
    if (existing.matches.length > 1) {
      parsed.unresolvedItems.push({
        category: 'patient_match_ambiguous',
        fileName: Array.from(draft.sourceFiles)[0] || 'unknown',
        rowIndex: null,
        patientName: draft.name,
        reason: `患者匹配不唯一（策略 ${existing.strategy}）`,
      });
      continue;
    }

    if (existing.matches.length === 1) {
      const matched = existing.matches[0];
      const shouldUpdate = wouldUpdatePatientFromDraft(matched, draft);
      bindingPlans.set(draft.draftId, {
        kind: 'existing',
        draft,
        existingPatient: matched,
        binding: { patient_id: matched.id, patient_name: matched.name },
        matchedBy: existing.strategy,
        shouldUpdate,
      });
      if (shouldUpdate) {
        updatedPreview += 1;
        patientPreview.push({
          action: 'updated',
          draft_id: draft.draftId,
          id: matched.id,
          name: matched.name,
          matched_by: existing.strategy,
          sources: Array.from(draft.sourceFiles),
        });
      }
      continue;
    }

    const fakeId = `(preview:${draft.draftId})`;
    bindingPlans.set(draft.draftId, {
      kind: 'new',
      draft,
      binding: { patient_id: fakeId, patient_name: draft.name },
      matchedBy: 'new_draft',
      shouldUpdate: false,
    });
    createdPreview += 1;
    patientPreview.push({
      action: 'created',
      draft_id: draft.draftId,
      id: fakeId,
      name: draft.name,
      matched_by: 'new_draft',
      sources: Array.from(draft.sourceFiles),
    });
  }

  const labPlans = [];
  parsed.labEntries.forEach((entry) => {
    const draft = locateDraftForReference(draftStore, entry);
    const bindingPlan = draft ? bindingPlans.get(draft.draftId) : null;
    if (!draft || !bindingPlan) {
      pushReferenceUnresolved(parsed.unresolvedItems, 'lab_patient', entry, '化验记录未能匹配到患者档案，已留待人工处理');
      return;
    }
    labPlans.push({
      draftId: draft.draftId,
      entry,
      previewBinding: bindingPlan.binding,
    });
  });

  const orderPlans = [];
  parsed.orderEntries.forEach((entry) => {
    const draft = locateDraftForReference(draftStore, entry);
    const bindingPlan = draft ? bindingPlans.get(draft.draftId) : null;
    if (!draft || !bindingPlan) {
      pushReferenceUnresolved(parsed.unresolvedItems, 'order_patient', entry, '医嘱记录未能匹配到患者档案，已留待人工处理');
      return;
    }
    orderPlans.push({
      draftId: draft.draftId,
      entry,
      previewBinding: bindingPlan.binding,
    });
  });

  const dialysisPlans = [];
  const dialysisPlanKeys = new Set();
  parsed.dialysisEntries.forEach((entry) => {
    const draft = locateDraftForReference(draftStore, entry);
    const bindingPlan = draft ? bindingPlans.get(draft.draftId) : null;
    if (!draft || !bindingPlan) {
      pushReferenceUnresolved(parsed.unresolvedItems, 'dialysis_patient', entry, '透析记录未能匹配到患者档案，已留待人工处理');
      return;
    }
    const dedupeKey = `${draft.draftId}|${entry.session_date}|${entry.shift}|${entry.fileName}|${entry.sheetName || entry.rowIndex || ''}`;
    if (dialysisPlanKeys.has(dedupeKey)) {
      pushReferenceUnresolved(parsed.unresolvedItems, 'dialysis_duplicate', entry, '同一患者同日期同班次透析记录重复，已按一条处理');
      return;
    }
    dialysisPlanKeys.add(dedupeKey);
    dialysisPlans.push({
      draftId: draft.draftId,
      draft,
      entry,
      previewBinding: bindingPlan.binding,
    });
  });

  return {
    files,
    parsed,
    draftStore,
    users,
    bindingPlans,
    patientPreview,
    createdPreview,
    updatedPreview,
    labPlans,
    orderPlans,
    dialysisPlans,
  };
}

function buildPreviewResult(plan) {
  const labs = plan.labPlans.map(({ entry, previewBinding }) => ({
    id: `(preview:${entry.test_type}:${entry.rowIndex})`,
    patient_id: previewBinding.patient_id,
    patient_name: previewBinding.patient_name,
    test_type: entry.test_type,
    value: entry.value,
    unit: entry.unit,
    test_date: entry.test_date,
    source_file: entry.fileName,
  }));

  const orders = plan.orderPlans.map(({ entry, previewBinding }) => ({
    id: `(preview:${entry.rowIndex})`,
    patient_id: previewBinding.patient_id,
    patient_name: previewBinding.patient_name,
    drug_name: entry.drug_name,
    order_type: entry.order_type,
    frequency: entry.frequency,
    valid_from: entry.valid_from || formatDateOnly(new Date()),
    source_file: entry.fileName,
  }));

  const dialysis_records = plan.dialysisPlans.map(({ entry, previewBinding }) => ({
    id: `(preview:dialysis:${entry.rowIndex})`,
    patient_id: previewBinding.patient_id,
    patient_name: previewBinding.patient_name,
    session_date: entry.session_date,
    shift: entry.shift,
    source_file: entry.fileName,
    sheet_name: entry.sheetName || null,
  }));

  return {
    dry_run: true,
    files_count: plan.files.length,
    patients_created: plan.createdPreview,
    patients_updated: plan.updatedPreview,
    labs_created: labs.length,
    orders_created: orders.length,
    dialysis_created: dialysis_records.length,
    patients: plan.patientPreview,
    labs,
    orders,
    dialysis_records,
    unresolved_items: plan.parsed.unresolvedItems,
    unsupported_files: plan.parsed.unsupportedFiles,
  };
}

async function applyImportPlan(client, plan, actorUserId) {
  const bindings = new Map();
  const patientResults = [];
  let patientsCreated = 0;
  let patientsUpdated = 0;

  for (const draft of plan.draftStore.drafts) {
    const bindingPlan = plan.bindingPlans.get(draft.draftId);
    if (!bindingPlan) continue;

    if (bindingPlan.kind === 'existing') {
      bindings.set(draft.draftId, bindingPlan.binding);
      if (bindingPlan.shouldUpdate) {
        await updatePatientFromDraft(client, bindingPlan.existingPatient, draft);
        patientsUpdated += 1;
        patientResults.push({
          action: 'updated',
          draft_id: draft.draftId,
          id: bindingPlan.binding.patient_id,
          name: bindingPlan.binding.patient_name,
          matched_by: bindingPlan.matchedBy,
          sources: Array.from(draft.sourceFiles),
        });
      }
      continue;
    }

    const created = await createPatientDraftRecord(client, draft, actorUserId);
    const binding = { patient_id: created.id, patient_name: created.name };
    bindings.set(draft.draftId, binding);
    patientsCreated += 1;
    patientResults.push({
      action: 'created',
      draft_id: draft.draftId,
      id: created.id,
      name: created.name,
      matched_by: 'new_draft',
      sources: Array.from(draft.sourceFiles),
    });
  }

  const labs = [];
  for (const { draftId, entry } of plan.labPlans) {
    const binding = bindings.get(draftId);
    if (!binding) continue;
    if (await labExists(client, binding.patient_id, entry.test_type, entry.test_date, entry.value)) continue;
    const inserted = await insertLabEntry(client, actorUserId, binding, entry);
    labs.push({ ...inserted, patient_name: binding.patient_name, source_file: entry.fileName });
  }

  const orders = [];
  for (const { draftId, entry } of plan.orderPlans) {
    const binding = bindings.get(draftId);
    if (!binding) continue;
    if (await orderExists(client, binding.patient_id, entry)) continue;
    const inserted = await insertOrderEntry(client, actorUserId, binding, entry, plan.users.doctorsByName, plan.parsed.unresolvedItems);
    orders.push({
      ...inserted,
      patient_name: binding.patient_name,
      valid_from: entry.valid_from || formatDateOnly(new Date()),
      source_file: entry.fileName,
    });
  }

  const dialysis_records = [];
  for (const { draftId, draft, entry } of plan.dialysisPlans) {
    const binding = bindings.get(draftId);
    if (!binding) continue;
    const { created, row } = await upsertDialysisEntry(
      client,
      actorUserId,
      draft,
      binding,
      entry,
      plan.users,
      plan.parsed.unresolvedItems,
    );
    if (!created) continue;
    dialysis_records.push({
      ...row,
      patient_name: binding.patient_name,
      source_file: entry.fileName,
      sheet_name: entry.sheetName || null,
    });
  }

  return {
    dry_run: false,
    files_count: plan.files.length,
    patients_created: patientsCreated,
    patients_updated: patientsUpdated,
    labs_created: labs.length,
    orders_created: orders.length,
    dialysis_created: dialysis_records.length,
    patients: patientResults,
    labs,
    orders,
    dialysis_records,
    unresolved_items: plan.parsed.unresolvedItems,
    unsupported_files: plan.parsed.unsupportedFiles,
  };
}

async function runImport(pool, files, options) {
  const { dryRun = false, actorUserId } = options || {};
  const client = await pool.connect();
  try {
    const plan = await buildImportPlan(client, files);
    if (dryRun) return buildPreviewResult(plan);

    await client.query('BEGIN');
    const result = await applyImportPlan(client, plan, actorUserId);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      // ignore rollback errors
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  runImport,
  parseFiles,
  detectHistoryFileType,
  buildImportPlan,
};
