-- 064_prescriptions_fix_fx60_dialyzer_flux.sql
-- FX60 为高通量透析器：历史处方可能 dialyzer_flux 为空/为 low，或 dialyzer_model 内嵌错误「低通量」文案。
-- 对当前有效处方中型号含 FX60 的记录：统一 dialyzer_flux = high，并去掉型号末尾通量括号（避免与库列再冲突）。

UPDATE prescriptions
SET
  dialyzer_flux = 'high',
  dialyzer_model = trim(
    regexp_replace(
      trim(dialyzer_model),
      E'\\s*[(（]\\s*(?:高通量|低通量)\\s*[)）]\\s*$',
      '',
      'i'
    )
  )
WHERE is_current = true
  AND dialyzer_model ~* 'FX60'
  AND (
    dialyzer_flux IS NULL
    OR dialyzer_flux = 'low'
    OR dialyzer_model ~* '低通'
  );
