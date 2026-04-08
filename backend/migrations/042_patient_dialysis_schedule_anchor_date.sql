-- 042_patient_dialysis_schedule_anchor_date.sql
-- 隔日透析(qod)自动生成排班时的起始锚点日期

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS dialysis_schedule_anchor_date DATE;

COMMENT ON COLUMN patients.dialysis_schedule_anchor_date IS '隔日透析(qod)排班锚点日期，与 dialysis_schedule_code=qod 配合使用';
