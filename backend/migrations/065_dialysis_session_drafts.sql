-- 透析录入会话草稿（多终端/多用户轮询同步，未正式保存前不入 dialysis_records）
CREATE TABLE IF NOT EXISTS dialysis_session_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  session_date DATE NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT dialysis_session_drafts_patient_date UNIQUE (patient_id, session_date)
);

CREATE INDEX IF NOT EXISTS idx_dialysis_session_drafts_updated
  ON dialysis_session_drafts (updated_at DESC);

COMMENT ON TABLE dialysis_session_drafts IS '透析工作台按患者+透析日的临时录入草稿，供多用户轮询同步';
