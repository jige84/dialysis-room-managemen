-- 023_devices_consumables_extend.sql
-- 透析机扩展、透析机维护表、耗材批次/入库、alerts 关联机器、consumable_stocks 扩展

-- 1) machines 扩展
ALTER TABLE machines ADD COLUMN IF NOT EXISTS brand VARCHAR(100);
ALTER TABLE machines ADD COLUMN IF NOT EXISTS bacterial_filter_installed_at DATE;
ALTER TABLE machines ADD COLUMN IF NOT EXISTS bacterial_filter_max_days INTEGER DEFAULT 90;
ALTER TABLE machines ADD COLUMN IF NOT EXISTS last_dialysate_lab_at DATE;
ALTER TABLE machines ADD COLUMN IF NOT EXISTS last_disinfection_at DATE;

ALTER TABLE machines DROP CONSTRAINT IF EXISTS machines_status_check;
ALTER TABLE machines ADD CONSTRAINT machines_status_check
  CHECK (status IN ('active','maintenance','retired','fault'));

-- 2) 透析机维护（独立于通用 devices.device_maintenance）
CREATE TABLE IF NOT EXISTS machine_maintenance (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  machine_id         UUID NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  maintenance_type   VARCHAR(30) NOT NULL
                       CHECK (maintenance_type IN ('routine','repair','disinfect','calibration','bacterial_filter')),
  maintenance_date   DATE NOT NULL,
  next_due           DATE,
  content            TEXT NOT NULL,
  result             TEXT,
  notes              TEXT,
  maintained_by      UUID REFERENCES users(id),
  created_at         TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_machine_maint_machine ON machine_maintenance(machine_id, maintenance_date DESC);

-- 3) consumable_stocks 扩展
ALTER TABLE consumable_stocks ADD COLUMN IF NOT EXISTS dialyzer_flux VARCHAR(10)
  CHECK (dialyzer_flux IS NULL OR dialyzer_flux IN ('high','low'));
ALTER TABLE consumable_stocks ADD COLUMN IF NOT EXISTS manufacturer VARCHAR(255);
ALTER TABLE consumable_stocks ADD COLUMN IF NOT EXISTS registration_no VARCHAR(100);
ALTER TABLE consumable_stocks ADD COLUMN IF NOT EXISTS storage_location VARCHAR(100);
ALTER TABLE consumable_stocks ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id);

-- 4) 耗材批次（FIFO 扣减）
CREATE TABLE IF NOT EXISTS consumable_batches (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  stock_item_id       UUID NOT NULL REFERENCES consumable_stocks(id) ON DELETE CASCADE,
  lot_no              VARCHAR(80) NOT NULL,
  expiry_date         DATE,
  quantity_remaining  INTEGER NOT NULL DEFAULT 0 CHECK (quantity_remaining >= 0),
  supplier            VARCHAR(200),
  unit_price          NUMERIC(10,2),
  inbound_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by          UUID REFERENCES users(id),
  notes               TEXT,
  created_at          TIMESTAMP DEFAULT NOW(),
  UNIQUE (stock_item_id, lot_no)
);

CREATE INDEX IF NOT EXISTS idx_batch_stock_fifo ON consumable_batches(stock_item_id, expiry_date NULLS LAST, inbound_at);

-- 5) 将现有库存迁入默认批次（便于 FIFO）
INSERT INTO consumable_batches (stock_item_id, lot_no, expiry_date, quantity_remaining, inbound_at, notes)
SELECT id, 'INIT-' || id::text, NULL, GREATEST(0, current_stock), NOW(), '023 migration backfill'
FROM consumable_stocks cs
WHERE NOT EXISTS (
  SELECT 1 FROM consumable_batches b WHERE b.stock_item_id = cs.id
)
AND COALESCE(cs.current_stock, 0) > 0
ON CONFLICT (stock_item_id, lot_no) DO NOTHING;

-- 6) consumables 出库明细关联批次（同一透析可从多批次扣减，允许多行）
ALTER TABLE consumables ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES consumable_batches(id);

-- 7) alerts 关联透析机
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS machine_id UUID REFERENCES machines(id);
CREATE INDEX IF NOT EXISTS idx_alerts_machine ON alerts(machine_id, created_at DESC) WHERE machine_id IS NOT NULL;
