-- 透析耗材在处方中的细分（仓库目录与 HD / HD+HP 下拉分流）

ALTER TABLE consumable_stocks ADD COLUMN IF NOT EXISTS hemodialysis_piece_role VARCHAR(20)
  CHECK (hemodialysis_piece_role IS NULL OR hemodialysis_piece_role IN ('membrane', 'hemoperfusion'));

COMMENT ON COLUMN consumable_stocks.hemodialysis_piece_role IS 'membrane=透析器/血滤器膜 hemoperfusion=灌流器；NULL 时按名称含「灌流」推断';

UPDATE consumable_stocks
SET hemodialysis_piece_role = 'hemoperfusion'
WHERE category = 'dialyzer'
  AND hemodialysis_piece_role IS NULL
  AND (
    item_name ~ '灌流'
    OR COALESCE(specification, '') ~ '灌流'
  );

UPDATE consumable_stocks
SET hemodialysis_piece_role = 'membrane'
WHERE category = 'dialyzer'
  AND hemodialysis_piece_role IS NULL
  AND dialyzer_flux IS NOT NULL;
