-- 007_create_vital_signs.sql
CREATE TABLE IF NOT EXISTS vital_signs (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dialysis_record_id  UUID NOT NULL REFERENCES dialysis_records(id) ON DELETE CASCADE,
  patient_id          UUID NOT NULL REFERENCES patients(id),
  record_time         TIMESTAMP NOT NULL,
  time_label          VARCHAR(30),
  sequence_no         SMALLINT DEFAULT 1,
  systolic_bp         SMALLINT,
  diastolic_bp        SMALLINT,
  heart_rate          SMALLINT,
  arterial_pressure   SMALLINT,
  venous_pressure     SMALLINT,
  tmp                 SMALLINT,
  body_temp           NUMERIC(4,1),
  is_hypotension      BOOLEAN DEFAULT false,
  is_hypertension     BOOLEAN DEFAULT false,
  notes               TEXT,
  recorded_by         UUID REFERENCES users(id),
  created_at          TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vitals_dialysis ON vital_signs(dialysis_record_id, sequence_no);
