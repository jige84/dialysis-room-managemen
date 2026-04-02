-- 026_create_schedule_rules_and_nurse_schedule.sql
-- 患者长期排班规则 + 护士排班表 + 班次护患比视图

-- 患者排班规则表：抽象"模式"，不直接存每天的实例
CREATE TABLE IF NOT EXISTS patient_schedule_rules (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id         UUID NOT NULL REFERENCES patients(id),
  pattern_type       VARCHAR(20) NOT NULL CHECK (pattern_type IN ('weekly_3x','biweekly_5x','ad_hoc')),
  week_type          VARCHAR(10) NOT NULL DEFAULT 'both' CHECK (week_type IN ('both','week1','week2')),
  -- 一周中哪些天透析：使用英文缩写，方便前后端统一（mon~sun）
  days               TEXT[] NOT NULL,
  shift              VARCHAR(10) NOT NULL CHECK (shift IN ('morning','afternoon','evening')),
  start_date         DATE NOT NULL,
  end_date           DATE,
  preferred_machine_id UUID REFERENCES machines(id),
  is_active          BOOLEAN NOT NULL DEFAULT true,
  notes              TEXT,
  created_at         TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patient_schedule_rules_patient
  ON patient_schedule_rules(patient_id, is_active, start_date);

-- 护士排班表：按天/班次安排当班护士
CREATE TABLE IF NOT EXISTS nurse_schedule (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nurse_id   UUID NOT NULL REFERENCES users(id),
  duty_date  DATE NOT NULL,
  shift      VARCHAR(10) NOT NULL CHECK (shift IN ('morning','afternoon','evening')),
  zone       VARCHAR(20) CHECK (zone IN ('normal','hbv','hcv')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (nurse_id, duty_date, shift, zone)
);

CREATE INDEX IF NOT EXISTS idx_nurse_schedule_date_shift
  ON nurse_schedule(duty_date, shift);

-- 为现有 schedules 表增加与排班规则相关的字段（若已存在则忽略错误）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'schedules' AND column_name = 'status'
  ) THEN
    ALTER TABLE schedules
      ADD COLUMN status VARCHAR(20) DEFAULT 'planned'
        CHECK (status IN ('planned','cancelled','completed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'schedules' AND column_name = 'is_temp'
  ) THEN
    ALTER TABLE schedules
      ADD COLUMN is_temp BOOLEAN DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'schedules' AND column_name = 'source_rule_id'
  ) THEN
    ALTER TABLE schedules
      ADD COLUMN source_rule_id UUID REFERENCES patient_schedule_rules(id);
  END IF;
END$$;

-- 班次护患比视图：按天/班次统计患者数与护士数
CREATE OR REPLACE VIEW vw_shift_staffing AS
SELECT
  s.scheduled_date      AS duty_date,
  s.shift,
  COUNT(DISTINCT s.patient_id)                       AS patient_count,
  COALESCE((
    SELECT COUNT(DISTINCT n.nurse_id)
    FROM nurse_schedule n
    WHERE n.duty_date = s.scheduled_date AND n.shift = s.shift
  ), 0)                                              AS nurse_count,
  CASE
    WHEN COALESCE((
      SELECT COUNT(DISTINCT n2.nurse_id)
      FROM nurse_schedule n2
      WHERE n2.duty_date = s.scheduled_date AND n2.shift = s.shift
    ), 0) = 0
    THEN NULL
    ELSE ROUND(
      COUNT(DISTINCT s.patient_id)::numeric
      / NULLIF((
        SELECT COUNT(DISTINCT n3.nurse_id)
        FROM nurse_schedule n3
        WHERE n3.duty_date = s.scheduled_date AND n3.shift = s.shift
      ), 0)
    , 2)
  END                                                AS ratio_value,
  CASE
    WHEN COALESCE((
      SELECT COUNT(DISTINCT n4.nurse_id)
      FROM nurse_schedule n4
      WHERE n4.duty_date = s.scheduled_date AND n4.shift = s.shift
    ), 0) = 0
    THEN false
    ELSE (COUNT(DISTINCT s.patient_id)::numeric
          / NULLIF((
            SELECT COUNT(DISTINCT n5.nurse_id)
            FROM nurse_schedule n5
            WHERE n5.duty_date = s.scheduled_date AND n5.shift = s.shift
          ), 0)
         ) <= 5.0
  END                                                AS compliant
FROM schedules s
GROUP BY s.scheduled_date, s.shift;

