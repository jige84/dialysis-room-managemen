-- AI 会话入库：规范分类维度（scenario / subcategory）、操作人、去重元数据
DO $kb_meta$
BEGIN
  ALTER TABLE kb_documents ADD COLUMN IF NOT EXISTS ai_scenario VARCHAR(40);
  ALTER TABLE kb_documents ADD COLUMN IF NOT EXISTS ai_subcategory VARCHAR(120);
  ALTER TABLE kb_documents ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;
  ALTER TABLE kb_documents ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP;

  COMMENT ON COLUMN kb_documents.ai_scenario IS 'AI 场景键：anomaly_analysis / patient_trend / labs_analysis 等';
  COMMENT ON COLUMN kb_documents.ai_subcategory IS '二级分类：如 anomalyType、月份数等';

  CREATE INDEX IF NOT EXISTS idx_kb_documents_ai_scenario ON kb_documents(ai_scenario)
    WHERE ai_scenario IS NOT NULL;

  CREATE UNIQUE INDEX IF NOT EXISTS idx_kb_documents_ai_session_content_unique
    ON kb_documents(content_hash)
    WHERE source_type = 'ai_session' AND content_hash IS NOT NULL;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE WARNING
      '034 kb_documents 元数据列/索引未应用：当前用户非表属主。请超级用户 ALTER TABLE public.kb_documents OWNER TO 迁移用户后重跑或手工执行本文件。';
END
$kb_meta$;
