-- 011_create_thrombolysis_records.sql
CREATE TABLE IF NOT EXISTS thrombolysis_records (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vascular_access_id  UUID NOT NULL REFERENCES vascular_accesses(id),
  patient_id          UUID NOT NULL REFERENCES patients(id),
  thrombolysis_date   DATE NOT NULL,
  drug_name           VARCHAR(50) DEFAULT '尿激酶',
  drug_dose           VARCHAR(50),
  method              TEXT NOT NULL,
  dwell_hours         NUMERIC(4,1),
  evaluation          TEXT NOT NULL,
  is_successful       BOOLEAN DEFAULT true,
  post_risk_score     SMALLINT,
  post_risk_grade     SMALLINT,
  performed_by        UUID NOT NULL REFERENCES users(id),
  notes               TEXT,
  created_at          TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_thrombolysis_access  ON thrombolysis_records(vascular_access_id, thrombolysis_date DESC);
CREATE INDEX IF NOT EXISTS idx_thrombolysis_patient ON thrombolysis_records(patient_id, thrombolysis_date DESC);
