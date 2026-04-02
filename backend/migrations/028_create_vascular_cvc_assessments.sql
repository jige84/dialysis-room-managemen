-- 028_create_vascular_cvc_assessments.sql
-- CVC（TCC/NCC）导管日常评估记录
CREATE TABLE IF NOT EXISTS vascular_cvc_assessments (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vascular_access_id        UUID NOT NULL REFERENCES vascular_accesses(id),
  patient_id                UUID NOT NULL REFERENCES patients(id),
  assessed_at               DATE NOT NULL,

  -- 血流量
  blood_flow_rate           NUMERIC(6,1),                    -- mL/min

  -- 导管功能评估
  blood_return_status       VARCHAR(50),                     -- 回血通畅/回血欠佳/回血不通
  arterial_draw_volume_ml   NUMERIC(5,1),                    -- 动脉侧回抽量 mL
  venous_draw_volume_ml     NUMERIC(5,1),                    -- 静脉侧回抽量 mL
  lock_clot_status          VARCHAR(50),                     -- 封管液凝血块状态：无/少量/大量

  -- 皮肤与固定情况
  skin_condition            TEXT,                            -- 出口处皮肤
  fixation_status           VARCHAR(50),                     -- 固定情况：良好/松动/需重新固定

  -- 综合结论
  overall_result            VARCHAR(50) NOT NULL,            -- 功能良好/导管功能不良/疑似感染/建议换管
  intervention_notes        TEXT,                            -- 干预措施

  assessed_by               UUID NOT NULL REFERENCES users(id),
  created_at                TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cvc_assess_access ON vascular_cvc_assessments(vascular_access_id, assessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_cvc_assess_patient ON vascular_cvc_assessments(patient_id, assessed_at DESC);
