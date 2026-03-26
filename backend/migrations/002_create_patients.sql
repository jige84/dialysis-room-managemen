-- 002_create_patients.sql
CREATE TABLE IF NOT EXISTS patients (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                  VARCHAR(50) NOT NULL,
  gender                CHAR(1) NOT NULL CHECK (gender IN ('M','F')),
  dob                   DATE NOT NULL,
  id_card_encrypted     TEXT,
  phone_encrypted       TEXT,
  family_contact        JSONB,
  address               TEXT,
  primary_diagnosis     VARCHAR(100) NOT NULL,
  ckd_stage             SMALLINT CHECK (ckd_stage BETWEEN 1 AND 5),
  comorbidities         TEXT[],
  dialysis_start_date   DATE NOT NULL,
  dialysis_mode         VARCHAR(20) NOT NULL DEFAULT 'HD',
  status                VARCHAR(20) NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active','suspended','transferred','transplanted','deceased')),
  status_note           TEXT,
  status_changed_at     DATE,
  isolation_zone        VARCHAR(20) DEFAULT 'normal'
                          CHECK (isolation_zone IN ('normal','hbv','hcv','observation','last_shift')),
  consent_dialysis      BOOLEAN DEFAULT false,
  consent_dialysis_date DATE,
  consent_cvc           BOOLEAN DEFAULT false,
  consent_cvc_date      DATE,
  created_by            UUID REFERENCES users(id),
  created_at            TIMESTAMP DEFAULT NOW(),
  updated_at            TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patients_status ON patients(status);
CREATE INDEX IF NOT EXISTS idx_patients_name   ON patients(name);
CREATE INDEX IF NOT EXISTS idx_patients_iso    ON patients(isolation_zone);
