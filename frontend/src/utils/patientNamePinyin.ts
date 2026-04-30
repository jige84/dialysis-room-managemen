/**
 * 患者姓名拼音工具（列表排序与首字母检索）
 * 依赖 pinyin-pro：中文转拼音；异常时降级为原文本比较。
 */
import { pinyin } from 'pinyin-pro';

/** 姓名全拼小写紧凑字符串，用于按拼音排序 */
export function buildPatientNamePinyinSortKey(name: string): string {
  const s = String(name ?? '').trim();
  if (!s) return '';
  try {
    return pinyin(s, { toneType: 'none', type: 'string' })
      .replace(/\s+/g, '')
      .toLowerCase();
  } catch {
    return s.toLowerCase();
  }
}

/**
 * 用于拼音首字母快捷筛选：取姓名首字的拼音首字母（A–Z），无法归类时为 `#`
 */
export function getPatientNameLeadingPinyinLetter(name: string): string {
  const s = String(name ?? '').trim();
  if (!s) return '#';
  const firstChar = s[0];
  if (/[A-Za-z]/.test(firstChar)) return firstChar.toUpperCase();
  try {
    const py = pinyin(firstChar, { pattern: 'first', toneType: 'none', type: 'string' });
    const c = py.trim().charAt(0).toUpperCase();
    if (c >= 'A' && c <= 'Z') return c;
  } catch {
    /* 降级 */
  }
  return '#';
}
