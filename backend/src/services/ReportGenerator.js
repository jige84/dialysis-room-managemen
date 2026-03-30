/**
 * 月度质控报表数据生成服务
 * 主要作用：从透析、医嘱执行、感染监测等表汇总质控中心要求的月度指标。
 * 主要功能：按年月聚合五项上报指标；写入或更新报表记录；供 reports 路由与定时任务调用。
 */
const { pool } = require('../config/database');

class ReportGenerator {
  /**
   * 生成月度质控上报数据
   * @param {number} year
   * @param {number} month
   * @returns {Promise<object>} 5项质控指标数据
   */
  async generateQCUpload(year, month) {
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = new Date(year, month, 0).toISOString().slice(0, 10);

    // ── 指标一：护患比 ─────────────────────────────────────
    const { rows: nurseData } = await pool.query(
      `SELECT
         COUNT(*) as total_patient_sessions,
         COUNT(DISTINCT DATE(session_date)) as work_days,
         COUNT(DISTINCT nurse_id) as total_nurses
       FROM dialysis_records
       WHERE session_date BETWEEN $1 AND $2`,
      [startDate, endDate]
    );

    // 护士总工作次数（每人每日算一次，不重复计）
    const { rows: nurseSessionData } = await pool.query(
      `SELECT COUNT(DISTINCT (session_date, nurse_id)) as total_nurse_sessions
       FROM dialysis_records
       WHERE session_date BETWEEN $1 AND $2`,
      [startDate, endDate]
    );

    const totalPatientSessions = parseInt(nurseData[0].total_patient_sessions);
    const totalNurseSessions = parseInt(nurseSessionData[0].total_nurse_sessions);
    const nursePatientRatio = totalNurseSessions > 0
      ? Math.round((totalPatientSessions / totalNurseSessions) * 100) / 100
      : 0;

    // ── 指标二：体外循环凝血发生率 ─────────────────────────
    const { rows: clotData } = await pool.query(
      `SELECT
         COUNT(*) as total_sessions,
         SUM(CASE WHEN is_circuit_clotted THEN 1 ELSE 0 END) as circuit_clotting_count
       FROM dialysis_records
       WHERE session_date BETWEEN $1 AND $2`,
      [startDate, endDate]
    );
    const totalSessions = parseInt(clotData[0].total_sessions);
    const clottingCount = parseInt(clotData[0].circuit_clotting_count || 0);
    const clottingRate = totalSessions > 0
      ? Math.round((clottingCount / totalSessions) * 100000) / 100000
      : 0;

    // ── 指标三：体外循环漏血发生率 ─────────────────────────
    const { rows: membraneData } = await pool.query(
      `SELECT SUM(CASE WHEN is_membrane_ruptured THEN 1 ELSE 0 END) as membrane_rupture_count
       FROM dialysis_records
       WHERE session_date BETWEEN $1 AND $2`,
      [startDate, endDate]
    );
    const membraneRuptureCount = parseInt(membraneData[0].membrane_rupture_count || 0);
    const membraneRuptureRate = totalSessions > 0
      ? Math.round((membraneRuptureCount / totalSessions) * 100000) / 100000
      : 0;

    // ── 指标四：内瘘穿刺损伤发生率 ─────────────────────────
    const { rows: avfData } = await pool.query(
      `SELECT COUNT(*) as avf_sessions
       FROM dialysis_records
       WHERE session_date BETWEEN $1 AND $2 AND is_avf_session = true`,
      [startDate, endDate]
    );

    const { rows: injuryData } = await pool.query(
      `SELECT COUNT(*) as puncture_injury_count
       FROM complications
       WHERE occurred_at BETWEEN $1 AND $2
         AND comp_type = 'avf_injury' AND is_avf_injury_bleed = true`,
      [startDate + ' 00:00:00', endDate + ' 23:59:59']
    );
    const avfSessions = parseInt(avfData[0].avf_sessions);
    const punctureInjuryCount = parseInt(injuryData[0].puncture_injury_count || 0);
    const punctureInjuryRate = avfSessions > 0
      ? Math.round((punctureInjuryCount / avfSessions) * 100000) / 100000
      : 0;

    // ── 指标五：CRBSI发生率（每千导管日）────────────────────
    const { rows: crbsiData } = await pool.query(
      `SELECT
         COALESCE(SUM(catheter_days), 0) as cvc_catheter_days,
         COUNT(*) FILTER (WHERE infection_status = 'confirmed') as crbsi_count
       FROM infection_monitoring
       WHERE monitor_year = $1 AND monitor_month = $2`,
      [year, month]
    );
    const cvcCatheterDays = parseInt(crbsiData[0].cvc_catheter_days || 0);
    const crbsiCount = parseInt(crbsiData[0].crbsi_count || 0);
    const crbsiRate = cvcCatheterDays > 0
      ? Math.round((crbsiCount / cvcCatheterDays) * 1000 * 100000) / 100000
      : 0;

    return {
      total_patient_sessions: totalPatientSessions,
      total_nurse_sessions:   totalNurseSessions,
      nurse_patient_ratio:    nursePatientRatio,
      total_sessions:         totalSessions,
      circuit_clotting_count: clottingCount,
      circuit_clotting_rate:  clottingRate,
      membrane_rupture_count: membraneRuptureCount,
      membrane_rupture_rate:  membraneRuptureRate,
      avf_sessions:           avfSessions,
      puncture_injury_count:  punctureInjuryCount,
      puncture_injury_rate:   punctureInjuryRate,
      cvc_catheter_days:      cvcCatheterDays,
      crbsi_count:            crbsiCount,
      crbsi_rate:             crbsiRate,
    };
  }
}

module.exports = new ReportGenerator();
