-- 处方工作台扩展字段（透前评估、钠曲线、班次机位等），与 prescriptions 表列字段合并展示
ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS form_extra JSONB;

COMMENT ON COLUMN prescriptions.form_extra IS '处方表单扩展 JSON（与前端 PrescriptionWorkspace BASIC_PARAM_KEYS 等同源）';
