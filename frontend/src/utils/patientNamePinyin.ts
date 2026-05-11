/**
 * 患者姓名拼音工具（列表排序与搜索）
 * 依赖 pinyin-pro：中文转拼音；异常时降级。
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
 * 姓名逐字拼音首字母串联（小写），如「任计阁」→ rjg。
 * 搜索框仅输入 a–z 时，与输入串做前缀匹配（startsWith），便于逐键筛选。
 */
export function buildPatientNameInitialsChain(name: string): string {
  const s = String(name ?? '').trim();
  if (!s) return '';
  const parts: string[] = [];
  for (const ch of Array.from(s)) {
    if (/[A-Za-z]/.test(ch)) {
      parts.push(ch.toLowerCase());
      continue;
    }
    if (/[\u4e00-\u9fff]/.test(ch)) {
      try {
        const py = pinyin(ch, { pattern: 'first', toneType: 'none', type: 'string' });
        const c = py.trim().charAt(0).toLowerCase();
        if (c >= 'a' && c <= 'z') parts.push(c);
      } catch {
        /* 单字失败则跳过 */
      }
    }
  }
  return parts.join('');
}

/**
 * 表单「签名」默认值：含中文的展示名取逐字拼音首字母小写（如「杨晨」→ yc）；纯英文/数字登录名等则保持原样。
 * 用户仍可手改：允许继续输入全名汉字或首字母缩写。
 */
export function defaultSignatureFromUserDisplayName(displayName: string): string {
  const s = String(displayName ?? '').trim();
  if (!s) return '';
  if (!/[\u4e00-\u9fff]/.test(s)) return s;
  const initials = buildPatientNameInitialsChain(s);
  return initials || s;
}
