-- 资料库、指南引用、用药规则（异常分析 / 用药辅助）
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS kb_documents (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_type   VARCHAR(30) NOT NULL
                CHECK (source_type IN ('manual', 'ai_session', 'web_import', 'guideline')),
  title         VARCHAR(500) NOT NULL,
  source_url    TEXT,
  content_hash  VARCHAR(64),
  status        VARCHAR(20) NOT NULL DEFAULT 'published'
                CHECK (status IN ('draft', 'published')),
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kb_chunks (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id     UUID NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,
  chunk_index     INTEGER NOT NULL DEFAULT 0,
  content_text    TEXT NOT NULL,
  tags            TEXT,
  search_vector   tsvector,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- CREATE INDEX 在 PostgreSQL 中同样需要表属主（或超级用户）；与触发器逻辑一致
DO $kb_idx$
DECLARE
  idx_owner name;
BEGIN
  SELECT c.relowner::regrole::name INTO idx_owner
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'kb_chunks';

  IF idx_owner IS NULL THEN
    RETURN;
  END IF;

  IF idx_owner = current_user::name THEN
    CREATE INDEX IF NOT EXISTS idx_kb_chunks_doc ON kb_chunks(document_id);
    CREATE INDEX IF NOT EXISTS idx_kb_chunks_search ON kb_chunks USING GIN (search_vector);
  ELSE
    RAISE WARNING
      'kb_chunks 索引未创建：表属主为 %，当前为 %。请由超级用户执行 ALTER TABLE public.kb_chunks OWNER TO %; 后补建索引。',
      idx_owner, current_user::name, current_user::name;
  END IF;
END
$kb_idx$;

CREATE TABLE IF NOT EXISTS kb_usage_log (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_kind          VARCHAR(40) NOT NULL,
  patient_id            UUID REFERENCES patients(id) ON DELETE SET NULL,
  anomaly_type          VARCHAR(80),
  query_text            TEXT,
  retrieved_chunk_ids   UUID[],
  used_web_fallback     BOOLEAN NOT NULL DEFAULT false,
  created_by            UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW()
);

DO $kb_ul_idx$
DECLARE
  o name;
BEGIN
  SELECT c.relowner::regrole::name INTO o
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'kb_usage_log';
  IF o IS NULL THEN RETURN; END IF;
  IF o = current_user::name THEN
    CREATE INDEX IF NOT EXISTS idx_kb_usage_patient ON kb_usage_log(patient_id, created_at DESC);
  ELSE
    RAISE WARNING 'kb_usage_log 索引未创建：属主 % 非当前用户 %', o, current_user::name;
  END IF;
END
$kb_ul_idx$;

CREATE TABLE IF NOT EXISTS guideline_citations (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code          VARCHAR(64) NOT NULL UNIQUE,
  title         VARCHAR(500) NOT NULL,
  source_name   VARCHAR(300) NOT NULL,
  edition       VARCHAR(120),
  chapter_ref   VARCHAR(200),
  excerpt_text  TEXT NOT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS medication_rules (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rule_type       VARCHAR(30) NOT NULL
                  CHECK (rule_type IN ('duplicate', 'interaction', 'contraindication', 'dialysis_note')),
  severity        VARCHAR(10) NOT NULL
                  CHECK (severity IN ('block', 'warn')),
  drug_pattern_a  VARCHAR(200) NOT NULL,
  drug_pattern_b  VARCHAR(200),
  message_zh      TEXT NOT NULL,
  condition_json  JSONB DEFAULT '{}',
  citation_id     UUID REFERENCES guideline_citations(id) ON DELETE SET NULL,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

DO $med_r_idx$
DECLARE
  o name;
BEGIN
  SELECT c.relowner::regrole::name INTO o
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'medication_rules';
  IF o IS NULL THEN RETURN; END IF;
  IF o = current_user::name THEN
    CREATE INDEX IF NOT EXISTS idx_med_rules_active ON medication_rules(is_active, rule_type);
  ELSE
    RAISE WARNING 'medication_rules 索引未创建：属主 % 非当前用户 %', o, current_user::name;
  END IF;
END
$med_r_idx$;

-- 若函数已由其他角色创建，CREATE OR REPLACE 会失败；仅在无函数或当前用户为属主时写入
DO $kb_fn$
DECLARE
  fn_owner name;
BEGIN
  SELECT pg_get_userbyid(p.proowner)::name INTO fn_owner
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'kb_chunks_tsvector_update'
  LIMIT 1;

  IF fn_owner IS NULL THEN
    EXECUTE $ddl$
CREATE FUNCTION public.kb_chunks_tsvector_update() RETURNS trigger
LANGUAGE plpgsql
AS $f$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', coalesce(NEW.content_text, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.tags, '')), 'B');
  RETURN NEW;
END;
$f$;
$ddl$;
  ELSIF fn_owner = current_user::name THEN
    EXECUTE $ddl2$
CREATE OR REPLACE FUNCTION public.kb_chunks_tsvector_update() RETURNS trigger
LANGUAGE plpgsql
AS $f$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', coalesce(NEW.content_text, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.tags, '')), 'B');
  RETURN NEW;
END;
$f$;
$ddl2$;
  ELSE
    RAISE WARNING
      'kb_chunks_tsvector_update 未替换定义：函数属主为 %，当前为 %。可保留已有定义或请超级用户 ALTER FUNCTION ... OWNER TO。',
      fn_owner, current_user::name;
  END IF;
END
$kb_fn$;

-- 仅表属主可创建/删除触发器。若 kb_chunks 由其他角色创建（如历史手工建表），则跳过并提示由 DBA ALTER OWNER 后补建。
DO $kb_trig$
DECLARE
  tbl_owner name;
BEGIN
  SELECT c.relowner::regrole::name INTO tbl_owner
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'kb_chunks';

  IF tbl_owner IS NULL THEN
    RETURN;
  END IF;

  IF tbl_owner = current_user::name THEN
    DROP TRIGGER IF EXISTS trg_kb_chunks_tsvector ON kb_chunks;
    CREATE TRIGGER trg_kb_chunks_tsvector
      BEFORE INSERT OR UPDATE OF content_text, tags ON kb_chunks
      FOR EACH ROW EXECUTE PROCEDURE kb_chunks_tsvector_update();
  ELSE
    RAISE WARNING
      'kb_chunks 触发器未创建：表属主为 %，当前为 %。可由超级用户执行 ALTER TABLE public.kb_chunks OWNER TO %; 后重新迁移或手工建触发器。',
      tbl_owner, current_user::name, current_user::name;
  END IF;
END
$kb_trig$;

-- 种子数据：若表属主非迁移用户，INSERT 可能失败；不阻断迁移，由 DBA 补授权或手工插入
DO $seed$
BEGIN
  INSERT INTO guideline_citations (code, title, source_name, edition, chapter_ref, excerpt_text)
  SELECT 'sop-2021-ch11-ktv', '透析充分性评估（Kt/V、URR）', '《血液净化标准化操作规程》', '2021版', '第11章',
    'spKt/V 与 URR 是评估透析充分性的常用指标；临床需结合患者具体情况综合判断，本系统以 spKt/V≥1.2 且 URR≥65% 作为充分性参考目标（与系统计算逻辑一致）。'
  WHERE NOT EXISTS (SELECT 1 FROM guideline_citations WHERE code = 'sop-2021-ch11-ktv');

  INSERT INTO guideline_citations (code, title, source_name, edition, chapter_ref, excerpt_text)
  SELECT 'sop-2021-anticoag', '抗凝剂使用注意', '《血液净化标准化操作规程》', '2021版', '抗凝相关章节（摘要）',
    '血液透析抗凝方案需个体化；联合使用多种抗凝或抗栓药物时出血风险升高，须评估获益与风险，必要时调整方案。'
  WHERE NOT EXISTS (SELECT 1 FROM guideline_citations WHERE code = 'sop-2021-anticoag');

  INSERT INTO guideline_citations (code, title, source_name, edition, chapter_ref, excerpt_text)
  SELECT 'kdigo-ckd-mbd-lab', 'CKD-MBD 相关实验室指标管理思路（摘要）', 'KDIGO CKD-MBD 临床实践指南（系统引用摘要）', '摘要条目', '实验室监测',
    '钙、磷、PTH 等指标需定期监测；异常时需结合用药（如含钙磷结合剂、活性维生素D等）与透析方案综合评估，具体目标区间以本院检验参考与指南为准。'
  WHERE NOT EXISTS (SELECT 1 FROM guideline_citations WHERE code = 'kdigo-ckd-mbd-lab');

  INSERT INTO kb_documents (source_type, title, status)
  SELECT 'guideline', '血液净化标准化操作规程（院内摘要）', 'published'
  WHERE NOT EXISTS (SELECT 1 FROM kb_documents WHERE title = '血液净化标准化操作规程（院内摘要）');

  INSERT INTO kb_chunks (document_id, chunk_index, content_text, tags)
  SELECT d.id, 0,
    '透析充分性：URR 与 spKt/V 为常用指标；容量管理关注干体重与超滤；传染病筛查按规程周期复查；血管通路需定期评估。',
    'ktv urr dialysis adequacy'
  FROM kb_documents d
  WHERE d.title = '血液净化标准化操作规程（院内摘要）'
    AND NOT EXISTS (SELECT 1 FROM kb_chunks c WHERE c.document_id = d.id);

  INSERT INTO medication_rules (rule_type, severity, drug_pattern_a, drug_pattern_b, message_zh, citation_id)
  SELECT 'duplicate', 'warn', '肝素', '肝素', '检测到可能重复的抗凝相关医嘱表述，请核对是否为同一药物不同条目。',
    (SELECT id FROM guideline_citations WHERE code = 'sop-2021-anticoag' LIMIT 1)
  WHERE NOT EXISTS (SELECT 1 FROM medication_rules WHERE drug_pattern_a = '肝素' AND rule_type = 'duplicate' AND drug_pattern_b = '肝素');

  INSERT INTO medication_rules (rule_type, severity, drug_pattern_a, drug_pattern_b, message_zh, citation_id)
  SELECT 'interaction', 'warn', '华法林', '肝素', '华法林与注射抗凝联用出血风险显著增加，请确认是否有监测与剂量调整方案。',
    (SELECT id FROM guideline_citations WHERE code = 'sop-2021-anticoag' LIMIT 1)
  WHERE NOT EXISTS (SELECT 1 FROM medication_rules WHERE drug_pattern_a = '华法林' AND drug_pattern_b = '肝素');

  INSERT INTO medication_rules (rule_type, severity, drug_pattern_a, drug_pattern_b, message_zh, citation_id)
  SELECT 'interaction', 'block', '低分子肝素', '依诺肝素', '低分子肝素类药物不宜重复联用，请停用或合并为单一品种。',
    (SELECT id FROM guideline_citations WHERE code = 'sop-2021-anticoag' LIMIT 1)
  WHERE NOT EXISTS (SELECT 1 FROM medication_rules WHERE drug_pattern_a = '低分子肝素' AND drug_pattern_b = '依诺肝素');

  INSERT INTO medication_rules (rule_type, severity, drug_pattern_a, drug_pattern_b, message_zh, citation_id)
  SELECT 'contraindication', 'warn', '枸橼酸', '甲磺酸萘莫司他', '枸橼酸抗凝与萘莫司他不宜同日混用方案，请按科室协议择一（演示规则）。',
    (SELECT id FROM guideline_citations WHERE code = 'sop-2021-anticoag' LIMIT 1)
  WHERE NOT EXISTS (SELECT 1 FROM medication_rules WHERE drug_pattern_a = '枸橼酸' AND drug_pattern_b = '甲磺酸萘莫司他');
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE WARNING
      '032 种子数据未完全写入：当前用户对部分表无 INSERT 权限。请超级用户将 kb_* / guideline_citations / medication_rules 属主改为迁移用户或授予 INSERT。';
END
$seed$;
