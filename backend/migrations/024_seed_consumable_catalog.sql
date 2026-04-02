-- 024_seed_consumable_catalog.sql
-- 与处方透析器、自动扣减默认清单对齐的耗材目录；开发环境可保证有初始批次

INSERT INTO consumable_stocks (item_name, item_code, category, specification, unit, current_stock, alert_threshold, dialyzer_flux)
VALUES
  ('透析器 FX80（高通量）', 'DIALY-FX80-H', 'dialyzer', 'FX80', '个', 50, 30, 'high'),
  ('透析器 FX60（低通量）', 'DIALY-FX60-L', 'dialyzer', 'FX60', '个', 50, 30, 'low'),
  ('血液管路（成人型）', 'TUBING-ADULT', 'blood_tubing', '成人', '套', 50, 40, NULL),
  ('穿刺针 16G', 'NEEDLE-16G', 'needle', '16G', '盒', 50, 30, NULL)
ON CONFLICT (item_code) DO UPDATE SET
  item_name = EXCLUDED.item_name,
  specification = COALESCE(EXCLUDED.specification, consumable_stocks.specification),
  dialyzer_flux = COALESCE(EXCLUDED.dialyzer_flux, consumable_stocks.dialyzer_flux);

-- 无批次时补一批（与 current_stock 对齐）
INSERT INTO consumable_batches (stock_item_id, lot_no, expiry_date, quantity_remaining, inbound_at, notes)
SELECT cs.id, 'SEED-INIT', NULL, GREATEST(0, cs.current_stock), NOW(), '024 seed'
FROM consumable_stocks cs
WHERE cs.item_code IN ('DIALY-FX80-H','DIALY-FX60-L','TUBING-ADULT','NEEDLE-16G')
  AND NOT EXISTS (SELECT 1 FROM consumable_batches b WHERE b.stock_item_id = cs.id)
  AND COALESCE(cs.current_stock, 0) > 0
ON CONFLICT (stock_item_id, lot_no) DO NOTHING;
