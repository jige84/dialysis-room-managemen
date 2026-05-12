/**
 * 透析器类耗材名称（与设备/耗材管理中透析器条目保持一致，供处方等模块下拉选用）
 */
export const DIALYZER_CONSUMABLE_NAMES = [
  '透析器 FX80（高通量）',
  /** FX60 为高通量膜材；离线预设须与耗材目录/临床一致，避免床旁只读区误显「低通量」 */
  '透析器 FX60（高通量）',
] as const;

export type DialyzerConsumableName = (typeof DIALYZER_CONSUMABLE_NAMES)[number];

export function getDialyzerSelectOptions(): { value: string; label: string }[] {
  return DIALYZER_CONSUMABLE_NAMES.map((name) => ({ value: name, label: name }));
}
