-- 017_create_water_quality_records.sql
CREATE TABLE IF NOT EXISTS water_quality_records (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  test_date       DATE NOT NULL,
  sample_point    VARCHAR(50) NOT NULL,
  test_type       VARCHAR(30) NOT NULL
                    CHECK (test_type IN ('bacteria_water','endotoxin_water','bacteria_dialysate','endotoxin_dialysate','bacteria_air','bacteria_surface')),
  result_value    NUMERIC(10,3),
  result_unit     VARCHAR(20),
  result_text     TEXT,
  standard_limit  NUMERIC(10,3),
  is_qualified    BOOLEAN,
  action_taken    TEXT,
  entered_by      UUID REFERENCES users(id),
  notes           TEXT,
  created_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_water_quality_date ON water_quality_records(test_date DESC);
