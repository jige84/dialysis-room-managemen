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
  { value: 'biw5_alt', label: '两周五次：第一周周一、四、六；第二周周二、五' },
  { value: 'qod', label: '隔日一次' },
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

export const CUSTOM_SCHEDULE_NOTE_PREFIX = '[自定排班] ';

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
    const raw = JSON.parse(notes.slice(CUSTOM_SCHEDULE_NOTE_PREFIX.length)) as Partial<DialysisCustomCyclePlan>;
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

export function getDialysisScheduleLabel(code: string | null | undefined): string {
  if (!code) return '—';
  const hit = DIALYSIS_SCHEDULE_OPTIONS.find(o => o.value === code);
  return hit ? hit.label : code;
}
