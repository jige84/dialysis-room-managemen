-- 010_create_vascular_accesses.sql
CREATE TABLE IF NOT EXISTS vascular_accesses (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id          UUID NOT NULL REFERENCES patients(id),
  access_type         VARCHAR(5) NOT NULL CHECK (access_type IN ('avf','avg','ncc','tcc')),
  location            VARCHAR(50) NOT NULL,
  established_date    DATE NOT NULL,
  first_use_date      DATE,
  puncture_method     VARCHAR(20) CHECK (puncture_method IN ('rope_ladder','buttonhole','area',NULL)),
  is_buttonhole       BOOLEAN GENERATED ALWAYS AS (puncture_method = 'buttonhole') STORED,
  last_ultrasound_date DATE,
  ultrasound_result   VARCHAR(20) CHECK (ultrasound_result IN ('normal','stenosis','thrombosis','aneurysm',NULL)),
  ultrasound_notes    TEXT,
  is_active           BOOLEAN DEFAULT true,
  deactivated_date    DATE,
  deactivation_reason VARCHAR(50),
  catheter_days_total INTEGER,
  last_risk_score     SMALLINT,
  last_risk_grade     SMALLINT,
  notes               TEXT,
  created_by          UUID REFERENCES users(id),
  created_at          TIMESTAMP DEFAULT NOW(),
  updated_at          TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vascular_patient    ON vascular_accesses(patient_id, is_active);
CREATE INDEX IF NOT EXISTS idx_vascular_type       ON vascular_accesses(access_type, is_active);
CREATE INDEX IF NOT EXISTS idx_vascular_buttonhole ON vascular_accesses(is_buttonhole) WHERE is_buttonhole = true;
