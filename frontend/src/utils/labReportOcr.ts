/**
 * 化验单 OCR 文本解析与结果分析（与 backend/src/routes/labs.js LAB_TARGETS 对齐）
 * 识别结果仅供参考，录入前须人工核对。
 */
import { LAB_TYPE_LABELS } from '../api/labs';

export type LabStatusUi = 'normal' | 'high' | 'low' | 'critical';

export interface LabTargetMeta {
  low?: number;
  high?: number;
  unit: string;
  critical_low?: number;
  critical_high?: number;
}

/** 与后端 LAB_TARGETS 键一致 */
export const LAB_TARGETS_META: Record<string, LabTargetMeta> = {
  hb: { low: 110, high: 130, unit: 'g/L', critical_low: 70 },
  hct: { low: 33, high: 39, unit: '%' },
  k: { low: 3.5, high: 5.5, unit: 'mmol/L', critical_low: 3.0, critical_high: 6.5 },
  na: { low: 135, high: 145, unit: 'mmol/L' },
  ca: { low: 2.1, high: 2.5, unit: 'mmol/L' },
  p: { low: 1.13, high: 1.78, unit: 'mmol/L' },
  // PDF 中 CO2CP/HCO3- 控制目标为 >=20 且 <26
  hco3: { low: 20, high: 26, unit: 'mmol/L' },
  // PDF 中白蛋白给出下限（>=35g/L）
  alb: { low: 35, unit: 'g/L' },
  sf: { low: 200, high: 500, unit: 'ng/mL' },
  tsat: { low: 20, high: 50, unit: '%' },
  ipth: { low: 150, high: 300, unit: 'pg/mL' },
  b2mg: { high: 25, unit: 'mg/L' },
  bun: { unit: 'mmol/L' },
  cr: { unit: 'μmol/L' },
  hbsag: { unit: '' },
  hcv: { unit: '' },
  hiv: { unit: '' },
  tp: { unit: '' },
};

const CATEGORY_BY_TYPE: Record<string, string> = {
  k: '电解质',
  na: '电解质',
  ca: '电解质',
  p: '电解质',
  hco3: '电解质',
  hb: '贫血',
  hct: '贫血',
  sf: '贫血',
  tsat: '贫血',
  bun: '生化',
  cr: '生化',
  alb: '营养',
  ipth: 'CKD-MBD',
  b2mg: 'CKD-MBD',
  hbsag: '传染病筛查',
  hcv: '传染病筛查',
  hiv: '传染病筛查',
  tp: '传染病筛查',
};

export function getCategoryForTestType(testType: string): string {
  return CATEGORY_BY_TYPE[testType] ?? '其他';
}

interface PatternDef {
  test_type: string;
  aliases: string[];
}

/** 别名越长优先匹配（避免「钾」误匹配「血钾」前先匹配长串） */
const PATTERN_DEFS: PatternDef[] = [
  { test_type: 'hbsag', aliases: ['乙肝表面抗原', 'HBsAg', 'HBSAG'] },
  { test_type: 'hcv', aliases: ['丙肝抗体', '抗HCV', 'HCV抗体', 'Anti-HCV'] },
  { test_type: 'hiv', aliases: ['HIV抗体', '抗HIV', '人类免疫缺陷'] },
  { test_type: 'tp', aliases: ['梅毒螺旋体', '梅毒', 'TPPA', 'TRUST'] },
  { test_type: 'ipth', aliases: ['全段甲状旁腺激素', '甲状旁腺激素', 'iPTH', 'PTH'] },
  { test_type: 'b2mg', aliases: ['β2微球蛋白', 'β₂微球蛋白', 'B2微球蛋白', 'β2-MG', 'β2MG'] },
  { test_type: 'tsat', aliases: ['转铁蛋白饱和度', 'TSAT'] },
  { test_type: 'sf', aliases: ['血清铁蛋白', '铁蛋白', 'SF'] },
  { test_type: 'hco3', aliases: ['碳酸氢根', 'CO2CP', '二氧化碳结合力', 'HCO3', 'HCO3-', 'HCO₃'] },
  { test_type: 'hct', aliases: ['红细胞压积', '红细胞比容', 'HCT'] },
  { test_type: 'hb', aliases: ['血红蛋白', 'Hb', 'HGB'] },
  { test_type: 'alb', aliases: ['白蛋白', 'ALB'] },
  { test_type: 'bun', aliases: ['尿素氮', '尿素', 'BUN', 'Urea', 'UREA'] },
  { test_type: 'cr', aliases: ['血肌酐', '肌酐', 'Cr', 'CREA', 'CRE', 'CREA (肌酐)', 'CREA(肌酐)'] },
  { test_type: 'k', aliases: ['血清钾', '血钾', 'POTASSIUM', 'K+', 'K⁺'] },
  { test_type: 'na', aliases: ['血清钠', '血钠', 'SODIUM', 'Na', 'NA'] },
  { test_type: 'ca', aliases: ['血清钙', '血钙', 'CALCIUM', 'Ca', 'CA'] },
  { test_type: 'p', aliases: ['血清磷', '血磷', '无机磷', 'Phosphorus', 'PHOS', 'IP'] },
];

function normalizeText(raw: string): string {
  return (
    raw
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+/g, ' ')
      // 修复 OCR 在小数点前后插入空格："14. 43" → "14.43"
      .replace(/(\d)\s*\.\s*(\d)/g, '$1.$2')
      // 统一各类 Unicode 横线符号为 ASCII 连字符（OCR 有时输出 en-dash/全角横线等）
      .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-')
      // 全角数字 → ASCII 数字
      .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xff10 + 48))
  );
}

/**
 * 乱码或极短文本不做解析，避免单字母正则误匹配出假数值。
 */
export function isLikelyLegibleLabOcrText(raw: string): boolean {
  const t = raw.trim();
  if (t.length < 24) return false;
  const chinese = (t.match(/[\u4e00-\u9fff]/g) ?? []).length;
  if (chinese >= 10) return true;
  if (/\b(UREA|CREA|ALB|ALT|AST|检验|报告|化验|血清|静脉|mmol|μmol|µmol)/i.test(t) && t.length >= 40) {
    return true;
  }
  return false;
}

/**
 * 常见机打报告单：UREA(尿素)、CREA(肌酐)、β2-MG、ALB(白蛋白) 等英文缩写 + 数值
 */
function extractStructuredLabValues(text: string): ParsedLabLine[] {
  const out: ParsedLabLine[] = [];
  const seen = new Set<string>();

  const push = (test_type: string, valueStr: string) => {
    if (seen.has(test_type)) return;
    const value = parseFloat(valueStr.replace(/,/g, ''));
    if (Number.isNaN(value)) return;
    seen.add(test_type);
    const meta = LAB_TARGETS_META[test_type];
    out.push({
      test_type,
      label: LAB_TYPE_LABELS[test_type] ?? test_type,
      value,
      unit: meta?.unit ?? '',
    });
  };

  /**
   * 中文化验单常见两种格式：
   *   A. 英文缩写（中文名）数值   如 CREA（肌酐）900.0
   *   B. 中文名（英文缩写）数值   如 肌酐（CREA）900.0
   * 全角括号「（）」和半角括号「()」均须支持；
   * 数字前可能紧跟「）」或「↑↓」或空白，用 [）)\s↑↓]* 统一吃掉。
   */
  const NUM = String.raw`[）)\s↑↓]*([\d,]+\.?\d*)`;
  const PAREN = String.raw`\s*[（(][^）)]*[）)]`;

  const tries: Array<{ type: string; re: RegExp }> = [
    // ── BUN / 尿素 ──
    { type: 'bun', re: new RegExp(`UREA${PAREN}\\s*${NUM}`, 'i') },
    { type: 'bun', re: new RegExp(`尿素${PAREN}\\s*${NUM}`) },
    { type: 'bun', re: /\bUREA\s*[）)\s↑↓]*([\d,]+\.?\d*)/i },
    // ── CREA / 肌酐 ──
    { type: 'cr', re: new RegExp(`CREA${PAREN}\\s*${NUM}`, 'i') },
    { type: 'cr', re: new RegExp(`肌酐${PAREN}\\s*${NUM}`) },
    { type: 'cr', re: /\bCREA\s*(?:[（(][^）)]+[）)])?\s*[）)\s↑↓]*([\d,]+\.?\d*)/i },
    // ── β2-MG / 微球蛋白 ──
    // 优先匹配中文名（含括号英文缩写），再匹配英文缩写各种写法，最后兜底无括号直接跟数值
    { type: 'b2mg', re: new RegExp(`微球蛋白${PAREN}\\s*${NUM}`) },
    { type: 'b2mg', re: new RegExp(`[βbBß]\\s*2[-\\s]?MG${PAREN}\\s*${NUM}`, 'i') },
    { type: 'b2mg', re: /[βbBß]\s*2[-\s]?MG\s*[）)\s↑↓]*([\d,]+\.?\d*)/i },
    // 无括号格式：微球蛋白 直接跟数值（如 "β2微球蛋白 14.43"，OCR 未识别括号）
    { type: 'b2mg', re: /微球蛋白\s+[↑↓]?\s*([\d,]+\.?\d*)/ },
    // ── ALB / 白蛋白 ──
    { type: 'alb', re: new RegExp(`ALB${PAREN}\\s*${NUM}`, 'i') },
    { type: 'alb', re: new RegExp(`白蛋白${PAREN}\\s*${NUM}`) },
    { type: 'alb', re: /\bALB\s*(?:[（(][^）)]*溴甲酚绿[^）)]*[）)])?\s*[）)\s↑↓]*([\d,]+\.?\d*)/i },
    { type: 'alb', re: /\bALB\s*[）)\s↑↓]*([\d,]+\.?\d*)/i },
  ];

  for (const { type, re } of tries) {
    if (seen.has(type)) continue;
    const m = text.match(re);
    if (m?.[1]) push(type, m[1]);
  }

  return out;
}

/** 在别名后若干字符内取第一个合理数值 */
function extractNumberAfter(text: string, _alias: string, fromIndex: number): number | null {
  const slice = text.slice(fromIndex, fromIndex + 120);
  // 防止误命中参考范围下限：如 "3.5 - 5.5 → 4.20" 应取 4.20
  const withRange = slice.match(/[\d.]+\s*[-–]\s*[\d.]+[^\d]*\s*([\d.]+)/);
  if (withRange) {
    const v = parseFloat(withRange[1]);
    if (!Number.isNaN(v)) return v;
  }
  const numMatch = slice.match(/(\d+\.?\d*)/);
  if (!numMatch) return null;
  const v = parseFloat(numMatch[1]);
  if (Number.isNaN(v)) return null;
  return v;
}

export interface ParsedLabLine {
  test_type: string;
  label: string;
  value: number;
  unit: string;
}

/**
 * 从 OCR 全文中解析检验项目（去重：每种 test_type 只保留首次命中）
 */
export function parseLabReportText(raw: string): ParsedLabLine[] {
  const text = normalizeText(raw);
  if (!isLikelyLegibleLabOcrText(text)) {
    return [];
  }

  const found = new Map<string, ParsedLabLine>();

  for (const row of extractStructuredLabValues(text)) {
    found.set(row.test_type, row);
  }

  const sortedDefs = [...PATTERN_DEFS].sort((a, b) => {
    const maxA = Math.max(...a.aliases.map((x) => x.length));
    const maxB = Math.max(...b.aliases.map((x) => x.length));
    return maxB - maxA;
  });

  for (const def of sortedDefs) {
    if (found.has(def.test_type)) continue;
    for (const alias of def.aliases) {
      const idx = text.indexOf(alias);
      if (idx < 0) continue;
      const val = extractNumberAfter(text, alias, idx + alias.length);
      if (val === null) continue;
      const meta = LAB_TARGETS_META[def.test_type];
      const label = LAB_TYPE_LABELS[def.test_type] ?? def.test_type;
      found.set(def.test_type, {
        test_type: def.test_type,
        label,
        value: val,
        unit: meta?.unit ?? '',
      });
      break;
    }
  }

  return Array.from(found.values());
}

export function formatReferenceRange(testType: string): string {
  const m = LAB_TARGETS_META[testType];
  if (!m) return '—';
  const parts: string[] = [];
  if (m.low !== undefined && m.high !== undefined) {
    parts.push(`${m.low}–${m.high}`);
  } else if (m.low !== undefined) {
    parts.push(`≥${m.low}`);
  } else if (m.high !== undefined) {
    parts.push(`≤${m.high}`);
  }
  return parts.length ? `${parts.join(' ')} ${m.unit}`.trim() : m.unit || '—';
}

export function analyzeLabValue(testType: string, value: number): {
  status: LabStatusUi;
  summary: string;
} {
  const m = LAB_TARGETS_META[testType];
  if (!m) {
    return { status: 'normal', summary: '无本地参考范围，请人工核对' };
  }
  if (m.critical_low !== undefined && value < m.critical_low) {
    return { status: 'critical', summary: `低于危急值下限 ${m.critical_low}` };
  }
  if (m.critical_high !== undefined && value > m.critical_high) {
    return { status: 'critical', summary: `高于危急值上限 ${m.critical_high}` };
  }
  if (m.low !== undefined && value < m.low) {
    return { status: 'low', summary: `低于目标下限 ${m.low}` };
  }
  if (m.high !== undefined && value > m.high) {
    return { status: 'high', summary: `高于目标上限 ${m.high}` };
  }
  return { status: 'normal', summary: '在目标范围内' };
}

/** 从全文尝试提取检验日期 */
export function extractReportDate(raw: string): string | null {
  const m = raw.match(/(\d{4})\s*[-年./]\s*(\d{1,2})\s*[-月./]\s*(\d{1,2})/);
  if (!m) return null;
  const y = m[1];
  const mo = m[2].padStart(2, '0');
  const d = m[3].padStart(2, '0');
  return `${y}-${mo}-${d}`;
}
