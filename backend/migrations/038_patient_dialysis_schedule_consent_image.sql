-- 患者透析时间预设与知情同意书影像路径
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS dialysis_schedule_code VARCHAR(64),
  ADD COLUMN IF NOT EXISTS dialysis_schedule_notes TEXT,
  ADD COLUMN IF NOT EXISTS consent_dialysis_image_path VARCHAR(500);

COMMENT ON COLUMN patients.dialysis_schedule_code IS '透析排班预设代码，如 tiw_mwf_morning、biw5_alt、qod、other';
COMMENT ON COLUMN patients.dialysis_schedule_notes IS '透析时间补充/调整说明（含「其他」时的自定义）';
COMMENT ON COLUMN patients.consent_dialysis_image_path IS '知情同意书图片相对路径（uploads 下）';
