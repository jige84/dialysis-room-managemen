-- 054_nurse_schedule_sheet.sql
-- 护士长手工填写的「血透护士排班空白表」按周持久化（与患者机位排班 schedules 独立）

CREATE TABLE IF NOT EXISTS nurse_schedule_sheet (
  week_start_date DATE NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{"rows":[]}'::jsonb,
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_by      UUID REFERENCES users(id),
  PRIMARY KEY (week_start_date)
);

COMMENT ON TABLE nurse_schedule_sheet IS '血透护士排班空白表：week_start_date 为本周起始日，payload.rows 为 14 行×姓名/七日/欠休';
CREATE INDEX IF NOT EXISTS idx_nurse_schedule_sheet_updated ON nurse_schedule_sheet (updated_at DESC);
