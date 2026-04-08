-- 长期医嘱频次：与前端 FREQ_OPTIONS 对齐，补充 tid（tid 在 OrderAutoFill 中已支持，此前 CHECK 未包含导致无法入库或行为不一致）
DO $$
DECLARE
  cname text;
BEGIN
  SELECT con.conname INTO cname
  FROM pg_constraint con
  WHERE con.conrelid = 'long_term_orders'::regclass
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) LIKE '%frequency%'
  LIMIT 1;
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE long_term_orders DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE long_term_orders
  ADD CONSTRAINT long_term_orders_frequency_check
  CHECK (frequency IN (
    'every_session','qd','bid','tid','tiw','biw','qw','q2w','qm','custom'
  ));
