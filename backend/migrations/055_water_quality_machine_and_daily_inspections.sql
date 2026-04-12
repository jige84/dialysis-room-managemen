-- 055: 水质记录关联水机；水处理日常检测持久化
-- water_quality_records：可选关联水机，用于回写台账「最近水质结果」
ALTER TABLE water_quality_records
  ADD COLUMN IF NOT EXISTS water_machine_id UUID REFERENCES water_machines(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_water_quality_water_machine ON water_quality_records(water_machine_id);

-- 水处理系统日常检测（硬度、压差、电导等）
CREATE TABLE IF NOT EXISTS water_daily_inspections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  water_machine_id UUID REFERENCES water_machines(id) ON DELETE SET NULL,
  check_date DATE NOT NULL,
  hardness TEXT,
  total_chlorine TEXT,
  tap_pressure TEXT,
  sand_delta_p TEXT,
  resin_delta_p TEXT,
  carbon_delta_p TEXT,
  ro_in_pressure TEXT,
  ro_out_pressure TEXT,
  feed_conductivity TEXT,
  product_conductivity TEXT,
  product_flow TEXT,
  drain_flow TEXT,
  feed_temp TEXT,
  operator_name TEXT,
  notes TEXT,
  entered_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_water_daily_inspections_date ON water_daily_inspections(check_date DESC);
CREATE INDEX IF NOT EXISTS idx_water_daily_inspections_machine ON water_daily_inspections(water_machine_id, check_date DESC);
