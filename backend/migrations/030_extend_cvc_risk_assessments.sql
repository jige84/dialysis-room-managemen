-- 030_extend_cvc_risk_assessments.sql
-- 扩展 cvc_risk_assessments：新增6个前端友好的布尔因素字段
-- 来源：medical-domain-rules §4.1 CVC 感染高危评分 6 因素
ALTER TABLE cvc_risk_assessments
  ADD COLUMN IF NOT EXISTS diabetes_mellitus        BOOLEAN NOT NULL DEFAULT FALSE,  -- 糖尿病 (+2)
  ADD COLUMN IF NOT EXISTS immunosuppressed         BOOLEAN NOT NULL DEFAULT FALSE,  -- 免疫抑制 (+2)
  ADD COLUMN IF NOT EXISTS recent_hospitalization   BOOLEAN NOT NULL DEFAULT FALSE,  -- 近期住院 (+1)
  ADD COLUMN IF NOT EXISTS catheter_days_over90     BOOLEAN NOT NULL DEFAULT FALSE,  -- 留管>90天 (+2)
  ADD COLUMN IF NOT EXISTS previous_crbsi           BOOLEAN NOT NULL DEFAULT FALSE,  -- 既往CRBSI (+3)
  ADD COLUMN IF NOT EXISTS poor_hygiene             BOOLEAN NOT NULL DEFAULT FALSE;  -- 卫生依从性差 (+1)
