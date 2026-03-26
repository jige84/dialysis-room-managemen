-- 018_create_consumables.sql
CREATE TABLE IF NOT EXISTS consumable_stocks (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_name       VARCHAR(100) NOT NULL,
  item_code       VARCHAR(50) UNIQUE,
  category        VARCHAR(30) NOT NULL
                    CHECK (category IN ('dialyzer','blood_tubing','needle','catheter','other')),
  specification   VARCHAR(100),
  unit            VARCHAR(20) DEFAULT '个',
  current_stock   INTEGER DEFAULT 0,
  alert_threshold INTEGER DEFAULT 10,
  unit_price      NUMERIC(8,2),
  notes           TEXT,
  updated_at      TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS consumables (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dialysis_record_id  UUID REFERENCES dialysis_records(id),
  stock_item_id       UUID NOT NULL REFERENCES consumable_stocks(id),
  patient_id          UUID NOT NULL REFERENCES patients(id),
  outbound_date       DATE NOT NULL,
  quantity            INTEGER NOT NULL DEFAULT 1,
  outbound_type       VARCHAR(20) DEFAULT 'dialysis'
                        CHECK (outbound_type IN ('dialysis','waste','other')),
  operated_by         UUID REFERENCES users(id),
  notes               TEXT,
  created_at          TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consumable_date  ON consumables(outbound_date DESC);
CREATE INDEX IF NOT EXISTS idx_consumable_stock ON consumables(stock_item_id, outbound_date DESC);
