-- 患者档案干体重（与当前透析处方双向同步）
ALTER TABLE patients ADD COLUMN IF NOT EXISTS profile_dry_weight NUMERIC(5, 1);
ALTER TABLE patients ADD COLUMN IF NOT EXISTS profile_dry_weight_date DATE;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS profile_dry_weight_reason TEXT;

COMMENT ON COLUMN patients.profile_dry_weight IS '档案干体重目标(kg)；与当前有效处方 dry_weight 同步';
COMMENT ON COLUMN patients.profile_dry_weight_date IS '档案干体重评估日期';
COMMENT ON COLUMN patients.profile_dry_weight_reason IS '档案干体重变更原因';
