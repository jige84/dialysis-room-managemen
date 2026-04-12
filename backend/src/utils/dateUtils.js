/**
 * 日期与时长工具函数集
 * 主要作用：为业务层提供透析病程、筛查间隔等统一的日期计算，避免各处重复实现。
 * 主要功能：两日期间隔；是否在 N 天内；透析时长格式化等（见文件内导出函数）。
 */

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad2(value) {
  return String(value).padStart(2, '0');
}

/**
 * 将业务日期解析为“本地日历日”Date，避免 YYYY-MM-DD 被按 UTC 解析后少一天。
 * @param {string|Date|number} value
 * @returns {Date|null}
 */
function parseBusinessDate(value) {
  if (value == null || value === '') return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  if (typeof value === 'string') {
    const match = value.match(DATE_ONLY_RE);
    if (match) {
      return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    }
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

/**
 * 将 Date 格式化为本地 YYYY-MM-DD
 * @param {Date} date
 * @returns {string|null}
 */
function formatLocalDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/**
 * 计算两个日期之间的年月天数
 * @returns {{ years, months, days, totalDays }}
 */
function calcDuration(startDate, endDate = new Date()) {
  const start = parseBusinessDate(startDate) || new Date(startDate);
  const end = parseBusinessDate(endDate) || new Date(endDate);
  if (!(start instanceof Date) || Number.isNaN(start.getTime())) {
    return { years: 0, months: 0, days: 0, totalDays: 0 };
  }
  if (!(end instanceof Date) || Number.isNaN(end.getTime())) {
    return { years: 0, months: 0, days: 0, totalDays: 0 };
  }
  const totalDays = Math.floor((end - start) / 86400000);

  let years = end.getFullYear() - start.getFullYear();
  let months = end.getMonth() - start.getMonth();
  if (months < 0) { years--; months += 12; }
  const days = end.getDate() - start.getDate();
  if (days < 0) months--;

  return { years: Math.max(0, years), months: Math.max(0, months), days: Math.max(0, totalDays % 30), totalDays };
}

/**
 * 格式化年龄（用于显示透析龄/内瘘年龄）
 * @returns {string} 如 "7年9月"
 */
function formatDuration(startDate, endDate = new Date()) {
  if (startDate == null || startDate === '') return '';
  const { years, months } = calcDuration(startDate, endDate);
  if (years === 0 && months === 0) {
    const parsed = parseBusinessDate(startDate) || new Date(startDate);
    if (!(parsed instanceof Date) || Number.isNaN(parsed.getTime())) return '';
  }
  if (years === 0) return `${months}个月`;
  if (months === 0) return `${years}年`;
  return `${years}年${months}月`;
}

/**
 * 计算年龄
 */
function calcAge(dob) {
  const today = new Date();
  const birth = parseBusinessDate(dob) || new Date(dob);
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

/**
 * 获取某年某月的天数
 */
function getDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

/**
 * 格式化日期为 YYYY-MM-DD
 */
function formatDate(date) {
  if (!date) return null;
  const d = parseBusinessDate(date);
  return formatLocalDate(d);
}

/**
 * 基于本地日历日加减天数，并返回 YYYY-MM-DD
 * @param {string|Date|number} date
 * @param {number} days
 * @returns {string|null}
 */
function addDaysToDate(date, days) {
  const d = parseBusinessDate(date);
  if (!d) return null;
  d.setDate(d.getDate() + days);
  return formatLocalDate(d);
}

/**
 * 获取某年某月的业务日期范围（YYYY-MM-DD）
 * @param {number} year
 * @param {number} month
 * @returns {{ startDate: string, endDate: string }}
 */
function getMonthRange(year, month) {
  return {
    startDate: `${year}-${pad2(month)}-01`,
    endDate: formatLocalDate(new Date(year, month, 0)),
  };
}

/**
 * 判断日期是否在N天内
 */
function isWithinDays(date, days) {
  const target = parseBusinessDate(date) || new Date(date);
  const now = new Date();
  const diff = (target - now) / 86400000;
  return diff >= 0 && diff <= days;
}

module.exports = {
  calcDuration,
  formatDuration,
  calcAge,
  getDaysInMonth,
  formatDate,
  formatLocalDate,
  parseBusinessDate,
  addDaysToDate,
  getMonthRange,
  isWithinDays,
};
