/**
 * 月度工作量报表（需求 3.8.1）— 从透析记录聚合，不落库。
 */
const { pool } = require('../config/database');

/** @param {number} year @param {number} month */
function monthRange(year, month) {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = new Date(year, month, 0).toISOString().slice(0, 10);
  return { startDate, endDate };
}

class MonthlyWorkloadService {
  /**
   * @param {number} year
   * @param {number} month
   */
  async getMonthlyWorkload(year, month) {
    const { startDate, endDate } = monthRange(year, month);

    const { rows: [agg] } = await pool.query(
      `SELECT
         COUNT(*)::int AS total_dialysis_sessions,
         COUNT(*) FILTER (WHERE is_avf_session = true)::int AS avf_sessions,
         COALESCE(SUM(actual_duration), 0)::bigint AS total_duration_minutes,
         COUNT(*) FILTER (WHERE is_circuit_clotted)::int AS circuit_clot_complete_count,
         COUNT(*) FILTER (WHERE coagulation_grade >= 2)::int AS coagulation_grade_2_plus_count,
         COUNT(*) FILTER (WHERE is_membrane_ruptured)::int AS membrane_rupture_count,
         COUNT(*) FILTER (WHERE puncture_result = 'difficult')::int AS puncture_difficult_count
       FROM dialysis_records
       WHERE session_date BETWEEN $1 AND $2`,
      [startDate, endDate],
    );

    const { rows: [nurseAgg] } = await pool.query(
      `WITH daily_stats AS (
         SELECT
           session_date::date AS sd,
           COUNT(*)::bigint AS daily_sessions,
           COUNT(DISTINCT nurse_id)::bigint AS daily_nurse_count
         FROM dialysis_records
         WHERE session_date BETWEEN $1 AND $2
         GROUP BY session_date
       )
       SELECT
         COALESCE(SUM(daily_sessions), 0)::bigint AS total_patient_sessions,
         COALESCE(SUM(daily_nurse_count), 0)::bigint AS total_nurse_sessions
       FROM daily_stats`,
      [startDate, endDate],
    );

    const totalSessions = parseInt(agg.total_dialysis_sessions, 10) || 0;
    const totalDur = parseInt(agg.total_duration_minutes, 10) || 0;
    const avf = parseInt(agg.avf_sessions, 10) || 0;
    const tp = parseInt(nurseAgg.total_patient_sessions, 10) || 0;
    const tn = parseInt(nurseAgg.total_nurse_sessions, 10) || 0;
    const ratio = tn > 0 ? Math.round((tp / tn) * 100) / 100 : 0;

    return {
      report_year: year,
      report_month: month,
      period_start: startDate,
      period_end: endDate,
      total_dialysis_sessions: totalSessions,
      avf_sessions: avf,
      total_duration_minutes: totalDur,
      avg_duration_minutes: totalSessions > 0 ? Math.round((totalDur / totalSessions) * 10) / 10 : 0,
      total_patient_sessions_for_ratio: tp,
      total_nurse_sessions_for_ratio: tn,
      nurse_patient_ratio: ratio,
      puncture_difficult_count: parseInt(agg.puncture_difficult_count, 10) || 0,
      puncture_difficult_rate: avf > 0
        ? Math.round((parseInt(agg.puncture_difficult_count, 10) / avf) * 100000) / 100000
        : 0,
      circuit_clot_complete_count: parseInt(agg.circuit_clot_complete_count, 10) || 0,
      circuit_clot_complete_rate: totalSessions > 0
        ? Math.round((parseInt(agg.circuit_clot_complete_count, 10) / totalSessions) * 100000) / 100000
        : 0,
      coagulation_grade_2_plus_count: parseInt(agg.coagulation_grade_2_plus_count, 10) || 0,
      membrane_rupture_count: parseInt(agg.membrane_rupture_count, 10) || 0,
      membrane_rupture_rate: totalSessions > 0
        ? Math.round((parseInt(agg.membrane_rupture_count, 10) / totalSessions) * 100000) / 100000
        : 0,
    };
  }
}

module.exports = new MonthlyWorkloadService();
