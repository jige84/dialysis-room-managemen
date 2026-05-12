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

const CUSTOM_SCHEDULE_NOTE_PREFIX = '[自定排班] ';
const BIW5_SCHEDULE_NOTE_PREFIX = '[两周五次] ';

function parseBiw5SwapFromNotes(notes) {
  if (!notes || typeof notes !== 'string' || !notes.startsWith(BIW5_SCHEDULE_NOTE_PREFIX)) return false;
  try {
    const raw = JSON.parse(notes.slice(BIW5_SCHEDULE_NOTE_PREFIX.length));
    return Boolean(raw && raw.swapOddEvenWeeks === true);
  } catch (_) {
    return false;
  }
}

function parseCustomCyclePlan(notes) {
  if (!notes || typeof notes !== 'string' || !notes.startsWith(CUSTOM_SCHEDULE_NOTE_PREFIX)) return null;
  try {
    const raw = JSON.parse(notes.slice(CUSTOM_SCHEDULE_NOTE_PREFIX.length));
    if (Array.isArray(raw.weeklyDays)) return null;
    const normalizeWeek = (week) => {
      const weekdays = Array.isArray(week && week.weekdays)
        ? week.weekdays
            .map((d) => Number(d))
            .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
        : [];
      const shift = week && week.shift;
      if (!weekdays.length || !['morning', 'afternoon', 'evening'].includes(String(shift))) return null;
      return { weekdays: [...new Set(weekdays)], shift };
    };
    const week1 = normalizeWeek(raw.week1);
    const week2 = normalizeWeek(raw.week2);
    return week1 && week2 ? { week1, week2 } : null;
  } catch (_) {
    return null;
  }
}

function parseWeeklyDayShiftsPlan(notes) {
  if (!notes || typeof notes !== 'string' || !notes.startsWith(CUSTOM_SCHEDULE_NOTE_PREFIX)) return null;
  try {
    const raw = JSON.parse(notes.slice(CUSTOM_SCHEDULE_NOTE_PREFIX.length));
    if (!Array.isArray(raw.weeklyDays) || !raw.weeklyDays.length) return null;
    /** @type {Map<number, DbShift>} */
    const byWd = new Map();
    for (const item of raw.weeklyDays) {
      const wd = Number(item && item.wd);
      const shift = item && item.shift;
      if (!Number.isInteger(wd) || wd < 0 || wd > 6) return null;
      if (!['morning', 'afternoon', 'evening'].includes(String(shift))) return null;
      byWd.set(wd, /** @type {DbShift} */ (shift));
    }
    if (byWd.size === 0) return null;
    const days = [...byWd.entries()].sort((a, b) => a[0] - b[0]).map(([wd, sh]) => ({ wd, shift: sh }));
    return { days };
  } catch (_) {
    return null;
  }
}

/**
 * @param {string} code
 * @param {string | null | undefined} anchorDate YYYY-MM-DD（qod 必填）
 * @param {string} weekStartMonday
 * @param {string | null | undefined} notes
 * @returns {{ scheduledDate: string, shift: DbShift }[]}
 */
function expandDialysisScheduleCode(code, anchorDate, weekStartMonday, notes) {
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

  const biw5ShiftByCode = {
    biw5_alt: /** @type {DbShift} */ ('morning'),
    biw5_alt_morning: /** @type {DbShift} */ ('morning'),
    biw5_alt_afternoon: /** @type {DbShift} */ ('afternoon'),
    biw5_alt_evening: /** @type {DbShift} */ ('evening'),
  };
  const biw5Shift = biw5ShiftByCode[code];
  if (biw5Shift) {
    const swap = parseBiw5SwapFromNotes(notes);
    for (const ds of dates) {
      const wn = isoWeekNumber(new Date(`${ds}T12:00:00`));
      const isoOdd = wn % 2 === 1;
      const useWeek1Pattern = swap ? !isoOdd : isoOdd;
      const wd = weekdayJs(ds);
      if (useWeek1Pattern && (wd === 1 || wd === 4 || wd === 6)) {
        slots.push({ scheduledDate: ds, shift: biw5Shift });
      }
      if (!useWeek1Pattern && (wd === 2 || wd === 5)) {
        slots.push({ scheduledDate: ds, shift: biw5Shift });
      }
    }
    return slots;
  }

  if (code === 'weekly_day_shifts') {
    const plan = parseWeeklyDayShiftsPlan(notes);
    if (!plan) return [];
    const shiftByWd = new Map(plan.days.map((d) => [d.wd, d.shift]));
    for (const ds of dates) {
      const wd = weekdayJs(ds);
      const sh = shiftByWd.get(wd);
      if (sh) {
        slots.push({ scheduledDate: ds, shift: sh });
      }
    }
    return slots;
  }

  if (code === 'custom_cycle') {
    const plan = parseCustomCyclePlan(notes);
    if (!plan) return [];
    for (const ds of dates) {
      const wn = isoWeekNumber(new Date(`${ds}T12:00:00`));
      const weekPlan = wn % 2 === 1 ? plan.week1 : plan.week2;
      const wd = weekdayJs(ds);
      if (weekPlan.weekdays.includes(wd)) {
        slots.push({ scheduledDate: ds, shift: weekPlan.shift });
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
  parseCustomCyclePlan,
  parseWeeklyDayShiftsPlan,
};
