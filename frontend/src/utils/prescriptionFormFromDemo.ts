/**
 * 由透析演示患者数据生成处方工作台表单默认值（与 DialysisEntry 患者信息一致）
 */
import type { DialysisDemoPatient } from '../constants/dialysisDemoPatients';

/** 与 PrescriptionWorkspace 保存的「基本参数」共用同一存储键，供透析录入页合并展示 */
export const PRESCRIPTION_BASIC_PARAMS_STORAGE_KEY = 'hd_prescription_basic_params_defaults_v1';

/** 真实患者按 UUID 分键存储，避免多患者共用一份本地草稿互相覆盖 */
export function prescriptionBasicParamsStorageKey(patientId?: string): string {
  if (patientId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(patientId)) {
    return `${PRESCRIPTION_BASIC_PARAMS_STORAGE_KEY}::${patientId}`;
  }
  return PRESCRIPTION_BASIC_PARAMS_STORAGE_KEY;
}

export function loadPrescriptionBasicParamsFromStorage(patientId?: string): Record<string, unknown> {
  const key = prescriptionBasicParamsStorageKey(patientId);
  try {
    const raw = localStorage.getItem(key);
    if (!raw && patientId) {
      const legacy = localStorage.getItem(PRESCRIPTION_BASIC_PARAMS_STORAGE_KEY);
      if (legacy) return JSON.parse(legacy) as Record<string, unknown>;
    }
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== 'object') return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function savePrescriptionBasicParamsToStorage(patientId: string | undefined, data: Record<string, unknown>): void {
  try {
    localStorage.setItem(prescriptionBasicParamsStorageKey(patientId), JSON.stringify(data));
  } catch {
    /* ignore quota */
  }
}

/** 与 PrescriptionWorkspace 写入 prescriptions.notes 的分隔符一致 */
export const PRESCRIPTION_NOTES_COMBINED_SEPARATOR = '\n\n---\n\n';

/** 库中 notes 合并字段拆成「透前补充」与「处方备注」（与 PrescriptionWorkspace 同源） */
export function splitPrescriptionNotesFromDb(raw: string | null | undefined): { preAssessOther: string; notes: string } {
  if (raw == null || String(raw).trim() === '') return { preAssessOther: '', notes: '' };
  const s = String(raw);
  const idx = s.indexOf(PRESCRIPTION_NOTES_COMBINED_SEPARATOR);
  if (idx === -1) return { preAssessOther: s.trim(), notes: '' };
  return {
    preAssessOther: s.slice(0, idx).trim(),
    notes: s.slice(idx + PRESCRIPTION_NOTES_COMBINED_SEPARATOR.length).trim(),
  };
}

const UF_MODE_EXTRA_ML: Record<string, number> = {
  HD: 200,
  HDF: 200,
  HD_HP: 500,
};

/** 与 PrescriptionWorkspace `computeUltrafiltrationMl` 一致：(前−干)×1000 + 方式附加量 */
export function computePrescriptionUltrafiltrationMl(preKg: number, dryKg: number, mode: string): number {
  const diffMl = (preKg - dryKg) * 1000;
  const extra = UF_MODE_EXTRA_ML[mode] ?? 0;
  return Math.round(diffMl + extra);
}

/** 与处方工作台摘要「透析器」展示一致：去掉「透析器」前缀 */
export function dialyzerShortFromFormValue(dialyzer: string | undefined): string {
  if (!dialyzer) return '—';
  const s = String(dialyzer).replace(/^透析器\s*/, '').trim();
  return s || '—';
}

/** 与 PrescriptionWorkspace ANTICOAGULANT_OPTIONS 标签一致 */
export function anticoagulantLabelFromCode(code: string | undefined): string {
  if (!code) return '—';
  const m: Record<string, string> = {
    heparin: '普通肝素',
    lmwh: '低分子肝素',
    enoxaparin: '依诺肝素',
    bemiparin: '贝米肝素',
    nafamostat: '甲磺酸萘莫司他',
    citrate: '枸橼酸',
    none: '无抗凝',
  };
  return m[code] ?? '—';
}

function mapAnticoagulantCode(anticoagulantLabel: string): string {
  if (anticoagulantLabel.includes('低分子')) return 'lmwh';
  return 'heparin';
}

function shiftCodeFromLabel(shift: string): 'am' | 'pm' | 'eve' {
  if (shift.includes('上午')) return 'am';
  if (shift.includes('晚班') || (shift.includes('晚') && !shift.includes('下午'))) return 'eve';
  return 'pm';
}

function dialyzerForForm(dialyzer: string): string {
  return dialyzer.startsWith('透析器') ? dialyzer : `透析器 ${dialyzer}`;
}

export function buildPrescriptionDefaultsFromDemo(demo: DialysisDemoPatient): Record<string, unknown> {
  const pr = demo.prescription;
  const pre = demo.preAssessment;
  const preMachineWeight =
    demo.value === 'zhang' ? 64.5 : demo.value === 'zhao' ? 54.2 : 52.8;
  const mode = 'HD';
  const uf = computePrescriptionUltrafiltrationMl(preMachineWeight, demo.dryWeight, mode);

  return {
    frequencyPreset: 'weekly_3',
    frequencyCustom: '',
    duration: pr.duration,
    mode,
    modeOther: '',
    dialyzer: dialyzerForForm(pr.dialyzer),
    bloodFlow: pr.bloodFlow,
    dialysateFlow: pr.dialysateFlow,
    anticoagulant: mapAnticoagulantCode(pr.anticoagulant),
    heparinFirst: 3000,
    heparinMaint: 500,
    na: pr.na,
    k: pr.k,
    ca: pr.ca,
    temp: 36.5,
    sodiumCurve: 'fixed',
    sodiumCurveCustom: '',
    naCurveStart: pr.na,
    naCurveEnd: pr.na,
    naCurveTimeStart: '',
    naCurveTimeEnd: '',
    dryWeight: demo.dryWeight,
    dryWeightChangeReason: '',
    preMachineWeight,
    ultrafiltrationMl: uf,
    preAssessSbp: pre.sbp,
    preAssessDbp: pre.dbp,
    preAssessPulse: pre.pulse,
    /** 透前其他补充说明（手填） */
    preAssessOther: '',
    preAssessEdema: demo.value === 'liu' ? 'yes' : 'no',
    preAssessEdemaSite: demo.value === 'liu' ? '双下肢轻度' : '',
    preAssessBleeding: 'no',
    preAssessBleedingDesc: '',
    shift: shiftCodeFromLabel(pre.shift),
    machineNo: pre.machineNo,
    doctorSignature: '',
    notes: '',
  };
}

/** 演示默认值 + localStorage 中医生保存的参数（与处方工作台「保存处方」同源） */
export function mergePrescriptionDefaultsForPatient(demo: DialysisDemoPatient): Record<string, unknown> {
  const base = buildPrescriptionDefaultsFromDemo(demo);
  const stored = loadPrescriptionBasicParamsFromStorage(demo.value);
  return { ...base, ...stored };
}

export function shiftCodeToChinese(code: string | undefined): string {
  const m: Record<string, string> = { am: '上午班', pm: '下午班', eve: '晚班' };
  return (code && m[code]) || '下午班';
}

/** 与 PrescriptionWorkspace FREQUENCY_PRESET_OPTIONS 一致 */
export function frequencyPresetLabel(code: string | undefined, custom: string | undefined): string {
  if (code === 'other' && custom?.trim()) return custom.trim();
  const m: Record<string, string> = {
    weekly_2: '每周2次',
    weekly_3: '每周3次',
    biweekly_5: '2周5次',
    weekly_1: '每周1次',
    other: '其他（手动填写）',
  };
  return m[code ?? ''] ?? '—';
}

/** 与 PrescriptionWorkspace MODE_OPTIONS 一致 */
export function dialysisModeLabel(code: string | undefined, other: string | undefined): string {
  if (code === 'other' && other?.trim()) return other.trim();
  const m: Record<string, string> = {
    HD: 'HD（血液透析）',
    HDF: 'HDF（血液透析滤过）',
    HD_HP: 'HD+HP（血液透析+灌流）',
    other: '其他',
  };
  return m[code ?? ''] ?? '—';
}

/** 与 PrescriptionWorkspace SODIUM_CURVE_OPTIONS 一致 */
export function sodiumCurveLabel(code: string | undefined): string {
  const m: Record<string, string> = {
    fixed: '固定钠（无钠曲线）',
    linear_up: '线性升钠曲线',
    linear_down: '线性降钠曲线',
    step: '阶梯式钠曲线',
    programmable: '可编程钠曲线（按机型档案）',
    iuf: '单超（单纯超滤）',
    iuf_sequential_hd: '单超序贯透析（先单超后常规 HD）',
    other: '其他（手动说明）',
  };
  return m[code ?? ''] ?? '—';
}

/** 钠曲线一行摘要（与处方表单字段对应） */
export function formatSodiumCurveSummary(rx: Record<string, unknown>): string {
  const mode = String(rx.sodiumCurve ?? 'fixed');
  const base = sodiumCurveLabel(mode);
  if (mode === 'programmable' || mode === 'other') {
    const c = String(rx.sodiumCurveCustom ?? '').trim();
    return c ? `${base} · ${c}` : base;
  }
  if (mode === 'linear_up' || mode === 'linear_down' || mode === 'step') {
    const ns = rx.naCurveStart;
    const ne = rx.naCurveEnd;
    if (typeof ns === 'number' && typeof ne === 'number') {
      return `${base}（${ns}→${ne} mmol/L）`;
    }
  }
  return base;
}

/** 与处方「水肿 / 活动性出血」选项展示一致 */
export function yesNoAssessLabel(code: string | undefined): string {
  if (code === 'yes') return '有';
  if (code === 'no') return '无';
  return '—';
}
