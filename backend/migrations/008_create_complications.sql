-- 008_create_complications.sql
CREATE TABLE IF NOT EXISTS complications (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dialysis_record_id  UUID NOT NULL REFERENCES dialysis_records(id) ON DELETE CASCADE,
  patient_id          UUID NOT NULL REFERENCES patients(id),
  comp_type           VARCHAR(30) NOT NULL,
  is_emergency        BOOLEAN DEFAULT false,
  occurred_at         TIMESTAMP NOT NULL,
  resolved_at         TIMESTAMP,
  treatment           TEXT NOT NULL,
  outcome             TEXT,
  is_circuit_clotted  BOOLEAN DEFAULT false,
  is_avf_injury_bleed BOOLEAN DEFAULT false,
  recorded_by         UUID NOT NULL REFERENCES users(id),
  notes               TEXT,
  created_at          TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comp_dialysis ON complications(dialysis_record_id);
CREATE INDEX IF NOT EXISTS idx_comp_type     ON complications(comp_type, occurred_at DESC);
