-- 患者责任护士（宣教与日常管理对接人，与透析排班无绑定）
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS responsible_nurse_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_patients_responsible_nurse ON patients(responsible_nurse_id);

COMMENT ON COLUMN patients.responsible_nurse_id IS '责任护士：本科室已启用护士/护士长账号，用于宣教等，与排班表无关';
