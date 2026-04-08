-- 本条排班透析方式（覆盖患者档案）：HD / HDF / HD_HP；空表示沿用档案 dialysis_mode
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'schedules' AND column_name = 'session_dialysis_mode'
  ) THEN
    ALTER TABLE schedules ADD COLUMN session_dialysis_mode TEXT;
  END IF;
END $$;
