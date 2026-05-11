-- 患者常用透析耗材表单记忆（处方工作台下拉 UUID / legacy 串）；保存处方时由服务端同步更新

ALTER TABLE patients ADD COLUMN IF NOT EXISTS profile_dialyzer_selection VARCHAR(200);
ALTER TABLE patients ADD COLUMN IF NOT EXISTS profile_hemoperfusion_selection VARCHAR(200);

COMMENT ON COLUMN patients.profile_dialyzer_selection IS '最近确认的透析器选择（与前端处方表单 dialyzer 同源）';
COMMENT ON COLUMN patients.profile_hemoperfusion_selection IS 'HD+HP 灌流器选择（与前端处方表单 hpCartridge 同源）';
