-- 专业医学网站、指南阅读文档、知识库核实字段、保存请求审计
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ════════════════════════════════════════════════════════
-- medical_sites：二级检索元数据（不爬取，仅注入 prompt 引用）
-- ════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS medical_sites (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_key       VARCHAR(20) UNIQUE NOT NULL,
  display_name   VARCHAR(100) NOT NULL,
  base_url       TEXT,
  search_url     TEXT,
  guidelines_url TEXT,
  specialty      TEXT[],
  priority       SMALLINT DEFAULT 5,
  enabled        BOOLEAN DEFAULT false,
  rate_limit_ms  INTEGER DEFAULT 2000,
  description    TEXT,
  last_tested_at TIMESTAMP,
  is_reachable   BOOLEAN DEFAULT false,
  created_at     TIMESTAMP DEFAULT NOW(),
  updated_at     TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_medical_sites_enabled ON medical_sites (enabled, priority)
  WHERE enabled = true;

-- kb_documents：人工核实（须先于 guideline_documents 外键；非属主则跳过）
DO $kb_ver$
BEGIN
  ALTER TABLE kb_documents ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT false;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE WARNING
      '035 未添加 kb_documents.is_verified：非表属主。知识库「已核实」等功能需超级用户 ALTER OWNER 后补执行。';
END
$kb_ver$;

-- ════════════════════════════════════════════════════════
-- guideline_documents：指南/共识阅读与 AI 读书笔记
-- ════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS guideline_documents (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title           VARCHAR(500) NOT NULL,
  issuing_body    VARCHAR(200),
  published_year  SMALLINT,
  version         VARCHAR(50),
  doc_type        VARCHAR(20) DEFAULT 'guideline'
    CHECK (doc_type IN ('guideline', 'consensus', 'standard')),
  source_type     VARCHAR(20) NOT NULL
    CHECK (source_type IN ('pdf_upload', 'url', 'doi', 'text_paste')),
  source_url      TEXT,
  source_doi      VARCHAR(100),
  file_path       TEXT,
  raw_text        TEXT,
  reading_note    JSONB,
  note_generated_at TIMESTAMP,
  note_model      VARCHAR(50) DEFAULT 'qwen3-max',
  -- 不在此处加 REFERENCES kb_documents：若 kb_documents 属主非迁移用户会报「权限不够」；由应用层保证 ID 合法
  kb_entry_id     UUID,
  is_saved_to_kb  BOOLEAN DEFAULT false,
  is_superseded   BOOLEAN DEFAULT false,
  superseded_by   UUID REFERENCES guideline_documents(id) ON DELETE SET NULL,
  uploaded_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guideline_doc_type ON guideline_documents (doc_type, published_year DESC);
CREATE INDEX IF NOT EXISTS idx_guideline_saved ON guideline_documents (is_saved_to_kb);

-- ════════════════════════════════════════════════════════
-- kb_save_requests：用户同意/拒绝保存到知识库（审计）
-- ════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS kb_save_requests (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  content_hash  VARCHAR(64) NOT NULL,
  title         VARCHAR(500),
  source_tier   SMALLINT,
  source_url    TEXT,
  requested_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  requested_at  TIMESTAMP DEFAULT NOW(),
  user_decision VARCHAR(10) CHECK (user_decision IS NULL OR user_decision IN ('approved', 'rejected')),
  decided_at    TIMESTAMP,
  kb_entry_id   UUID
);

CREATE INDEX IF NOT EXISTS idx_kb_save_hash ON kb_save_requests (content_hash);

-- ════════════════════════════════════════════════════════
-- 预置 20 个站点（默认不启用，管理员测试后 enabled=true）
-- ════════════════════════════════════════════════════════
INSERT INTO medical_sites (site_key, display_name, specialty, priority, base_url, search_url, guidelines_url, enabled, description) VALUES
  ('site_01', '中华医学会肾脏病学分会', ARRAY['nephrology','dialysis'], 1, 'https://csnchina.cma.org.cn/', NULL, NULL, false, '肾脏病学分会官网，专业园地含指南与继续教育'),
  ('site_02', '《中国血液净化》', ARRAY['dialysis','hemopurification'], 2, 'https://www.cjbp.org.cn/', NULL, NULL, false, '中国血液净化杂志在线'),
  ('site_03', '中华医学会（总会）', ARRAY['nephrology'], 1, 'https://www.cma.org.cn/', NULL, NULL, false, '中华医学会总会门户'),
  ('site_04', 'KDIGO官方网站', ARRAY['nephrology','guideline'], 1, 'https://kdigo.org/', NULL, NULL, false, '英文指南，国际肾脏病临床实践指南'),
  ('site_05', 'JASN（美国肾脏病杂志）', ARRAY['nephrology','research'], 3, 'https://jasn.asnjournals.org/', NULL, NULL, false, '英文研究期刊'),
  ('site_06', 'Kidney International', ARRAY['nephrology','research'], 3, 'https://www.kidney-international.org/', NULL, NULL, false, '英文肾脏病学期刊'),
  ('site_07', '《中华临床感染病杂志》', ARRAY['infection','control'], 2, 'https://www.zhgrb.com/', NULL, NULL, false, '感染病与院感相关文献'),
  ('site_08', '国家卫生健康委员会官网', ARRAY['regulation','guideline'], 1, 'http://www.nhc.gov.cn/', NULL, NULL, false, '卫生政策与规范性文件'),
  ('site_09', '《中国输血杂志》', ARRAY['transfusion','anemia'], 3, 'http://www.cjbt.cn/', NULL, NULL, false, '输血与贫血相关'),
  ('site_10', '万方医学网（指南专区）', ARRAY['guideline','consensus'], 2, 'https://med.wanfangdata.com.cn/', NULL, NULL, false, '需机构或个人账号'),
  ('site_11', '中国知网医学专区', ARRAY['guideline','research'], 2, 'https://www.cnki.net/', NULL, NULL, false, '需账号'),
  ('site_12', 'PubMed/NCBI', ARRAY['research','evidence'], 2, 'https://pubmed.ncbi.nlm.nih.gov/', NULL, NULL, false, '英文文献检索，无需账号'),
  ('site_13', '丁香园肾脏病频道', ARRAY['nephrology','clinical'], 3, 'https://neph.dxy.cn/', NULL, NULL, false, '丁香园肾内频道'),
  ('site_14', '医脉通', ARRAY['nephrology','clinical'], 3, 'https://www.medlive.cn/', NULL, NULL, false, '临床指南与资讯，常需账号'),
  ('site_15', '贝朗（B.Braun）中国', ARRAY['device','alarm'], 1, 'https://www.bbraun.com.cn/', NULL, NULL, false, '透析设备与技术支持资料'),
  ('site_16', '中国疾病预防控制中心', ARRAY['infection'], 5, 'https://www.chinacdc.cn/', NULL, NULL, false, '公共卫生与感染防控参考'),
  ('site_17', '血管通路（肾脏病学分会专业园地）', ARRAY['vascular'], 5, 'https://csnchina.cma.org.cn/', NULL, NULL, false, '与肾脏病学分会同源，指南与共识'),
  ('site_18', 'ISN（国际肾脏病学会）', ARRAY['nephrology','research'], 5, 'https://www.isn-online.org/', NULL, NULL, false, '国际肾脏病学会'),
  ('site_19', 'WHO肾脏健康主题', ARRAY['nephrology','guideline'], 5, 'https://www.who.int/health-topics/kidney-diseases', NULL, NULL, false, '世界卫生组织肾脏疾病主题页'),
  ('site_20', 'UpToDate', ARRAY['guideline','evidence'], 5, 'https://www.uptodate.com/', NULL, NULL, false, '英文循证，多需机构订阅')
ON CONFLICT (site_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  specialty = EXCLUDED.specialty,
  priority = EXCLUDED.priority,
  base_url = COALESCE(medical_sites.base_url, EXCLUDED.base_url),
  description = EXCLUDED.description;

-- ════════════════════════════════════════════════════════
-- 权限（与 033 一致：应用库用户可读写）
-- ════════════════════════════════════════════════════════
DO $gr35$
BEGIN
  GRANT SELECT, INSERT, UPDATE, DELETE ON medical_sites TO PUBLIC;
  GRANT SELECT, INSERT, UPDATE, DELETE ON guideline_documents TO PUBLIC;
  GRANT SELECT, INSERT, UPDATE, DELETE ON kb_save_requests TO PUBLIC;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE WARNING '035 GRANT 未全部执行：非对象属主时可忽略（若已由 DBA 授权）。';
END
$gr35$;
