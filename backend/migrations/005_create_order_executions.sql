-- 005_create_order_executions.sql
CREATE TABLE IF NOT EXISTS order_executions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  long_term_order_id  UUID NOT NULL REFERENCES long_term_orders(id),
  patient_id          UUID NOT NULL REFERENCES patients(id),
  dialysis_record_id  UUID,
  execution_date      DATE NOT NULL,
  execution_time      TIME,
  executed_by         UUID NOT NULL REFERENCES users(id),
  status              VARCHAR(20) NOT NULL DEFAULT 'executed'
                        CHECK (status IN ('executed','skipped','modified')),
  actual_dose         VARCHAR(100),
  notes               TEXT,
  created_at          TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exec_order    ON order_executions(long_term_order_id, execution_date DESC);
CREATE INDEX IF NOT EXISTS idx_exec_patient  ON order_executions(patient_id, execution_date DESC);
