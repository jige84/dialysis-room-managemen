-- 档案约定机位（可选）；保存患者档案时同步写入该患者全部排班实例，供周视图与列表展示
ALTER TABLE patients ADD COLUMN IF NOT EXISTS machine_station VARCHAR(80);
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS machine_station VARCHAR(80);

COMMENT ON COLUMN patients.machine_station IS '约定机位/位置说明（可选），保存档案时同步至 schedules';
COMMENT ON COLUMN schedules.machine_station IS '与患者档案约定机位同步（可选）';
