-- 036_cqi_records_align.sql — 对齐 cqi_records 与路由字段；缺陷描述默认非空
ALTER TABLE cqi_records
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'ongoing'
    CHECK (status IN ('planning', 'ongoing', 'completed', 'overdue')),
  ADD COLUMN IF NOT EXISTS implementation_notes TEXT,
  ADD COLUMN IF NOT EXISTS outcome TEXT,
  ADD COLUMN IF NOT EXISTS actual_end_date DATE,
  ADD COLUMN IF NOT EXISTS summary TEXT;

CREATE INDEX IF NOT EXISTS idx_cqi_records_created_by ON cqi_records(created_by);
CREATE INDEX IF NOT EXISTS idx_cqi_records_status ON cqi_records(status);

-- 历史行：created_by 为空时可用 leader_id 回填（若存在）
UPDATE cqi_records SET created_by = leader_id WHERE created_by IS NULL AND leader_id IS NOT NULL;

ALTER TABLE defect_reports
  ALTER COLUMN description SET DEFAULT '';

UPDATE defect_reports SET description = '' WHERE description IS NULL;
