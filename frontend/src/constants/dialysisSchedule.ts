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
  { value: 'other', label: '其他（请在下方补充说明）' },
] as const;

export type DialysisScheduleCode = (typeof DIALYSIS_SCHEDULE_OPTIONS)[number]['value'];

export function getDialysisScheduleLabel(code: string | null | undefined): string {
  if (!code) return '—';
  const hit = DIALYSIS_SCHEDULE_OPTIONS.find(o => o.value === code);
  return hit ? hit.label : code;
}
