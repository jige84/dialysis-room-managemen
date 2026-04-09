/**
 * 长期医嘱「具体执行」展示：将 frequency + frequency_detail 转为可读「周几 / 每月几日」等文案。
 * 与后端 OrderAutoFill.shouldExecuteToday 中周几约定一致：0=周日 … 6=周六（与 Date#getDay() 一致）。
 */

const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 表单占位说明（开立医嘱时随频次切换） */
export function frequencyDetailPlaceholder(frequency: string): string {
  switch (frequency) {
    case 'qw':
    case 'q2w':
      return '固定周几：填 0–6（0周日…6周六），如周三填 3';
    case 'qm':
      return '每月几日：填 1–31，如每月5号填 5';
    case 'biw':
      return '每周哪两天：逗号分隔周几，如 1,4 表示周一、周四';
    case 'tiw':
      return '填 135（周一三五）或 246（周二四六），可留空默认 135';
    case 'every_session':
    case 'qd':
    case 'bid':
    case 'tid':
    case 'custom':
      return '如需补充说明可填写；一般可留空';
    default:
      return '按医嘱说明填写周几或日期，可留空';
  }
}

/**
 * 表格/透析页展示用：无 detail 时仍给出频次语义提示。
 */
export function describeFrequencyDetailForOrder(
  frequency: string,
  frequencyDetail?: string | null,
): string {
  const raw = frequencyDetail != null ? String(frequencyDetail).trim() : '';

  switch (frequency) {
    case 'every_session':
      return '透析日执行';
    case 'qd':
      return raw || '每日';
    case 'bid':
      return raw || '每日 2 次';
    case 'tid':
      return raw || '每日 3 次';
    case 'tiw': {
      if (raw === '246') return '周二、周四、周六';
      if (raw) return raw;
      return '周一、周三、周五（默认）';
    }
    case 'biw': {
      if (!raw) return '周一、周四（默认）';
      const days = raw.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => n >= 0 && n <= 6);
      if (days.length === 0) return raw;
      return days.map((n) => WEEKDAY_CN[n]).join('、');
    }
    case 'qw': {
      if (!raw) return '每周 1 次（未指定周几时由系统按透析周判断）';
      const n = parseInt(raw, 10);
      if (Number.isFinite(n) && n >= 0 && n <= 6) return `每周·${WEEKDAY_CN[n]}`;
      return raw;
    }
    case 'q2w': {
      if (!raw) return '每 2 周 1 次';
      const n = parseInt(raw, 10);
      if (Number.isFinite(n) && n >= 0 && n <= 6) return `每 2 周·${WEEKDAY_CN[n]}`;
      return raw;
    }
    case 'qm': {
      if (!raw) return '每月 1 次';
      const d = parseInt(raw, 10);
      if (Number.isFinite(d) && d >= 1 && d <= 31) return `每月 ${d} 日`;
      return raw;
    }
    case 'custom':
      return raw || '自定义';
    default:
      return raw || '—';
  }
}

/**
 * 透析录入「今日医嘱执行确认」：在长期医嘱频次说明基础上叠加当前处方每周透析次数，
 * 与长期医嘱单「具体执行」同源且便于核对「每透析日 / 周几次」是否与处方一致。
 */
export function describeDialysisOrderFrequencyForSession(
  frequency: string,
  frequencyDetail: string | null | undefined,
  prescriptionSessionsPerWeek: number | null | undefined,
): string {
  const base = describeFrequencyDetailForOrder(frequency, frequencyDetail);
  const n =
    prescriptionSessionsPerWeek != null &&
    Number.isFinite(Number(prescriptionSessionsPerWeek)) &&
    Number(prescriptionSessionsPerWeek) > 0
      ? Number(prescriptionSessionsPerWeek)
      : null;
  if (n == null) return base;
  if (frequency === 'every_session') {
    return `每透析日执行（患者当前处方 ${n} 次/周）`;
  }
  return `${base} · 处方 ${n} 次/周`;
}
