-- 029_create_vascular_punctures.sql
-- AVF/AVG 穿刺记录（规程第11章第4节：连续3次穿刺困难须触发预警）
CREATE TABLE IF NOT EXISTS vascular_punctures (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vascular_access_id        UUID NOT NULL REFERENCES vascular_accesses(id),
  patient_id                UUID NOT NULL REFERENCES patients(id),
  puncture_date             DATE NOT NULL,

  -- 穿刺操作者
  nurse_id                  UUID NOT NULL REFERENCES users(id),

  -- 动/静脉针位置
  arterial_site             VARCHAR(100),
  venous_site               VARCHAR(100),

  -- 穿刺尝试次数
  attempts                  SMALLINT NOT NULL DEFAULT 1 CHECK (attempts >= 1),

  -- 结果
  puncture_result           VARCHAR(50) NOT NULL,  -- 顺利/困难/失败（困难/失败自动统计预警）
  hematoma_occurred         BOOLEAN NOT NULL DEFAULT FALSE,  -- 是否发生血肿（计入穿刺损伤发生率分子）

  notes                     TEXT,

  created_at                TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_puncture_access ON vascular_punctures(vascular_access_id, puncture_date DESC);
CREATE INDEX IF NOT EXISTS idx_puncture_patient ON vascular_punctures(patient_id, puncture_date DESC);
-- 用于统计连续穿刺困难次数（业务规则：连续3次困难 → MEDIUM 级预警）
CREATE INDEX IF NOT EXISTS idx_puncture_result ON vascular_punctures(vascular_access_id, puncture_result, puncture_date DESC);
