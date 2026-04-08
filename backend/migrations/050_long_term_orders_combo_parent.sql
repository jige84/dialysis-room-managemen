-- 组合用药：子医嘱指向主医嘱，共用用法/频次/frequency_detail 等（开立时由服务端写入相同字段）
ALTER TABLE long_term_orders
  ADD COLUMN IF NOT EXISTS parent_order_id UUID REFERENCES long_term_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_long_term_orders_parent ON long_term_orders(parent_order_id);
