/**
 * 医疗档案「仅日期」字段的解析与展示
 * PostgreSQL DATE 经 API 常为 ISO 8601（UTC），若取 slice(0,10) 或 toISOString 的日期部分，
 * 在东八区等环境下可能与用户本地日历差一天。此处统一按用户本机时区格式化为日历日 YYYY-MM-DD。
 */
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';

export function formatLocalDateKey(raw: unknown): string {
  if (raw == null || raw === '') return '';
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    const dj = dayjs(t);
    return dj.isValid() ? dj.format('YYYY-MM-DD') : '';
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const dj = dayjs(raw);
    return dj.isValid() ? dj.format('YYYY-MM-DD') : '';
  }
  if (raw instanceof Date) {
    return dayjs(raw).format('YYYY-MM-DD');
  }
  return formatLocalDateKey(String(raw));
}

/** DatePicker / 表单：由 API 值得到本地日历日的 dayjs；无效则回退为当日 */
export function parseApiDateOnlyForPicker(raw: unknown): Dayjs {
  const key = formatLocalDateKey(raw);
  if (key) return dayjs(key);
  return dayjs();
}

/** 可选日期字段 */
export function parseApiDateOnlyNullable(raw: unknown): Dayjs | null {
  const key = formatLocalDateKey(raw);
  return key ? dayjs(key) : null;
}
