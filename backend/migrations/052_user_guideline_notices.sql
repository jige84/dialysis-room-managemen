-- 指南阅读中心：管理员同步资料后向具备侧栏权限的用户发送站内提醒
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS user_guideline_notices (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      VARCHAR(200) NOT NULL,
  message    TEXT NOT NULL,
  read_at    TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_guideline_notices_unread
  ON user_guideline_notices (user_id, created_at DESC)
  WHERE read_at IS NULL;

DO $gr52$
BEGIN
  GRANT SELECT, INSERT, UPDATE, DELETE ON user_guideline_notices TO PUBLIC;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE WARNING '052 GRANT user_guideline_notices 未执行：非对象属主时可忽略';
END
$gr52$;
