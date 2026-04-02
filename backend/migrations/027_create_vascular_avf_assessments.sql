-- 027_create_vascular_avf_assessments.sql
-- AVF/AVG 定期评估记录（规程要求每 8-12 周功能评估一次）
CREATE TABLE IF NOT EXISTS vascular_avf_assessments (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vascular_access_id        UUID NOT NULL REFERENCES vascular_accesses(id),
  patient_id                UUID NOT NULL REFERENCES patients(id),
  assessed_at               DATE NOT NULL,

  -- 血流量
  blood_flow_rate           NUMERIC(6,1),                    -- mL/min

  -- 体格检查（规程第11章第4节）
  pulsation                 VARCHAR(50),                     -- 搏动
  thrill                    VARCHAR(50),                     -- 震颤
  bruit                     VARCHAR(50),                     -- 杂音

  -- 超声/测量指标
  inner_diameter_mm         NUMERIC(4,1),                    -- 内径 mm（≥5mm 合格）
  skin_depth_mm             NUMERIC(4,1),                    -- 距皮深度 mm（<5mm 合格）

  -- 试验
  arm_raise_test            VARCHAR(100),                    -- 抬臂试验
  pulsation_enhancement_test VARCHAR(100),                   -- 搏动增强试验

  -- 皮肤/穿刺部位
  skin_condition            TEXT,

  -- 综合结论
  overall_result            VARCHAR(50) NOT NULL,            -- 功能良好/需关注/建议进一步检查/建议介入手术
  notes                     TEXT,

  assessed_by               UUID NOT NULL REFERENCES users(id),
  created_at                TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_avf_assess_access ON vascular_avf_assessments(vascular_access_id, assessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_avf_assess_patient ON vascular_avf_assessments(patient_id, assessed_at DESC);
