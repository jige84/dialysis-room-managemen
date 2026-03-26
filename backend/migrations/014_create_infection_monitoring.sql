-- 014_create_infection_monitoring.sql
CREATE TABLE IF NOT EXISTS infection_monitoring (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id          UUID NOT NULL REFERENCES patients(id),
  vascular_access_id  UUID REFERENCES vascular_accesses(id),
  monitor_year        SMALLINT NOT NULL,
  monitor_month       SMALLINT NOT NULL CHECK (monitor_month BETWEEN 1 AND 12),
  catheter_days       SMALLINT NOT NULL DEFAULT 0,
  is_active_this_month BOOLEAN DEFAULT true,
  infection_status    VARCHAR(20) NOT NULL DEFAULT 'none'
                        CHECK (infection_status IN ('none','suspected','confirmed','removed')),
  infection_date      DATE,
  infection_pathogen  VARCHAR(100),
  treatment           TEXT,
  outcome             VARCHAR(20),
  recorded_by         UUID REFERENCES users(id),
  notes               TEXT,
  created_at          TIMESTAMP DEFAULT NOW(),
  updated_at          TIMESTAMP DEFAULT NOW(),
  UNIQUE (patient_id, monitor_year, monitor_month)
);

CREATE INDEX IF NOT EXISTS idx_infmon_period ON infection_monitoring(monitor_year, monitor_month);
