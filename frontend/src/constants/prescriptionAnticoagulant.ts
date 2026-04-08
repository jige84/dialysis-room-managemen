/**
 * 透析处方抗凝方案选项与展示（与 PrescriptionWorkspace 表单一致）
 */
export const ANTICOAGULANT_OPTIONS = [
  { value: 'heparin', label: '普通肝素' },
  { value: 'lmwh', label: '低分子肝素' },
  { value: 'enoxaparin', label: '依诺肝素' },
  { value: 'bemiparin', label: '贝米肝素' },
  { value: 'nafamostat', label: '甲磺酸萘莫司他' },
  { value: 'citrate', label: '枸橼酸' },
  { value: 'none', label: '无抗凝' },
] as const;

/** 数据库 anticoagulant 枚举 → 表单选项 value（与透析处方页一致） */
export function mapDbAnticoagulantToForm(db: string | undefined): string {
  if (db === 'heparin') return 'heparin';
  if (db === 'citrate') return 'citrate';
  if (db === 'none') return 'none';
  return 'lmwh';
}

export function getAnticoagulantLabelFromDb(db: string | null | undefined): string {
  const key = mapDbAnticoagulantToForm(db ?? undefined);
  const hit = ANTICOAGULANT_OPTIONS.find((o) => o.value === key);
  return hit?.label ?? (db?.trim() ? db : '—');
}

/** 表单选项 → 入库枚举（与透析处方保存逻辑一致） */
export function mapFormAnticoagulantToDb(v: string | undefined): 'heparin' | 'lmwh' | 'citrate' | 'none' {
  if (v === 'heparin') return 'heparin';
  if (v === 'citrate') return 'citrate';
  if (v === 'none') return 'none';
  return 'lmwh';
}

/** 患者档案抗凝展示（读 patients.profile_*，非处方表） */
export function formatProfileAnticoagulantSummary(p: {
  profile_anticoagulant?: string | null;
  profile_heparin_prime_dose?: number | null;
  profile_heparin_maintain?: number | null;
}): { scheme: string; firstDose: string; maintainDose: string } {
  const scheme = getAnticoagulantLabelFromDb(p.profile_anticoagulant ?? 'heparin');
  const firstDose = p.profile_heparin_prime_dose != null ? `${p.profile_heparin_prime_dose} IU` : '—';
  const maintainDose = p.profile_heparin_maintain != null ? `${p.profile_heparin_maintain} IU/h` : '—';
  return { scheme, firstDose, maintainDose };
}
