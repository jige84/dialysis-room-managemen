-- 006_create_dialysis_records.sql
CREATE TABLE IF NOT EXISTS machines (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  machine_no  VARCHAR(20) UNIQUE NOT NULL,
  model       VARCHAR(50),
  zone        VARCHAR(20) NOT NULL DEFAULT 'normal'
                CHECK (zone IN ('normal','hbv','hcv')),
  status      VARCHAR(20) NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','maintenance','retired')),
  purchase_date DATE,
  serial_no   VARCHAR(100),
  notes       TEXT,
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dialysis_records (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id            UUID NOT NULL REFERENCES patients(id),
  prescription_id       UUID REFERENCES prescriptions(id),
  machine_id            UUID REFERENCES machines(id),
  session_date          DATE NOT NULL,
  shift                 VARCHAR(10) NOT NULL CHECK (shift IN ('morning','afternoon','evening')),
  nurse_id              UUID NOT NULL REFERENCES users(id),
  double_check_nurse_id UUID REFERENCES users(id),
  pre_weight            NUMERIC(5,1),
  post_weight           NUMERIC(5,1),
  uf_volume             NUMERIC(6,1),
  uf_pct_of_dry_weight  NUMERIC(5,2),
  actual_duration       INTEGER,
  start_time            TIME,
  end_time              TIME,
  blood_flow_rate       INTEGER,
  dialysate_flow_rate   INTEGER,
  dialysate_temp        NUMERIC(4,2),
  dialysate_ca          NUMERIC(4,2),
  dialysate_k           NUMERIC(4,2),
  dialysate_na          NUMERIC(5,1),
  heparin_prime_dose    INTEGER,
  heparin_maintain      NUMERIC(6,1),
  puncture_result       VARCHAR(20) CHECK (puncture_result IN ('one','two','difficult',NULL)),
  puncture_site         TEXT,
  puncture_method       VARCHAR(20) CHECK (puncture_method IN ('rope_ladder','buttonhole','area',NULL)),
  is_avf_session        BOOLEAN DEFAULT true,
  coagulation_grade     SMALLINT DEFAULT 0 CHECK (coagulation_grade IN (0,1,2,3)),
  is_circuit_clotted    BOOLEAN DEFAULT false,
  is_membrane_ruptured  BOOLEAN DEFAULT false,
  pre_bun               NUMERIC(6,2),
  post_bun              NUMERIC(6,2),
  ktv                   NUMERIC(4,2),
  urr                   NUMERIC(5,2),
  orders_auto_loaded    BOOLEAN DEFAULT false,
  orders_all_confirmed  BOOLEAN DEFAULT false,
  blood_return_method   VARCHAR(20) DEFAULT 'closed',
  notes                 TEXT,
  created_at            TIMESTAMP DEFAULT NOW(),
  updated_at            TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dialysis_patient_date ON dialysis_records(patient_id, session_date DESC);
CREATE INDEX IF NOT EXISTS idx_dialysis_date         ON dialysis_records(session_date);
CREATE INDEX IF NOT EXISTS idx_dialysis_nurse        ON dialysis_records(nurse_id, session_date);

-- 为order_executions添加外键（在dialysis_records创建后）
ALTER TABLE order_executions
  ADD CONSTRAINT fk_exec_dialysis
  FOREIGN KEY (dialysis_record_id) REFERENCES dialysis_records(id)
  ON DELETE SET NULL;
