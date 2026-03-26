-- 013_create_infection_screenings.sql
CREATE TABLE IF NOT EXISTS infection_screenings (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id          UUID NOT NULL REFERENCES patients(id),
  test_date           DATE NOT NULL,
  test_type           VARCHAR(20) NOT NULL
                        CHECK (test_type IN ('hbsag','hbvdna','hcvab','hcvrna','hiv','syphilis_tppa','syphilis_rpr','chest_xray')),
  result              VARCHAR(20) NOT NULL CHECK (result IN ('positive','negative','abnormal','normal')),
  value               VARCHAR(50),
  is_positive         BOOLEAN NOT NULL DEFAULT false,
  next_due_date       DATE,
  reminder_days_before SMALLINT DEFAULT 30,
  is_new_positive     BOOLEAN DEFAULT false,
  previous_result     VARCHAR(20),
  entered_by          UUID REFERENCES users(id),
  notes               TEXT,
  created_at          TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_screening_patient ON infection_screenings(patient_id, test_type, test_date DESC);
CREATE INDEX IF NOT EXISTS idx_screening_due     ON infection_screenings(next_due_date) WHERE next_due_date IS NOT NULL;
