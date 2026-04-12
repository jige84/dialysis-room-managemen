/**
 * 将患者档案 dialysis_schedule_code 展开为自然周内具体日期与班次（morning/afternoon/evening）
 * 与 frontend/src/constants/dialysisSchedule.ts 选项一致。
 */

/** @typedef {'morning'|'afternoon'|'evening'} DbShift */

function formatUtcDate(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

/**
 * ISO 周序号（1–53），与 ISO 8601 一致
 * @param {Date} d
 */
function isoWeekNumber(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
}

/**
 * @param {string} dateStr YYYY-MM-DD
 * @returns {number} JS weekday: 0=Sun … 6=Sat
 */
function weekdayJs(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  return d.getDay();
}

/**
 * @param {string} a YYYY-MM-DD
 * @param {string} b YYYY-MM-DD
 */
function daysDiffUtc(a, b) {
  const da = new Date(`${a}T12:00:00Z`);
  const db = new Date(`${b}T12:00:00Z`);
  return Math.round((db - da) / 86400000);
}

/**
 * 从周一起连续 7 天的日期字符串
 * @param {string} weekStartMonday YYYY-MM-DD（周一）
 * @returns {string[]}
 */
function enumerateWeekDates(weekStartMonday) {
  const out = [];
  const d = new Date(`${weekStartMonday}T12:00:00Z`);
  for (let i = 0; i < 7; i += 1) {
    const cur = new Date(d);
    cur.setUTCDate(d.getUTCDate() + i);
    out.push(formatUtcDate(cur));
  }
  return out;
}

/**
 * @param {string} code
 * @param {string | null | undefined} anchorDate YYYY-MM-DD（qod 必填）
 * @param {string} weekStartMonday
 * @returns {{ scheduledDate: string, shift: DbShift }[]}
 */
function expandDialysisScheduleCode(code, anchorDate, weekStartMonday) {
  if (!code || code === 'other') return [];

  const dates = enumerateWeekDates(weekStartMonday);

  /** @type {{ scheduledDate: string, shift: DbShift }[]} */
  const slots = [];

  if (code === 'qod') {
    if (!anchorDate || !String(anchorDate).trim()) return [];
    const anchor = String(anchorDate).trim().slice(0, 10);
    const defaultShift = /** @type {DbShift} */ ('morning');
    for (const ds of dates) {
      if (daysDiffUtc(anchor, ds) % 2 === 0) {
        slots.push({ scheduledDate: ds, shift: defaultShift });
      }
    }
    return slots;
  }

  if (code === 'biw5_alt') {
    const defaultShift = /** @type {DbShift} */ ('morning');
    for (const ds of dates) {
      const wn = isoWeekNumber(new Date(`${ds}T12:00:00`));
      const odd = wn % 2 === 1;
      const wd = weekdayJs(ds);
      if (odd && (wd === 1 || wd === 4 || wd === 6)) {
        slots.push({ scheduledDate: ds, shift: defaultShift });
      }
      if (!odd && (wd === 2 || wd === 5)) {
        slots.push({ scheduledDate: ds, shift: defaultShift });
      }
    }
    return slots;
  }

  const tiw = {
    tiw_mwf_morning: { days: [1, 3, 5], shift: /** @type {DbShift} */ ('morning') },
    tiw_mwf_afternoon: { days: [1, 3, 5], shift: /** @type {DbShift} */ ('afternoon') },
    tiw_mwf_evening: { days: [1, 3, 5], shift: /** @type {DbShift} */ ('evening') },
    tiw_tts_morning: { days: [2, 4, 6], shift: /** @type {DbShift} */ ('morning') },
    tiw_tts_afternoon: { days: [2, 4, 6], shift: /** @type {DbShift} */ ('afternoon') },
    tiw_tts_evening: { days: [2, 4, 6], shift: /** @type {DbShift} */ ('evening') },
  };

  const hit = tiw[code];
  if (hit) {
    for (const ds of dates) {
      const wd = weekdayJs(ds);
      if (hit.days.includes(wd)) {
        slots.push({ scheduledDate: ds, shift: hit.shift });
      }
    }
  }

  return slots;
}

module.exports = {
  expandDialysisScheduleCode,
  enumerateWeekDates,
  isoWeekNumber,
};
