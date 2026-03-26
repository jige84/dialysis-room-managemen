-- 019_create_cqi.sql
CREATE TABLE IF NOT EXISTS cqi_records (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_type        VARCHAR(30) NOT NULL,
  title               VARCHAR(200) NOT NULL,
  start_date          DATE NOT NULL,
  review_date         DATE,
  problem_found       TEXT NOT NULL,
  root_cause          TEXT,
  target_description  TEXT,
  target_value        NUMERIC(10,3),
  target_unit         VARCHAR(20),
  measures            TEXT NOT NULL,
  implementation_date DATE,
  effect_description  TEXT,
  actual_value        NUMERIC(10,3),
  is_goal_achieved    BOOLEAN,
  leader_id           UUID REFERENCES users(id),
  participants        UUID[],
  director_sign_id    UUID REFERENCES users(id),
  director_sign_date  DATE,
  notes               TEXT,
  created_at          TIMESTAMP DEFAULT NOW(),
  updated_at          TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS defect_reports (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_type            VARCHAR(30) NOT NULL
                          CHECK (event_type IN ('operation_error','equipment_failure','infection_event','medication_error','other')),
  event_time            TIMESTAMP NOT NULL,
  severity              VARCHAR(10) NOT NULL DEFAULT 'minor'
                          CHECK (severity IN ('minor','moderate','serious')),
  involved_patient_ids  UUID[],
  description           TEXT NOT NULL,
  immediate_action      TEXT,
  followup              TEXT,
  is_anonymous          BOOLEAN DEFAULT false,
  reported_by           UUID REFERENCES users(id),
  created_at            TIMESTAMP DEFAULT NOW(),
  updated_at            TIMESTAMP DEFAULT NOW()
);
