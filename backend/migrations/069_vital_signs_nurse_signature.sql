-- 生命体征行级签名：记录该行真实填写人姓名（不等同于整单提交人）
ALTER TABLE vital_signs
  ADD COLUMN IF NOT EXISTS nurse_signature VARCHAR(80);

COMMENT ON COLUMN vital_signs.nurse_signature IS '生命体征该行填写人签名（文本）';
