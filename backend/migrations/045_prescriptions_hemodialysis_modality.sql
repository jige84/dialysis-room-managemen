-- 处方：血透治疗方式（HD/HDF/HD_HP）及与排班同步的备注；与患者档案「腹透/血透」概念分离
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'prescriptions' AND column_name = 'hemodialysis_modality'
  ) THEN
    ALTER TABLE prescriptions ADD COLUMN hemodialysis_modality TEXT NOT NULL DEFAULT 'HD';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'prescriptions' AND column_name = 'hemodialysis_remark'
  ) THEN
    ALTER TABLE prescriptions ADD COLUMN hemodialysis_remark TEXT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'prescriptions' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE prescriptions ADD COLUMN updated_at TIMESTAMP DEFAULT NOW();
  END IF;
END $$;

-- 本条排班默认血透方式 HD（未执行 044 时忽略）
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'schedules' AND column_name = 'session_dialysis_mode'
  ) THEN
    ALTER TABLE schedules ALTER COLUMN session_dialysis_mode SET DEFAULT 'HD';
  END IF;
END $$;
