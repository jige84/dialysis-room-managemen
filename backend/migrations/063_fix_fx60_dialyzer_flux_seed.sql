-- 063_fix_fx60_dialyzer_flux_seed.sql
-- FX60 为高通量透析器；024 历史种子误写为低通量（item_code DIALY-FX60-L）。
-- 已部署库：原地更正 item_name 与 dialyzer_flux（保留原 item_code，避免与自建目录冲突）。

UPDATE consumable_stocks
SET
  item_name = '透析器 FX60（高通量）',
  dialyzer_flux = 'high'
WHERE item_code = 'DIALY-FX60-L';
