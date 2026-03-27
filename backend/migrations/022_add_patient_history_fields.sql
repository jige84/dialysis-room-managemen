-- 022_add_patient_history_fields.sql
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS present_illness TEXT,
  ADD COLUMN IF NOT EXISTS past_history TEXT;

