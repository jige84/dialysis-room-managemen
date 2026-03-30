/**
 * 透析器类耗材名称（与设备/耗材管理中透析器条目保持一致，供处方等模块下拉选用）
 */
export const DIALYZER_CONSUMABLE_NAMES = [
  '透析器 FX80（高通量）',
  '透析器 FX60（低通量）',
] as const;

export type DialyzerConsumableName = (typeof DIALYZER_CONSUMABLE_NAMES)[number];

export function getDialyzerSelectOptions(): { value: string; label: string }[] {
  return DIALYZER_CONSUMABLE_NAMES.map((name) => ({ value: name, label: name }));
}
