/**
 * 科室月度内部质控指标（规程/需求 3.8.2 可计算子集）
 * 仅聚合查询，不落库；阈值与 labs 路由 LAB_TARGETS 一致。
 */
const { pool } = require('../config/database');
const { getMonthRange } = require('../utils/dateUtils');

/** @param {number} year @param {number} month */
function monthRange(year, month) {
  return getMonthRange(year, month);
}

function buildMetric({ label, key, definition, target, numerator, denominator }) {
  const rate = denominator > 0 ? numerator / denominator : null;
  return {
    key,
    label,
    definition,
    target,
    numerator,
    denominator,
    rate,
    rate_percent: rate !== null ? Math.round(rate * 100000) / 1000 : null,
    compliant: null,
  };
}

async function fetchKtvUrrRates(startDate, endDate) {
  const { rows: [ktv] } = await pool.query(
    `WITH latest_in_month AS (
       SELECT DISTINCT ON (dr.patient_id)
         dr.patient_id,
         dr.ktv
       FROM dialysis_records dr
       WHERE dr.session_date BETWEEN $1 AND $2
         AND dr.ktv IS NOT NULL
       ORDER BY dr.patient_id, dr.session_date DESC
     )
     SELECT
       COUNT(*)::int AS denom,
       COUNT(*) FILTER (WHERE ktv >= 1.2)::int AS numer
     FROM latest_in_month`,
    [startDate, endDate],
  );
  const { rows: [urr] } = await pool.query(
    `WITH latest_in_month AS (
       SELECT DISTINCT ON (dr.patient_id)
         dr.patient_id,
         dr.urr
       FROM dialysis_records dr
       WHERE dr.session_date BETWEEN $1 AND $2
         AND dr.urr IS NOT NULL
       ORDER BY dr.patient_id, dr.session_date DESC
     )
     SELECT
       COUNT(*)::int AS denom,
       COUNT(*) FILTER (WHERE urr >= 65)::int AS numer
     FROM latest_in_month`,
    [startDate, endDate],
  );
  return { ktv, urr };
}

async function fetchLabRateGte(startDate, endDate, testType, threshold) {
  const { rows: [row] } = await pool.query(
    `WITH month_pts AS (
       SELECT DISTINCT patient_id FROM dialysis_records
       WHERE session_date BETWEEN $1 AND $2
     ),
     latest_lab AS (
       SELECT DISTINCT ON (lr.patient_id)
         lr.patient_id,
         lr.value
       FROM lab_results lr
       INNER JOIN month_pts mp ON mp.patient_id = lr.patient_id
       WHERE lr.test_type = $3
         AND lr.test_date <= $2::date
       ORDER BY lr.patient_id, lr.test_date DESC
     )
     SELECT
       COUNT(*)::int AS denom,
       COUNT(*) FILTER (WHERE value >= $4::numeric)::int AS numer
     FROM latest_lab`,
    [startDate, endDate, testType, threshold],
  );
  return row;
}

async function fetchMbdTriple(startDate, endDate) {
  const { rows: [row] } = await pool.query(
    `WITH month_pts AS (
       SELECT DISTINCT patient_id FROM dialysis_records
       WHERE session_date BETWEEN $1 AND $2
     ),
     lca AS (
       SELECT DISTINCT ON (lr.patient_id)
         lr.patient_id, lr.value AS ca
       FROM lab_results lr
       INNER JOIN month_pts mp ON mp.patient_id = lr.patient_id
       WHERE lr.test_type = 'ca' AND lr.test_date <= $2::date
       ORDER BY lr.patient_id, lr.test_date DESC
     ),
     lp AS (
       SELECT DISTINCT ON (lr.patient_id)
         lr.patient_id, lr.value AS p
       FROM lab_results lr
       INNER JOIN month_pts mp ON mp.patient_id = lr.patient_id
       WHERE lr.test_type = 'p' AND lr.test_date <= $2::date
       ORDER BY lr.patient_id, lr.test_date DESC
     ),
     lith AS (
       SELECT DISTINCT ON (lr.patient_id)
         lr.patient_id, lr.value AS ipth
       FROM lab_results lr
       INNER JOIN month_pts mp ON mp.patient_id = lr.patient_id
       WHERE lr.test_type = 'ipth' AND lr.test_date <= $2::date
       ORDER BY lr.patient_id, lr.test_date DESC
     )
     SELECT
       COUNT(*)::int AS denom,
       COUNT(*) FILTER (WHERE
         lca.ca >= 2.10 AND lca.ca <= 2.50
         AND lp.p >= 1.13 AND lp.p <= 1.78
         AND lith.ipth >= 150 AND lith.ipth <= 300
       )::int AS numer
     FROM month_pts mp
     INNER JOIN lca ON lca.patient_id = mp.patient_id
     INNER JOIN lp ON lp.patient_id = mp.patient_id
     INNER JOIN lith ON lith.patient_id = mp.patient_id`,
    [startDate, endDate],
  );
  return row;
}

async function fetchIdwgRate(startDate, endDate) {
  const { rows: [row] } = await pool.query(
    `SELECT
       COUNT(*)::int AS denom,
       COUNT(*) FILTER (WHERE uf_pct_of_dry_weight < 5)::int AS numer
     FROM dialysis_records
     WHERE session_date BETWEEN $1 AND $2
       AND uf_pct_of_dry_weight IS NOT NULL`,
    [startDate, endDate],
  );
  return row;
}

async function fetchBpControlRate(startDate, endDate) {
  const { rows: [row] } = await pool.query(
    `WITH first_vitals AS (
       SELECT DISTINCT ON (v.dialysis_record_id)
         v.dialysis_record_id,
         v.systolic_bp,
         v.diastolic_bp,
         d.patient_id,
         d.session_date
       FROM vital_signs v
       INNER JOIN dialysis_records d ON d.id = v.dialysis_record_id
       WHERE d.session_date BETWEEN $1 AND $2
         AND v.systolic_bp IS NOT NULL
         AND v.diastolic_bp IS NOT NULL
       ORDER BY v.dialysis_record_id, v.sequence_no ASC NULLS LAST, v.record_time ASC
     ),
     with_age AS (
       SELECT fv.*,
         EXTRACT(YEAR FROM AGE(fv.session_date::timestamp, p.dob))::int AS age_years
       FROM first_vitals fv
       INNER JOIN patients p ON p.id = fv.patient_id
     )
     SELECT
       COUNT(*)::int AS denom,
       COUNT(*) FILTER (WHERE
         (age_years < 60 AND systolic_bp < 140 AND diastolic_bp < 90)
         OR (age_years >= 60 AND systolic_bp < 160 AND diastolic_bp < 90)
       )::int AS numer
     FROM with_age`,
    [startDate, endDate],
  );
  return row;
}

class QcRoutineMetricsService {
  /**
   * @param {number} year
   * @param {number} month
   */
  async getRoutineMetrics(year, month) {
    const { startDate, endDate } = monthRange(year, month);
    const [ktvUrr, hbRow, albRow, mbdRow, idwgRow, bpRow] = await Promise.all([
      fetchKtvUrrRates(startDate, endDate),
      fetchLabRateGte(startDate, endDate, 'hb', 110),
      fetchLabRateGte(startDate, endDate, 'alb', 35),
      fetchMbdTriple(startDate, endDate),
      fetchIdwgRate(startDate, endDate),
      fetchBpControlRate(startDate, endDate),
    ]);

    const metrics = [
      buildMetric({
        key: 'ktv_adequacy',
        label: 'Kt/V 达标率',
        definition:
          '当月至少一次透析且能计算 Kt/V 的患者中，按患者取当月最后一次 spKt/V≥1.2 的比例（《规程》充分性目标与系统一致）。',
        target: 'spKt/V ≥ 1.2',
        numerator: ktvUrr.ktv.numer,
        denominator: ktvUrr.ktv.denom,
      }),
      buildMetric({
        key: 'urr_adequacy',
        label: 'URR 达标率',
        definition:
          '当月至少一次透析且能计算 URR 的患者中，按患者取当月最后一次 URR≥65% 的比例。',
        target: 'URR ≥ 65%',
        numerator: ktvUrr.urr.numer,
        denominator: ktvUrr.urr.denom,
      }),
      buildMetric({
        key: 'anemia_control',
        label: '肾性贫血控制率',
        definition:
          '当月有透析的每位患者，取截至月末最近一次 Hb，Hb≥110 g/L 人数占比（目标与检验模块一致）。',
        target: 'Hb ≥ 110 g/L',
        numerator: hbRow.numer,
        denominator: hbRow.denom,
      }),
      buildMetric({
        key: 'albumin_control',
        label: '血清白蛋白控制率',
        definition: '当月有透析的每位患者，取截至月末最近一次白蛋白，ALB≥35 g/L 人数占比。',
        target: 'ALB ≥ 35 g/L',
        numerator: albRow.numer,
        denominator: albRow.denom,
      }),
      buildMetric({
        key: 'ckd_mbd_control',
        label: 'CKD-MBD 指标控制率',
        definition:
          '当月有透析且截至月末同时具备血钙、血磷、iPTH 三项检验者中，钙 2.10–2.50、磷 1.13–1.78、iPTH 150–300 pg/mL 同时达标比例（与系统检验目标范围一致）。',
        target: '钙/磷/iPTH 同时达标',
        numerator: mbdRow.numer,
        denominator: mbdRow.denom,
      }),
      buildMetric({
        key: 'idwg_control',
        label: '透析间期体重增长控制率',
        definition:
          '当月透析记录中，超滤占干体重百分比（uf_pct_of_dry_weight）已录入的场次中，<5% 的场次占比。',
        target: '超滤占干体重 < 5%',
        numerator: idwgRow.numer,
        denominator: idwgRow.denom,
      }),
      buildMetric({
        key: 'bp_pre_control',
        label: '透析前血压控制率',
        definition:
          '当月每次透析取首条生命体征为透前血压：<60 岁收缩压/舒张压 <140/90 mmHg；≥60 岁 <160/90 mmHg。',
        target: '<60 岁:<140/90；≥60 岁:<160/90',
        numerator: bpRow.numer,
        denominator: bpRow.denom,
      }),
    ];

    return {
      report_year: year,
      report_month: month,
      period_start: startDate,
      period_end: endDate,
      metrics,
    };
  }
}

module.exports = new QcRoutineMetricsService();
