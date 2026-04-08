-- 资料库相关表权限：若 032 由超级用户执行而应用使用普通库用户连接，需显式授权。
-- 非表属主执行 GRANT 会失败，不阻断迁移（应用可能已通过属主获得权限）。
DO $kb_grants$
BEGIN
  GRANT SELECT, INSERT, UPDATE, DELETE ON kb_documents TO PUBLIC;
  GRANT SELECT, INSERT, UPDATE, DELETE ON kb_chunks TO PUBLIC;
  GRANT SELECT, INSERT, UPDATE, DELETE ON kb_usage_log TO PUBLIC;
  GRANT SELECT ON guideline_citations TO PUBLIC;
  GRANT SELECT ON medication_rules TO PUBLIC;
  GRANT EXECUTE ON FUNCTION kb_chunks_tsvector_update() TO PUBLIC;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE WARNING
      '033 GRANT 未全部执行：当前用户非表/函数属主。若应用用户已是属主或已由 DBA 授权，可忽略。';
END
$kb_grants$;
