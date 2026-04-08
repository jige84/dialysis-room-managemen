-- HDF（血液透析滤过）：置换方式与置换液量（L）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'prescriptions' AND column_name = 'hdf_replacement_mode'
  ) THEN
    ALTER TABLE prescriptions ADD COLUMN hdf_replacement_mode TEXT
      CHECK (hdf_replacement_mode IS NULL OR hdf_replacement_mode IN ('pre', 'post', 'both'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'prescriptions' AND column_name = 'hdf_replacement_volume_l'
  ) THEN
    ALTER TABLE prescriptions ADD COLUMN hdf_replacement_volume_l NUMERIC(6, 2);
  END IF;
END $$;
