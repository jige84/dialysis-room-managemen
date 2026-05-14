-- 透析创建时使用 ON CONFLICT(long_term_order_id, dialysis_record_id)
-- 生产库若缺少该唯一索引会导致 POST /api/dialysis 报 500。
CREATE UNIQUE INDEX IF NOT EXISTS uq_order_exec_order_record
  ON order_executions (long_term_order_id, dialysis_record_id);
