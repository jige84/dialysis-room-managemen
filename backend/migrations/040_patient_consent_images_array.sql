-- 知情同意书影像支持多张：由单路径改为 JSONB 字符串数组
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS consent_dialysis_image_paths JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE patients
SET consent_dialysis_image_paths = jsonb_build_array(consent_dialysis_image_path::text)
WHERE consent_dialysis_image_path IS NOT NULL
  AND TRIM(consent_dialysis_image_path) <> '';

ALTER TABLE patients DROP COLUMN IF EXISTS consent_dialysis_image_path;

COMMENT ON COLUMN patients.consent_dialysis_image_paths IS '知情同意书图片相对路径数组（JSON，uploads 下）';
