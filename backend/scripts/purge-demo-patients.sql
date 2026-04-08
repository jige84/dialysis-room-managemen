-- =============================================================================
-- 删除「透析录入 / 处方工作台」内置演示患者及其关联业务数据
-- 对应前端常量：frontend/src/constants/dialysisDemoPatients.ts
--   张国华、赵丽萍、刘明远
--
-- 不删除：种子登录账号（users 表中 renjige / doctor01 等）、耗材目录、知识库规则等
--
-- 执行前：
--   1. 备份数据库。
--   2. 若演示患者姓名与库中不一致，请修改下方 IN 列表。
--   3. 建议先单独运行「预览」段，确认 id 与姓名无误后再执行删除段。
-- =============================================================================

-- ----- 预览（只读，可单独执行） -----
SELECT id, name, gender, dialysis_start_date, created_at
FROM patients
WHERE name IN ('张国华', '赵丽萍', '刘明远')
ORDER BY name;

-- ----- 以下为删除（请在确认预览结果后，与上方预览一起或分开执行） -----
BEGIN;

CREATE TEMP TABLE _purge_demo_patient_ids ON COMMIT DROP AS
SELECT id FROM patients WHERE name IN ('张国华', '赵丽萍', '刘明远');

DO $$
DECLARE
  n int;
BEGIN
  SELECT COUNT(*)::int INTO n FROM _purge_demo_patient_ids;
  IF n = 0 THEN
    RAISE NOTICE '未匹配到任何演示患者姓名，未做删除。';
  ELSE
    RAISE NOTICE '将删除 % 名患者及其关联数据（演示姓名列表）。', n;
  END IF;
END $$;

-- 缺陷上报：从数组字段中移除即将删除的患者 id
UPDATE defect_reports d
SET involved_patient_ids = COALESCE((
  SELECT array_agg(elem)
  FROM unnest(COALESCE(d.involved_patient_ids, ARRAY[]::uuid[])) AS elem
  WHERE NOT EXISTS (
    SELECT 1 FROM _purge_demo_patient_ids p WHERE p.id = elem
  )
), ARRAY[]::uuid[])
WHERE d.involved_patient_ids IS NOT NULL
  AND d.involved_patient_ids && (SELECT array_agg(id) FROM _purge_demo_patient_ids);

DELETE FROM alerts
WHERE patient_id IN (SELECT id FROM _purge_demo_patient_ids);

DELETE FROM order_executions
WHERE patient_id IN (SELECT id FROM _purge_demo_patient_ids);

DELETE FROM consumables
WHERE patient_id IN (SELECT id FROM _purge_demo_patient_ids);

DELETE FROM dialysis_records
WHERE patient_id IN (SELECT id FROM _purge_demo_patient_ids);

-- 组合用药子医嘱先删（parent_order_id 指向同表）
DELETE FROM long_term_orders
WHERE patient_id IN (SELECT id FROM _purge_demo_patient_ids)
  AND parent_order_id IS NOT NULL;

DELETE FROM long_term_orders
WHERE patient_id IN (SELECT id FROM _purge_demo_patient_ids);

DELETE FROM prescriptions
WHERE patient_id IN (SELECT id FROM _purge_demo_patient_ids);

DELETE FROM patient_schedule_rules
WHERE patient_id IN (SELECT id FROM _purge_demo_patient_ids);

DELETE FROM schedules
WHERE patient_id IN (SELECT id FROM _purge_demo_patient_ids);

DELETE FROM lab_results
WHERE patient_id IN (SELECT id FROM _purge_demo_patient_ids);

DELETE FROM infection_screenings
WHERE patient_id IN (SELECT id FROM _purge_demo_patient_ids);

DELETE FROM infection_monitoring
WHERE patient_id IN (SELECT id FROM _purge_demo_patient_ids);

DELETE FROM cvc_risk_assessments
WHERE patient_id IN (SELECT id FROM _purge_demo_patient_ids);

DELETE FROM vascular_punctures
WHERE patient_id IN (SELECT id FROM _purge_demo_patient_ids);

DELETE FROM thrombolysis_records
WHERE patient_id IN (SELECT id FROM _purge_demo_patient_ids);

DELETE FROM vascular_avf_assessments
WHERE patient_id IN (SELECT id FROM _purge_demo_patient_ids);

DELETE FROM vascular_cvc_assessments
WHERE patient_id IN (SELECT id FROM _purge_demo_patient_ids);

DELETE FROM vascular_accesses
WHERE patient_id IN (SELECT id FROM _purge_demo_patient_ids);

DELETE FROM patients
WHERE id IN (SELECT id FROM _purge_demo_patient_ids);

COMMIT;
