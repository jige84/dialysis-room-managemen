-- 060_patients_identifier_status_hospitalized.sql
-- 患者档案增强：新增真实患者ID字段；状态枚举增加住院(hospitalized)

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS patient_identifier VARCHAR(64);

COMMENT ON COLUMN patients.patient_identifier IS '患者真实ID（业务侧编号，不替代系统UUID）';

-- 兼容历史：先移除旧状态约束，再按新枚举重建
ALTER TABLE patients DROP CONSTRAINT IF EXISTS patients_status_check;

ALTER TABLE patients
  ADD CONSTRAINT patients_status_check
  CHECK (status IN ('active', 'suspended', 'hospitalized', 'transferred', 'transplanted', 'deceased'));
