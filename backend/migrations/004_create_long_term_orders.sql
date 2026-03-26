-- 004_create_long_term_orders.sql
CREATE TABLE IF NOT EXISTS long_term_orders (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id      UUID NOT NULL REFERENCES patients(id),
  prescription_id UUID REFERENCES prescriptions(id),
  order_type      VARCHAR(20) NOT NULL
                    CHECK (order_type IN ('dialysis_drug','interval_drug','treatment','diet','care','observation')),
  drug_name       VARCHAR(100) NOT NULL,
  drug_spec       VARCHAR(100),
  dose            VARCHAR(100),
  dose_unit       VARCHAR(20),
  route           VARCHAR(30),
  frequency       VARCHAR(30) NOT NULL
                    CHECK (frequency IN ('every_session','qd','bid','tiw','biw','qw','q2w','qm','custom')),
  frequency_detail TEXT,
  execute_timing  VARCHAR(30)
                    CHECK (execute_timing IN ('pre_dialysis','during_dialysis','post_dialysis','anytime',NULL)),
  status          VARCHAR(20) NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','stopped','expired')),
  ordered_by      UUID NOT NULL REFERENCES users(id),
  ordered_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  valid_from      DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until     DATE,
  stopped_by      UUID REFERENCES users(id),
  stopped_at      TIMESTAMP,
  stop_reason     TEXT,
  notes           TEXT,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_patient_status ON long_term_orders(patient_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_prescription   ON long_term_orders(prescription_id);
