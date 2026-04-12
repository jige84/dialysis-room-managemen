-- 历史资料导入允许先创建待补全的患者草稿：
-- primary_diagnosis / dialysis_start_date 可暂为空，后续由人工在患者档案中补全。
ALTER TABLE patients
  ALTER COLUMN primary_diagnosis DROP NOT NULL,
  ALTER COLUMN dialysis_start_date DROP NOT NULL;

COMMENT ON COLUMN patients.primary_diagnosis IS '主要诊断；历史资料导入时允许暂为空，后续人工补全';
COMMENT ON COLUMN patients.dialysis_start_date IS '开始透析日期；历史资料导入时允许暂为空，后续人工补全';
