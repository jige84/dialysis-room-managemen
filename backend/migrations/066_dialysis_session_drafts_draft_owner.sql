-- 会话草稿：首位写入者锁定，仅本人与 admin 可更新 payload（他人只读拉取）
ALTER TABLE dialysis_session_drafts
  ADD COLUMN IF NOT EXISTS draft_owner_id UUID REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN dialysis_session_drafts.draft_owner_id IS '首位将草稿同步到服务端的用户；仅其与 admin 可 PUT 更新';
