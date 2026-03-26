-- 021_create_audit_logs_alerts_configs.sql

CREATE TABLE IF NOT EXISTS audit_logs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID REFERENCES users(id),
  user_name   VARCHAR(50) NOT NULL,
  user_role   VARCHAR(20),
  action      VARCHAR(20) NOT NULL,
  table_name  VARCHAR(50) NOT NULL,
  record_id   UUID,
  old_values  JSONB,
  new_values  JSONB,
  ip_address  INET,
  user_agent  TEXT,
  created_at  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_user  ON audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_table ON audit_logs(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_time  ON audit_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS alerts (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id        UUID REFERENCES patients(id),
  alert_rule_id     VARCHAR(50) NOT NULL,
  alert_type        VARCHAR(30) NOT NULL,
  severity          VARCHAR(20) NOT NULL
                      CHECK (severity IN ('emergency','critical','warning','info')),
  title             VARCHAR(200) NOT NULL,
  message           TEXT NOT NULL,
  related_record_id UUID,
  related_table     VARCHAR(50),
  status            VARCHAR(20) DEFAULT 'active'
                      CHECK (status IN ('active','dismissed','handled','auto_closed')),
  handled_by        UUID REFERENCES users(id),
  handled_at        TIMESTAMP,
  handle_notes      TEXT,
  notified_roles    TEXT[],
  created_at        TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_status  ON alerts(status, severity) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_alerts_patient ON alerts(patient_id, created_at DESC);

CREATE TABLE IF NOT EXISTS system_configs (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  config_key   VARCHAR(100) UNIQUE NOT NULL,
  config_value TEXT NOT NULL,
  config_type  VARCHAR(20) DEFAULT 'string',
  description  TEXT,
  updated_by   UUID REFERENCES users(id),
  updated_at   TIMESTAMP DEFAULT NOW()
);

INSERT INTO system_configs (config_key, config_value, description) VALUES
  ('alert_k_high_threshold',       '6.5',           '血钾危急值上限 mmol/L'),
  ('alert_k_low_threshold',        '3.0',           '血钾危急值下限 mmol/L'),
  ('alert_hb_critical',            '70',            '血红蛋白危急值下限 g/L'),
  ('ktv_target',                   '1.2',           'Kt/V达标目标值'),
  ('urr_target',                   '65',            'URR达标目标 %'),
  ('uf_pct_limit',                 '5',             '超滤量占干体重比例上限 %'),
  ('infection_screen_interval',    '180',           '传染病复查间隔天数'),
  ('avf_ultrasound_interval',      '90',            '内瘘超声评估间隔天数'),
  ('thrombolysis_monthly_limit',   '2',             '每月溶栓次数超标阈值'),
  ('cvc_risk_grade3_threshold',    '16',            'CVC高危评分Ⅲ度分值下限'),
  ('infection_screen_remind_days', '30',            '传染病复查提前提醒天数'),
  ('hospital_name',                '涉县善谷医院血液透析室', '医院名称'),
  ('head_nurse_name',              '杨晨',          '护士长姓名'),
  ('director_name',                '任计阁',        '科主任姓名')
ON CONFLICT (config_key) DO NOTHING;
