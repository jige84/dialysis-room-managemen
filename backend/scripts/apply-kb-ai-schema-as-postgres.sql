-- Run as superuser when kb_* tables were created by postgres. Replace hd_app with DB_USER from .env if needed.
-- Usage: psql -U postgres -d hemodialysis_db -h localhost -f backend/scripts/apply-kb-ai-schema-as-postgres.sql
-- Prefer UTF-8: chcp 65001 or set PGCLIENTENCODING=UTF8 (ASCII-only below avoids encoding issues on Windows.)

-- 1) Table and function ownership
ALTER TABLE IF EXISTS public.kb_documents OWNER TO hd_app;
ALTER TABLE IF EXISTS public.kb_chunks OWNER TO hd_app;
ALTER TABLE IF EXISTS public.kb_usage_log OWNER TO hd_app;
ALTER TABLE IF EXISTS public.guideline_citations OWNER TO hd_app;
ALTER TABLE IF EXISTS public.medication_rules OWNER TO hd_app;

-- Comment out next line if function does not exist
ALTER FUNCTION public.kb_chunks_tsvector_update() OWNER TO hd_app;

-- 2) Columns (align with migrations 034/035)
ALTER TABLE public.kb_documents ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.kb_documents ADD COLUMN IF NOT EXISTS ai_scenario VARCHAR(40);
ALTER TABLE public.kb_documents ADD COLUMN IF NOT EXISTS ai_subcategory VARCHAR(120);
ALTER TABLE public.kb_documents ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.kb_documents ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP;

COMMENT ON COLUMN public.kb_documents.ai_scenario IS 'AI scenario key: anomaly_analysis, patient_trend, labs_analysis, etc.';
COMMENT ON COLUMN public.kb_documents.ai_subcategory IS 'Subcategory: e.g. anomalyType, month count.';

CREATE INDEX IF NOT EXISTS idx_kb_documents_ai_scenario ON public.kb_documents(ai_scenario)
  WHERE ai_scenario IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_kb_documents_ai_session_content_unique
  ON public.kb_documents(content_hash)
  WHERE source_type = 'ai_session' AND content_hash IS NOT NULL;

-- 3) Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kb_documents TO PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kb_chunks TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.kb_chunks_tsvector_update() TO PUBLIC;
