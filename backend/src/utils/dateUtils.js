/**
 * 日期计算工具函数
 */

/**
 * 计算两个日期之间的年月天数
 * @returns {{ years, months, days, totalDays }}
 */
function calcDuration(startDate, endDate = new Date()) {
  const start = new Date(startDate);
  const end = new Date(endDate);
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
  const { years, months } = calcDuration(startDate, endDate);
  if (years === 0) return `${months}个月`;
  if (months === 0) return `${years}年`;
  return `${years}年${months}月`;
}

/**
 * 计算年龄
 */
function calcAge(dob) {
  const today = new Date();
  const birth = new Date(dob);
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
  const d = new Date(date);
  return d.toISOString().slice(0, 10);
}

/**
 * 判断日期是否在N天内
 */
function isWithinDays(date, days) {
  const target = new Date(date);
  const now = new Date();
  const diff = (target - now) / 86400000;
  return diff >= 0 && diff <= days;
}

module.exports = { calcDuration, formatDuration, calcAge, getDaysInMonth, formatDate, isWithinDays };
