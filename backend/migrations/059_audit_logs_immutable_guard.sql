-- 059_audit_logs_immutable_guard.sql
-- 目标：
-- 1) 审计日志表 audit_logs 只允许追加写入（append-only）
-- 2) 收敛公共权限，避免通过 PUBLIC 获得不必要访问能力

CREATE OR REPLACE FUNCTION public.block_audit_logs_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = format('audit_logs is append-only; %s is not allowed', TG_OP);
END;
$$;

DO $audit_guard$
BEGIN
  IF to_regclass('public.audit_logs') IS NULL THEN
    RAISE WARNING '059 skipped: public.audit_logs does not exist';
  ELSE
    -- 触发器：禁止 UPDATE / DELETE
    EXECUTE 'DROP TRIGGER IF EXISTS trg_audit_logs_block_update_delete ON public.audit_logs';
    EXECUTE '
      CREATE TRIGGER trg_audit_logs_block_update_delete
      BEFORE UPDATE OR DELETE ON public.audit_logs
      FOR EACH ROW
      EXECUTE FUNCTION public.block_audit_logs_mutation()
    ';

    -- 触发器：禁止 TRUNCATE
    EXECUTE 'DROP TRIGGER IF EXISTS trg_audit_logs_block_truncate ON public.audit_logs';
    EXECUTE '
      CREATE TRIGGER trg_audit_logs_block_truncate
      BEFORE TRUNCATE ON public.audit_logs
      FOR EACH STATEMENT
      EXECUTE FUNCTION public.block_audit_logs_mutation()
    ';

    -- 强制触发器在复制角色下仍生效（除非超级用户显式变更）
    EXECUTE 'ALTER TABLE public.audit_logs ENABLE ALWAYS TRIGGER trg_audit_logs_block_update_delete';
    EXECUTE 'ALTER TABLE public.audit_logs ENABLE ALWAYS TRIGGER trg_audit_logs_block_truncate';

    -- 权限收敛：移除 PUBLIC 的默认权限暴露
    EXECUTE 'REVOKE ALL ON TABLE public.audit_logs FROM PUBLIC';
  END IF;
END
$audit_guard$;

