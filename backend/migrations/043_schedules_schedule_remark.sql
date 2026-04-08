-- 单条排班备注（临时调班说明等），周视图与调班弹窗展示
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'schedules' AND column_name = 'schedule_remark'
  ) THEN
    ALTER TABLE schedules ADD COLUMN schedule_remark TEXT;
  END IF;
END$$;
