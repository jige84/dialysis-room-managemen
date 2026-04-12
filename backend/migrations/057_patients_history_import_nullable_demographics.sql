-- 历史资料导入允许先创建缺少性别/出生日期的草稿患者

ALTER TABLE patients
  ALTER COLUMN gender DROP NOT NULL,
  ALTER COLUMN dob DROP NOT NULL;

COMMENT ON COLUMN patients.gender IS '性别；普通手工建档必填，历史资料导入草稿允许暂为空，后续人工补全';
COMMENT ON COLUMN patients.dob IS '出生日期；普通手工建档必填，历史资料导入草稿允许暂为空，后续人工补全';
