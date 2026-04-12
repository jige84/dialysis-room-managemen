/**
 * 透析记录 REST 路由
 * 主要作用：透析场次与过程数据的核心 API，连接处方、医嘱与质控统计。
 * 主要功能：透析记录 CRUD；护士录入日期限制；自动带入医嘱；Kt/V 与相关医疗计算。
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const auth = require('../middleware/auth');
const { rbac } = require('../middleware/rbac');
const auditLog = require('../middleware/audit');
const restrictNurseEditTime = require('../middleware/nurseTimeRestriction');
const KtvCalc = require('../services/KtvCalculator');
const OrderAutoFill = require('../services/OrderAutoFill');
const AlertEngine = require('../services/AlertEngine');
const ConsumableStockService = require('../services/ConsumableStockService');
const { success, created, paginated, error, notFound } = require('../utils/response');
const { formatDate, getMonthRange } = require('../utils/dateUtils');

/**
 * 低血压：收缩压 < 90，或较基线下降 > 20 mmHg（medical-domain-rules §5）
 * @param {number|undefined|null} systolicBp
 * @param {number|undefined|null} baselineSbp 本次透析第一条有效收缩压
 */
function isHypotensionFlag(systolicBp, baselineSbp) {
  if (typeof systolicBp !== 'number') return false;
  if (systolicBp < 90) return true;
  if (typeof baselineSbp === 'number' && baselineSbp - systolicBp > 20) return true;
  return false;
}

// GET /api/dialysis/prepare?patientId=xxx&date=xxx
router.get('/prepare', auth, async (req, res, next) => {
  try {
    const { patientId, date } = req.query;
    if (!patientId) return error(res, '请提供 patientId 参数');

    const data = await OrderAutoFill.prepareForDialysis(patientId, date, {
      orderTypes: ['dialysis_drug'],
    });
    return success(res, data, '透析准备数据加载成功');
  } catch (err) { next(err); }
});

// GET /api/dialysis/stats/daily?date=xxx
router.get('/stats/daily', auth, async (req, res, next) => {
  try {
    const { date } = req.query;
    const targetDate = date || formatDate(new Date());

    const { rows } = await pool.query(`
      SELECT
        COUNT(*) as total_sessions,
        COUNT(*) FILTER (WHERE is_avf_session = true) as avf_sessions,
        COUNT(*) FILTER (WHERE shift = 'morning')     as morning_sessions,
        COUNT(*) FILTER (WHERE shift = 'afternoon')   as afternoon_sessions,
        COUNT(*) FILTER (WHERE shift = 'evening')     as evening_sessions,
        COUNT(DISTINCT nurse_id)                      as nurse_count,
        AVG(ktv) FILTER (WHERE ktv IS NOT NULL)       as avg_ktv,
        COUNT(*) FILTER (WHERE is_circuit_clotted = true) as clotted_count,
        COUNT(*) FILTER (WHERE is_membrane_ruptured = true) as membrane_ruptured_count
      FROM dialysis_records WHERE session_date = $1
    `, [targetDate]);

    return success(res, rows[0]);
  } catch (err) { next(err); }
});

// GET /api/dialysis/stats/monthly?year=2026&month=3
router.get('/stats/monthly', auth, async (req, res, next) => {
  try {
    const { year, month } = req.query;
    if (!year || !month) return error(res, '请提供 year 和 month 参数');

    const { startDate, endDate } = getMonthRange(Number(year), Number(month));

    const { rows } = await pool.query(`
      SELECT
        COUNT(*) as total_sessions,
        COUNT(*) FILTER (WHERE is_avf_session = true)     as avf_sessions,
        COUNT(DISTINCT nurse_id)                          as nurse_count,
        COUNT(*) FILTER (WHERE is_circuit_clotted = true) as circuit_clotted_count,
        COUNT(*) FILTER (WHERE is_membrane_ruptured = true) as membrane_rupture_count,
        COUNT(*) FILTER (WHERE coagulation_grade >= 2)    as high_grade_clot_count,
        AVG(ktv) FILTER (WHERE ktv IS NOT NULL)           as avg_ktv,
        COUNT(*) FILTER (WHERE ktv >= 1.2)                as ktv_qualified_count,
        COUNT(*) FILTER (WHERE ktv IS NOT NULL)           as ktv_measured_count,
        COUNT(*) FILTER (WHERE puncture_result = 'difficult') as puncture_difficult_count,
        COUNT(*) FILTER (WHERE puncture_method = 'buttonhole') as buttonhole_count,
        COUNT(*) FILTER (WHERE puncture_method = 'rope_ladder') as rope_ladder_count,
        COUNT(*) FILTER (WHERE puncture_method = 'area')   as area_count
      FROM dialysis_records
      WHERE session_date BETWEEN $1 AND $2
    `, [startDate, endDate]);

    const { rows: compRows } = await pool.query(`
      SELECT comp_type, COUNT(*) as count
      FROM complications
      WHERE occurred_at BETWEEN $1 AND $2
      GROUP BY comp_type ORDER BY count DESC
    `, [startDate + ' 00:00:00', endDate + ' 23:59:59']);

    const injuryCount = compRows.find(r => r.comp_type === 'avf_injury')?.count || 0;

    return success(res, {
      ...rows[0],
      avf_puncture_injury_count: parseInt(injuryCount),
      complications_by_type: compRows,
    });
  } catch (err) { next(err); }
});

// GET /api/dialysis/stats/ktv-trend/:patientId
router.get('/stats/ktv-trend/:patientId', auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT session_date, ktv, urr, uf_volume, uf_pct_of_dry_weight, actual_duration
       FROM dialysis_records
       WHERE patient_id = $1 AND ktv IS NOT NULL
       ORDER BY session_date DESC LIMIT 30`,
      [req.params.patientId]
    );
    return success(res, rows.reverse());
  } catch (err) { next(err); }
});

// GET /api/dialysis
router.get('/', auth, async (req, res, next) => {
  try {
    const { page = 1, page_size = 20, patient_id, start_date, end_date, shift } = req.query;
    const offset = (page - 1) * page_size;

    const conditions = [];
    const params = [];
    let idx = 1;

    if (patient_id) { conditions.push(`dr.patient_id = $${idx++}`); params.push(patient_id); }
    if (start_date) { conditions.push(`dr.session_date >= $${idx++}`); params.push(start_date); }
    if (end_date)   { conditions.push(`dr.session_date <= $${idx++}`); params.push(end_date); }
    if (shift)      { conditions.push(`dr.shift = $${idx++}`); params.push(shift); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const countRes = await pool.query(`SELECT COUNT(*) FROM dialysis_records dr ${where}`, params);
    const total = parseInt(countRes.rows[0].count);

    const { rows } = await pool.query(
      `SELECT dr.id, dr.session_date, dr.shift, dr.pre_weight, dr.post_weight,
              dr.uf_volume, dr.uf_pct_of_dry_weight, dr.actual_duration, dr.ktv, dr.urr,
              dr.coagulation_grade, dr.is_circuit_clotted, dr.is_membrane_ruptured,
              dr.is_avf_session, dr.puncture_result, dr.puncture_method,
              p.name as patient_name, u.real_name as nurse_name
       FROM dialysis_records dr
       JOIN patients p ON dr.patient_id = p.id
       JOIN users u ON dr.nurse_id = u.id
       ${where}
       ORDER BY dr.session_date DESC, dr.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, page_size, offset]
    );

    return paginated(res, rows, total, page, page_size);
  } catch (err) { next(err); }
});

// GET /api/dialysis/:id
router.get('/:id', auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT dr.*, p.name as patient_name, p.dob,
              u.real_name as nurse_name, u2.real_name as double_check_nurse_name,
              m.machine_no
       FROM dialysis_records dr
       JOIN patients p ON dr.patient_id = p.id
       JOIN users u ON dr.nurse_id = u.id
       LEFT JOIN users u2 ON dr.double_check_nurse_id = u2.id
       LEFT JOIN machines m ON dr.machine_id = m.id
       WHERE dr.id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return notFound(res, '透析记录不存在');

    const record = rows[0];

    const { rows: vitals } = await pool.query(
      `SELECT * FROM vital_signs WHERE dialysis_record_id = $1 ORDER BY sequence_no`,
      [req.params.id]
    );
    record.vital_signs = vitals;

    const { rows: comps } = await pool.query(
      `SELECT c.*, u.real_name as recorded_by_name
       FROM complications c LEFT JOIN users u ON c.recorded_by = u.id
       WHERE c.dialysis_record_id = $1 ORDER BY c.occurred_at`,
      [req.params.id]
    );
    record.complications = comps;

    const { rows: execs } = await pool.query(
      `SELECT oe.*, lto.drug_name, lto.dose, lto.route, lto.order_type,
              u.real_name as executed_by_name
       FROM order_executions oe
       JOIN long_term_orders lto ON oe.long_term_order_id = lto.id
       JOIN users u ON oe.executed_by = u.id
       WHERE oe.dialysis_record_id = $1 ORDER BY lto.order_type`,
      [req.params.id]
    );
    record.order_executions = execs;

    return success(res, record);
  } catch (err) { next(err); }
});

// POST /api/dialysis
// dialysis:create 权限：admin, nurse, head_nurse
// 护士只能录入当班日期（restrictNurseEditTime）
// 新入患者需先完成传染病初筛（规程第3章）
router.post('/',
  auth,
  rbac(['admin','nurse','head_nurse']),
  restrictNurseEditTime,
  auditLog('dialysis_records', 'CREATE'),
  async (req, res, next) => {
    try {
      const {
        patient_id, prescription_id, machine_id,
        session_date, shift, double_check_nurse_id,
        pre_weight, post_weight,
        actual_duration, start_time, end_time,
        blood_flow_rate, dialysate_flow_rate, dialysate_temp,
        dialysate_ca, dialysate_k, dialysate_na,
        heparin_prime_dose, heparin_maintain,
        puncture_result, puncture_site, puncture_method,
        is_avf_session, coagulation_grade, blood_return_method,
        pre_bun, post_bun,
        notes,
        // 批量子记录（可在创建透析记录时一并提交）
        vital_signs = [],     // VitalSign[]
        complications = [],   // { comp_type, occurred_at?, notes?, detail? }[]
        order_executions = [] // { long_term_order_id, status, actual_dose?, notes? }[]
      } = req.body;

      if (!patient_id || !session_date || !shift) {
        return error(res, '患者、透析日期、班次为必填项');
      }

      // 传染病初筛完整性校验：仅「新入患者」（尚无任意透析记录）时强制 4 项齐全
      const { rows: priorDialysis } = await pool.query(
        'SELECT COUNT(*)::int AS c FROM dialysis_records WHERE patient_id = $1',
        [patient_id],
      );
      const priorDialysisCount = priorDialysis[0]?.c ?? 0;
      if (priorDialysisCount === 0) {
        const REQUIRED_SCREENS = ['hbsag', 'hcvab', 'hiv', 'syphilis_tppa'];
        const { rows: screenRows } = await pool.query(
          `SELECT DISTINCT test_type FROM infection_screenings
           WHERE patient_id = $1 AND test_type = ANY($2)`,
          [patient_id, REQUIRED_SCREENS],
        );
        const completedScreens = screenRows.map(r => r.test_type);
        const missingScreens = REQUIRED_SCREENS.filter(s => !completedScreens.includes(s));
        if (missingScreens.length > 0) {
          return error(
            res,
            `患者传染病初筛未完成，缺少：${missingScreens.join('、').toUpperCase()}，请先完成筛查后再创建透析记录`,
            422,
          );
        }
      }

      // 自动计算超滤量和 Kt/V
      const dryWeight = req.body.dry_weight;
      const ufVolume = pre_weight && post_weight
        ? KtvCalc.calcUFVolume(pre_weight, post_weight)
        : null;
      const ufPct = ufVolume && dryWeight
        ? KtvCalc.calcUFPercent(ufVolume, dryWeight)
        : null;

      const ktvResult = pre_bun && post_bun && post_weight && actual_duration
        ? KtvCalc.calculate({
            preBUN: pre_bun,
            postBUN: post_bun,
            ufVolumeMl: ufVolume,
            postWeightKg: post_weight,
            durationHours: actual_duration / 60,
          })
        : { ktv: null, urr: null };

      // 3级凝血 → is_circuit_clotted = true
      const isCircuitClotted = coagulation_grade === 3;
      const isMembraneRuptured = req.body.is_membrane_ruptured || false;

      const client = await pool.connect();
      let savedRow;
      try {
        await client.query('BEGIN');

        const { rows } = await client.query(
          `INSERT INTO dialysis_records (
             patient_id, prescription_id, machine_id,
             session_date, shift, nurse_id, double_check_nurse_id,
             pre_weight, post_weight, uf_volume, uf_pct_of_dry_weight,
             actual_duration, start_time, end_time,
             blood_flow_rate, dialysate_flow_rate, dialysate_temp,
             dialysate_ca, dialysate_k, dialysate_na,
             heparin_prime_dose, heparin_maintain,
             puncture_result, puncture_site, puncture_method,
             is_avf_session, coagulation_grade, is_circuit_clotted, is_membrane_ruptured,
             blood_return_method,
             pre_bun, post_bun, ktv, urr,
             notes
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
             $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35
           ) RETURNING id, session_date, shift, ktv, urr, uf_volume`,
          [
            patient_id, prescription_id || null, machine_id || null,
            session_date, shift, req.user.id, double_check_nurse_id || null,
            pre_weight || null, post_weight || null, ufVolume, ufPct,
            actual_duration || null, start_time || null, end_time || null,
            blood_flow_rate || null, dialysate_flow_rate || null, dialysate_temp || null,
            dialysate_ca || null, dialysate_k || null, dialysate_na || null,
            heparin_prime_dose || null, heparin_maintain || null,
            puncture_result || null, puncture_site || null, puncture_method || null,
            is_avf_session !== undefined ? is_avf_session : true,
            coagulation_grade || 0, isCircuitClotted, isMembraneRuptured,
            blood_return_method || 'closed',
            pre_bun || null, post_bun || null, ktvResult.ktv, ktvResult.urr,
            notes || null
          ]
        );
        savedRow = rows[0];

        // 批量写入生命体征（规程要求：每50分钟一次，上机即刻+每小时+下机前）
        // 基线收缩压：本次请求 vital_signs 中第一条有效 systolic_bp
        let baselineSbp = null;
        for (const vs0 of vital_signs) {
          if (typeof vs0.systolic_bp === 'number') {
            baselineSbp = vs0.systolic_bp;
            break;
          }
        }
        for (let i = 0; i < vital_signs.length; i++) {
          const vs = vital_signs[i];
          const isHypotension = isHypotensionFlag(vs.systolic_bp, baselineSbp);
          const isHypertension = typeof vs.systolic_bp === 'number' && vs.systolic_bp > 200;
          await client.query(
            `INSERT INTO vital_signs (
               dialysis_record_id, patient_id, record_time, time_label, sequence_no,
               systolic_bp, diastolic_bp, heart_rate, arterial_pressure, venous_pressure,
               tmp, body_temp, is_hypotension, is_hypertension, notes, recorded_by
             )
             SELECT $1, patient_id, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
             FROM dialysis_records WHERE id = $1`,
            [
              savedRow.id,
              vs.record_time || new Date().toISOString(),
              vs.time_label || `第${i + 1}次`,
              vs.sequence_no || (i + 1),
              vs.systolic_bp || null, vs.diastolic_bp || null, vs.heart_rate || null,
              vs.arterial_pressure || null, vs.venous_pressure || null,
              vs.tmp || null, vs.body_temp || null,
              isHypotension, isHypertension,
              vs.notes || null, req.user.id,
            ]
          );
        }

        // 批量写入并发症（漏血/溶血/空气栓塞等需实时预警）
        const emergencyCompTypes = ['blood_leak', 'hemolysis', 'air_embolism'];
        for (const comp of complications) {
          const isEmergency = emergencyCompTypes.includes(comp.comp_type);
          await client.query(
            `INSERT INTO complications (dialysis_record_id, patient_id, comp_type, occurred_at, notes, detail, is_emergency, recorded_by)
             SELECT $1, patient_id, $2, $3, $4, $5, $6, $7
             FROM dialysis_records WHERE id = $1`,
            [
              savedRow.id,
              comp.comp_type,
              comp.occurred_at || new Date().toISOString(),
              comp.notes || null,
              comp.detail ? JSON.stringify(comp.detail) : null,
              isEmergency,
              req.user.id,
            ]
          );
          // 漏血自动标记 is_membrane_ruptured（质控指标三分子）
          if (comp.comp_type === 'blood_leak') {
            await client.query(
              `UPDATE dialysis_records SET is_membrane_ruptured = true WHERE id = $1`,
              [savedRow.id]
            );
          }
        }

        // 批量写入长期医嘱执行记录
        for (const exec of order_executions) {
          if (!exec.long_term_order_id) continue;
          await client.query(
            `INSERT INTO order_executions (long_term_order_id, dialysis_record_id, patient_id, execution_date, executed_by, status, actual_dose, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (long_term_order_id, dialysis_record_id) DO UPDATE
               SET status = EXCLUDED.status, actual_dose = EXCLUDED.actual_dose, notes = EXCLUDED.notes`,
            [
              exec.long_term_order_id, savedRow.id, patient_id,
              session_date, req.user.id,
              exec.status || 'executed',
              exec.actual_dose || null,
              exec.notes || null,
            ]
          );
        }

        await ConsumableStockService.consumeForDialysis(client, {
          dialysisRecordId: savedRow.id,
          patientId: patient_id,
          prescriptionId: prescription_id || null,
          sessionDate: session_date,
          operatedBy: req.user.id,
        });

        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }

      // ufPct 由 calcUFPercent 返回百分比值（如 5.3 表示 5.3%）
      // 超滤量超过干体重5% → 触发 HIGH 级预警（medical-domain-rules §5）
      if (ufPct !== null && ufPct > 5) {
        AlertEngine.checkUltrafiltrationAlert(patient_id, ufVolume, dryWeight, ufPct).catch(() => {});
      }

      return created(res, savedRow, '透析记录创建成功');
    } catch (err) { next(err); }
  }
);

// POST /api/dialysis/:id/vitals - 录入生命体征（实时单条追加）
router.post('/:id/vitals',
  auth,
  rbac(['admin', 'nurse', 'head_nurse']),
  restrictNurseEditTime,
  auditLog('vital_signs', 'CREATE'),
  async (req, res, next) => {
    try {
      const { record_time, time_label, sequence_no, systolic_bp, diastolic_bp,
              heart_rate, arterial_pressure, venous_pressure, tmp, body_temp, notes } = req.body;

      const { rows: baselineRows } = await pool.query(
        `SELECT systolic_bp FROM vital_signs
         WHERE dialysis_record_id = $1 AND systolic_bp IS NOT NULL
         ORDER BY sequence_no ASC, record_time ASC
         LIMIT 1`,
        [req.params.id],
      );
      const baselineSbp = baselineRows[0]?.systolic_bp ?? null;

      const isHypotension = isHypotensionFlag(systolic_bp, baselineSbp);
      const isHypertension = typeof systolic_bp === 'number' && systolic_bp > 200;

      const { rows } = await pool.query(
        `INSERT INTO vital_signs (
           dialysis_record_id, patient_id, record_time, time_label, sequence_no,
           systolic_bp, diastolic_bp, heart_rate, arterial_pressure, venous_pressure,
           tmp, body_temp, is_hypotension, is_hypertension, notes, recorded_by
         )
         SELECT $1, patient_id, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
         FROM dialysis_records WHERE id = $1
         RETURNING id, sequence_no, record_time, systolic_bp, diastolic_bp, is_hypotension`,
        [
          req.params.id, record_time || new Date().toISOString(), time_label, sequence_no || 1,
          systolic_bp || null, diastolic_bp || null, heart_rate || null,
          arterial_pressure || null, venous_pressure || null,
          tmp || null, body_temp || null,
          isHypotension, isHypertension, notes || null, req.user.id,
        ]
      );

      return created(res, rows[0], '生命体征记录成功');
    } catch (err) { next(err); }
  }
);

// PATCH /api/dialysis/:id/note - 护士仅可在当班日期添加备注（不可修改其他字段）
router.patch('/:id/note',
  auth,
  rbac(['admin', 'nurse', 'head_nurse']),
  restrictNurseEditTime,
  auditLog('dialysis_records', 'UPDATE'),
  async (req, res, next) => {
    try {
      const { note } = req.body;
      if (!note || typeof note !== 'string' || !note.trim()) {
        return error(res, '备注内容不能为空', 400);
      }

      // 护士只能追加备注，不覆盖原有备注
      const { rows } = await pool.query(
        `UPDATE dialysis_records
         SET notes = CASE
           WHEN notes IS NULL OR notes = '' THEN $1
           ELSE notes || E'\n[补充] ' || $1
         END,
         updated_at = NOW()
         WHERE id = $2
         RETURNING id, notes, session_date`,
        [note.trim(), req.params.id]
      );
      if (rows.length === 0) return notFound(res, '透析记录不存在');
      return success(res, rows[0], '备注已追加');
    } catch (err) { next(err); }
  }
);

module.exports = router;
