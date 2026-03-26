-- 015_create_schedules.sql
CREATE TABLE IF NOT EXISTS schedules (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id      UUID NOT NULL REFERENCES patients(id),
  machine_id      UUID NOT NULL REFERENCES machines(id),
  scheduled_date  DATE NOT NULL,
  shift           VARCHAR(10) NOT NULL CHECK (shift IN ('morning','afternoon','evening')),
  is_last_shift   BOOLEAN DEFAULT false,
  is_isolation    BOOLEAN DEFAULT false,
  is_attended     BOOLEAN,
  absence_reason  TEXT,
  is_swap         BOOLEAN DEFAULT false,
  swap_from_id    UUID REFERENCES schedules(id),
  approved_by     UUID REFERENCES users(id),
  approved_at     TIMESTAMP,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW(),
  UNIQUE (machine_id, scheduled_date, shift)
);

CREATE INDEX IF NOT EXISTS idx_schedule_patient ON schedules(patient_id, scheduled_date DESC);
CREATE INDEX IF NOT EXISTS idx_schedule_date    ON schedules(scheduled_date, shift);
