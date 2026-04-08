-- 患者档案抗凝默认值（与 prescriptions.anticoagulant 枚举一致；保存档案时同步至当前有效处方）
ALTER TABLE patients ADD COLUMN IF NOT EXISTS profile_anticoagulant VARCHAR(20) DEFAULT 'heparin'
  CHECK (profile_anticoagulant IN ('heparin', 'lmwh', 'citrate', 'none'));
ALTER TABLE patients ADD COLUMN IF NOT EXISTS profile_heparin_prime_dose INTEGER;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS profile_heparin_maintain NUMERIC(6, 1);

COMMENT ON COLUMN patients.profile_anticoagulant IS '档案维护的抗凝方案；保存患者时写入并覆盖当前处方对应字段';
COMMENT ON COLUMN patients.profile_heparin_prime_dose IS '档案首剂 IU';
COMMENT ON COLUMN patients.profile_heparin_maintain IS '档案追加 IU/h';
