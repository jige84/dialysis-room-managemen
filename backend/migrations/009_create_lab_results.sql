-- 009_create_lab_results.sql
CREATE TABLE IF NOT EXISTS lab_results (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id            UUID NOT NULL REFERENCES patients(id),
  test_date             DATE NOT NULL,
  test_type             VARCHAR(30) NOT NULL,
  value                 NUMERIC(10,3) NOT NULL,
  unit                  VARCHAR(20) NOT NULL,
  reference_low         NUMERIC(10,3),
  reference_high        NUMERIC(10,3),
  target_low            NUMERIC(10,3),
  target_high           NUMERIC(10,3),
  is_abnormal           BOOLEAN DEFAULT false,
  is_critical           BOOLEAN DEFAULT false,
  is_above_target       BOOLEAN DEFAULT false,
  critical_confirmed    BOOLEAN DEFAULT false,
  critical_confirmed_by UUID REFERENCES users(id),
  critical_confirmed_at TIMESTAMP,
  entered_by            UUID REFERENCES users(id),
  notes                 TEXT,
  created_at            TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lab_patient_type ON lab_results(patient_id, test_type, test_date DESC);
CREATE INDEX IF NOT EXISTS idx_lab_critical     ON lab_results(is_critical, critical_confirmed) WHERE is_critical = true;
