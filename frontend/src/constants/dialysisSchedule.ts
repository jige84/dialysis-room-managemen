/**
 * 新建/编辑患者档案：透析排班时间预设选项（与后端 patients.dialysis_schedule_code 对应）
 */
export const DIALYSIS_SCHEDULE_OPTIONS = [
  { value: 'tiw_mwf_morning', label: '每周3次：周一、三、五·上午' },
  { value: 'tiw_mwf_afternoon', label: '每周3次：周一、三、五·下午' },
  { value: 'tiw_mwf_evening', label: '每周3次：周一、三、五·晚上' },
  { value: 'tiw_tts_morning', label: '每周3次：周二、四、六·上午' },
  { value: 'tiw_tts_afternoon', label: '每周3次：周二、四、六·下午' },
  { value: 'tiw_tts_evening', label: '每周3次：周二、四、六·晚上' },
  {
    value: 'biw5_alt_morning',
    label: '两周五次：第一周周一、四、六；第二周周二、五·上午',
  },
  {
    value: 'biw5_alt_afternoon',
    label: '两周五次：第一周周一、四、六；第二周周二、五·下午',
  },
  {
    value: 'biw5_alt_evening',
    label: '两周五次：第一周周一、四、六；第二周周二、五·晚上',
  },
  { value: 'qod', label: '隔日一次' },
  {
    value: 'weekly_day_shifts',
    label: '每周固定：逐日选周几与时段（每周重复）',
  },
  { value: 'custom_cycle', label: '自定方案（两周一轮）' },
  { value: 'other', label: '其他（仅备注，不自动排班）' },
] as const;

export type DialysisScheduleCode = (typeof DIALYSIS_SCHEDULE_OPTIONS)[number]['value'];

export type DialysisShift = 'morning' | 'afternoon' | 'evening';

export interface DialysisCustomCycleWeek {
  weekdays: number[];
  shift: DialysisShift;
}

export interface DialysisCustomCyclePlan {
  week1: DialysisCustomCycleWeek;
  week2: DialysisCustomCycleWeek;
}

/** 单周内每个透析日各自对应一个时段（与 custom_cycle 的 week1/week2 结构区分） */
export interface WeeklyDialysisDaySlot {
  wd: number;
  shift: DialysisShift;
}

export const CUSTOM_SCHEDULE_NOTE_PREFIX = '[自定排班] ';

/** 两周五次：对调奇偶周与「第一周/第二周」透析日模板；可与 memo 同存 */
export const BIW5_SCHEDULE_NOTE_PREFIX = '[两周五次] ';

export function isBiw5DialysisScheduleCode(code: string | null | undefined): boolean {
  if (!code) return false;
  return code === 'biw5_alt' || code.startsWith('biw5_alt_');
}

export interface Biw5SchedulePayload {
  swapOddEvenWeeks?: boolean;
  memo?: string;
}

export function parseBiw5ScheduleNotes(notes: string | null | undefined): Biw5SchedulePayload | null {
  if (!notes?.startsWith(BIW5_SCHEDULE_NOTE_PREFIX)) return null;
  try {
    const raw = JSON.parse(notes.slice(BIW5_SCHEDULE_NOTE_PREFIX.length)) as Record<string, unknown>;
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
    return {
      swapOddEvenWeeks: raw.swapOddEvenWeeks === true ? true : undefined,
      memo: typeof raw.memo === 'string' ? raw.memo : undefined,
    };
  } catch {
    return null;
  }
}

export function serializeBiw5ScheduleNotes(payload: Biw5SchedulePayload): string {
  const o: Record<string, unknown> = {};
  if (payload.swapOddEvenWeeks) o.swapOddEvenWeeks = true;
  const mem = payload.memo?.trim();
  if (mem) o.memo = mem;
  return `${BIW5_SCHEDULE_NOTE_PREFIX}${JSON.stringify(o)}`;
}

/** 患者档案表单回填：对调开关 + 补充说明（非结构化时整段为说明） */
export function splitBiw5PatientDialysisNotes(
  code: string | null | undefined,
  notes: string | null | undefined,
): { swapOddEvenWeeks: boolean; memo: string } {
  if (!isBiw5DialysisScheduleCode(code)) return { swapOddEvenWeeks: false, memo: '' };
  const parsed = parseBiw5ScheduleNotes(notes);
  if (parsed) {
    return {
      swapOddEvenWeeks: Boolean(parsed.swapOddEvenWeeks),
      memo: (parsed.memo ?? '').trim(),
    };
  }
  return { swapOddEvenWeeks: false, memo: (notes ?? '').trim() };
}

/** 基本信息卡片「透析时间」下方灰字 */
export function formatBiw5DialysisExtraLine(code: string | null | undefined, notes: string | null | undefined): string {
  if (!isBiw5DialysisScheduleCode(code) || !notes?.trim()) return '';
  const parsed = parseBiw5ScheduleNotes(notes);
  if (parsed) {
    const bits: string[] = [];
    if (parsed.swapOddEvenWeeks) {
      bits.push('已对调奇偶周：奇 ISO 周按周二、五；偶周按周一、四、六');
    }
    if (parsed.memo?.trim()) bits.push(parsed.memo.trim());
    return bits.join('；');
  }
  return notes.trim();
}

export const WEEKDAY_OPTIONS = [
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
  { value: 0, label: '周日' },
] as const;

export const DIALYSIS_SHIFT_OPTIONS: { value: DialysisShift; label: string }[] = [
  { value: 'morning', label: '上午' },
  { value: 'afternoon', label: '下午' },
  { value: 'evening', label: '晚上' },
];

export function serializeCustomCyclePlan(plan: DialysisCustomCyclePlan): string {
  return `${CUSTOM_SCHEDULE_NOTE_PREFIX}${JSON.stringify({
    week1: {
      weekdays: [...new Set(plan.week1.weekdays)].sort((a, b) => a - b),
      shift: plan.week1.shift,
    },
    week2: {
      weekdays: [...new Set(plan.week2.weekdays)].sort((a, b) => a - b),
      shift: plan.week2.shift,
    },
  })}`;
}

export function parseCustomCyclePlan(notes: string | null | undefined): DialysisCustomCyclePlan | null {
  if (!notes?.startsWith(CUSTOM_SCHEDULE_NOTE_PREFIX)) return null;
  try {
    const raw = JSON.parse(notes.slice(CUSTOM_SCHEDULE_NOTE_PREFIX.length)) as Partial<DialysisCustomCyclePlan> & {
      weeklyDays?: unknown;
    };
    if (Array.isArray(raw.weeklyDays)) return null;
    const normalizeWeek = (week?: Partial<DialysisCustomCycleWeek>): DialysisCustomCycleWeek | null => {
      const weekdays = Array.isArray(week?.weekdays)
        ? week.weekdays
            .map((d) => Number(d))
            .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
        : [];
      const shift = week?.shift;
      if (!weekdays.length || !['morning', 'afternoon', 'evening'].includes(String(shift))) return null;
      return { weekdays: [...new Set(weekdays)], shift: shift as DialysisShift };
    };
    const week1 = normalizeWeek(raw.week1);
    const week2 = normalizeWeek(raw.week2);
    return week1 && week2 ? { week1, week2 } : null;
  } catch {
    return null;
  }
}

export function formatCustomCyclePlan(plan: DialysisCustomCyclePlan | null): string {
  if (!plan) return '';
  const dayText = (days: number[]) =>
    WEEKDAY_OPTIONS.filter((o) => days.includes(o.value)).map((o) => o.label).join('、');
  const shiftText = (shift: DialysisShift) =>
    DIALYSIS_SHIFT_OPTIONS.find((o) => o.value === shift)?.label ?? shift;
  return `第一周：${dayText(plan.week1.weekdays)} ${shiftText(plan.week1.shift)}；第二周：${dayText(plan.week2.weekdays)} ${shiftText(plan.week2.shift)}`;
}

export function serializeWeeklyDayShiftsPlan(days: WeeklyDialysisDaySlot[]): string {
  const byWd = new Map<number, DialysisShift>();
  for (const d of days) {
    const wd = Number(d.wd);
    if (!Number.isInteger(wd) || wd < 0 || wd > 6) continue;
    if (!['morning', 'afternoon', 'evening'].includes(String(d.shift))) continue;
    byWd.set(wd, d.shift);
  }
  const weeklyDays = [...byWd.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([wd, shift]) => ({ wd, shift }));
  return `${CUSTOM_SCHEDULE_NOTE_PREFIX}${JSON.stringify({ weeklyDays })}`;
}

export function parseWeeklyDayShiftsPlan(
  notes: string | null | undefined,
): { days: WeeklyDialysisDaySlot[] } | null {
  if (!notes?.startsWith(CUSTOM_SCHEDULE_NOTE_PREFIX)) return null;
  try {
    const raw = JSON.parse(notes.slice(CUSTOM_SCHEDULE_NOTE_PREFIX.length)) as { weeklyDays?: unknown };
    if (!Array.isArray(raw.weeklyDays) || raw.weeklyDays.length === 0) return null;
    const byWd = new Map<number, DialysisShift>();
    for (const item of raw.weeklyDays) {
      const o = item as { wd?: unknown; shift?: unknown };
      const wd = Number(o?.wd);
      const shift = String(o?.shift);
      if (!Number.isInteger(wd) || wd < 0 || wd > 6) return null;
      if (!['morning', 'afternoon', 'evening'].includes(shift)) return null;
      byWd.set(wd, shift as DialysisShift);
    }
    if (byWd.size === 0) return null;
    const days = [...byWd.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([wd, shift]) => ({ wd, shift }));
    return { days };
  } catch {
    return null;
  }
}

export function formatWeeklyDayShiftsPlan(plan: { days: WeeklyDialysisDaySlot[] } | null): string {
  if (!plan?.days?.length) return '';
  const dayLabel = (wd: number) => WEEKDAY_OPTIONS.find((o) => o.value === wd)?.label ?? `周${wd}`;
  const shiftText = (shift: DialysisShift) =>
    DIALYSIS_SHIFT_OPTIONS.find((o) => o.value === shift)?.label ?? shift;
  return plan.days.map((d) => `${dayLabel(d.wd)} ${shiftText(d.shift)}`).join('；');
}

/** 处方工作台「班次」下拉值（与 PrescriptionWorkspace Select 一致） */
export type PrescriptionFormShiftCode = 'am' | 'pm' | 'eve';

export function dialysisShiftToPrescriptionForm(shift: DialysisShift): PrescriptionFormShiftCode {
  if (shift === 'morning') return 'am';
  if (shift === 'evening') return 'eve';
  return 'pm';
}

/**
 * 从档案透析时间预设推断处方「班次」默认值。
 * - 预设码含 _morning/_afternoon/_evening 时直接映射；
 * - custom_cycle 取第一周班次为代表；
 * - weekly_day_shifts 取「周序最小」那一天的班次为代表；
 * - 预设码含 _morning/_afternoon/_evening 后缀时直接映射（含 biw5_alt_morning 等）；
 * - 历史码 biw5_alt（等同上午）、qod、other 等其余情况不推断。
 */
export function inferPrescriptionShiftFromPatientSchedule(input: {
  dialysis_schedule_code?: string | null;
  dialysis_schedule_notes?: string | null;
}): PrescriptionFormShiftCode | undefined {
  const code = input.dialysis_schedule_code?.trim();

  if (code === 'custom_cycle') {
    const plan = parseCustomCyclePlan(input.dialysis_schedule_notes);
    if (plan?.week1?.shift) return dialysisShiftToPrescriptionForm(plan.week1.shift);
    return undefined;
  }

  if (code === 'weekly_day_shifts') {
    const plan = parseWeeklyDayShiftsPlan(input.dialysis_schedule_notes);
    const first = plan?.days?.[0];
    if (first?.shift) return dialysisShiftToPrescriptionForm(first.shift);
    return undefined;
  }

  if (code && /_morning$/.test(code)) return 'am';
  if (code && /_afternoon$/.test(code)) return 'pm';
  if (code && /_evening$/.test(code)) return 'eve';

  return undefined;
}

/** 表单尚无班次时写入档案推断值（不覆盖已有选项或 localStorage 草稿）。 */
export function mergeShiftFromPatientProfileIntoFormValues(
  formValues: Record<string, unknown>,
  profile: { dialysis_schedule_code?: string | null; dialysis_schedule_notes?: string | null } | null | undefined,
): void {
  const inferred = inferPrescriptionShiftFromPatientSchedule(profile ?? {});
  if (!inferred) return;
  const cur = formValues.shift;
  if (cur !== undefined && cur !== null && cur !== '') return;
  formValues.shift = inferred;
}

export function getDialysisScheduleLabel(code: string | null | undefined): string {
  if (!code) return '—';
  if (code === 'biw5_alt') {
    return '两周五次：第一周周一、四、六；第二周周二、五·上午';
  }
  const hit = DIALYSIS_SCHEDULE_OPTIONS.find(o => o.value === code);
  return hit ? hit.label : code;
}
