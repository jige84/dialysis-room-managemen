-- 透析记录单护士签名栏位（与录入页 Form 字段一致，供历史/详情/打印展示）
ALTER TABLE dialysis_records
  ADD COLUMN IF NOT EXISTS nurse_puncture_sign VARCHAR(80),
  ADD COLUMN IF NOT EXISTS nurse_on_machine_sign VARCHAR(80),
  ADD COLUMN IF NOT EXISTS nurse_double_check_sign VARCHAR(80),
  ADD COLUMN IF NOT EXISTS nurse_record_sign VARCHAR(80);

COMMENT ON COLUMN dialysis_records.nurse_puncture_sign IS '穿刺护士签名（文本，与纸质单一致）';
COMMENT ON COLUMN dialysis_records.nurse_on_machine_sign IS '上机护士签名';
COMMENT ON COLUMN dialysis_records.nurse_double_check_sign IS '二次核对护士签名';
COMMENT ON COLUMN dialysis_records.nurse_record_sign IS '记录护士签名';
