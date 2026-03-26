-- 003_create_prescriptions.sql
CREATE TABLE IF NOT EXISTS prescriptions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id          UUID NOT NULL REFERENCES patients(id),
  frequency_per_week  SMALLINT NOT NULL DEFAULT 3,
  duration_hours      NUMERIC(3,1) NOT NULL DEFAULT 4.0,
  dialyzer_model      VARCHAR(100),
  dialyzer_area       NUMERIC(4,2),
  dialyzer_flux       VARCHAR(10) CHECK (dialyzer_flux IN ('high','low')),
  anticoagulant       VARCHAR(20) DEFAULT 'heparin'
                        CHECK (anticoagulant IN ('heparin','lmwh','citrate','none')),
  heparin_prime_dose  INTEGER,
  heparin_maintain    NUMERIC(6,1),
  dry_weight          NUMERIC(5,1) NOT NULL,
  dry_weight_date     DATE NOT NULL,
  dry_weight_reason   TEXT,
  dialysate_na        NUMERIC(5,1) DEFAULT 138,
  dialysate_ca        NUMERIC(4,2) DEFAULT 1.5,
  dialysate_k         NUMERIC(4,2) DEFAULT 2.0,
  dialysate_temp      NUMERIC(4,2) DEFAULT 36.5,
  blood_flow_rate     INTEGER DEFAULT 250,
  dialysate_flow_rate INTEGER DEFAULT 500,
  is_current          BOOLEAN DEFAULT true,
  prescribed_by       UUID REFERENCES users(id),
  valid_from          DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until         DATE,
  notes               TEXT,
  created_at          TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rx_patient ON prescriptions(patient_id, is_current);
