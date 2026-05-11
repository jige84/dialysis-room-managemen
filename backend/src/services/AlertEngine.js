/**
 * 预警引擎（定时扫描写入 alerts）
 * 主要作用：按业务规则批量扫描患者与透析数据，生成或更新预警记录。
 * 主要功能：传染病复查到期、Kt/V、护患比等规则；由 scheduledTasks 每日触发 runAll。
 */
const { pool } = require('../config/database');

const ALERT_STATUS_ACTIVE = 'active';

/**
 * 统一 alerts 表写入模型：
 * - alert_rule_id：同类预警去重键（例如化验项目编码、设备报警类型）
 * - alert_type：业务类型（前后端统一）
 * - severity：仅允许 migration 021 中定义的 4 个枚举值
 */
function buildAlertDraft({
  patientId = null,
  machineId = null,
  alertRuleId,
  alertType,
  severity,
  title,
  message,
  notifiedRoles = null,
}) {
  return {
    patientId,
    machineId,
    alertRuleId,
    alertType,
    severity,
    title,
    message,
    notifiedRoles,
  };
}

class AlertEngine {
  async runAll() {
    await pool.query(
      `UPDATE alerts SET severity = 'warning'
       WHERE status = 'active' AND severity = 'critical'
         AND alert_type IN ('lab_review_due', 'infection_screening_due')`
    );

    let generated = 0;
    generated += await this.checkInfectionScreeningDue();
    generated += await this.checkLowKtV();
    generated += await this.checkLabReview();
    generated += await this.checkCVCHighRisk();
    generated += await this.checkButtonholeMonitoring();
    return { generated };
  }

  /**
   * 感染筛查到期提醒（HBV/HCV/HIV/梅毒抗体四项，维持患者约每半年复查）
   * 规程：距末次同类检测 ≥175 天预警，≥185 天超期（与 medical-domain-rules 一致）
   * 不使用占位天数；无记录与超期均只用 warning，避免挤占检验「危急值」汇总口径。
   */
  async checkInfectionScreeningDue() {
    const INFECTION_WARNING_DAYS = 175;
    const INFECTION_OVERDUE_DAYS = 185;

    const REQUIRED_TYPES = ['hbsag', 'hcvab', 'hiv', 'syphilis_tppa'];
    const TYPE_LABEL = {
      hbsag: 'HBsAg',
      hcvab: '抗-HCV',
      hiv: '抗-HIV',
      syphilis_tppa: '梅毒螺旋体抗体',
    };

    await pool.query(
      `UPDATE alerts SET status = 'auto_closed', handled_at = NOW(), handle_notes = $1
       WHERE alert_type = 'infection_screening_due' AND status = 'active'
         AND (
           message LIKE '%9999%'
           OR alert_rule_id = 'initial_screening'
         )`,
      ['规则更正：历史占位文案自动关闭']
    );

    await pool.query(
      `UPDATE alerts a SET status = 'auto_closed', handled_at = NOW(), handle_notes = $1
       WHERE a.alert_type = 'infection_screening_due' AND a.status = 'active'
         AND a.alert_rule_id = 'pending_initial_four'
         AND EXISTS (SELECT 1 FROM infection_screenings s WHERE s.patient_id = a.patient_id)`
      ,
      ['已存在筛查记录，自动关闭待完善提醒']
    );

    await pool.query(
      `UPDATE alerts a SET status = 'auto_closed', handled_at = NOW(), handle_notes = $1
       WHERE a.alert_type = 'infection_screening_due' AND a.status = 'active'
         AND a.alert_rule_id <> 'pending_initial_four'
         AND EXISTS (
           SELECT 1 FROM infection_screenings s
           WHERE s.patient_id = a.patient_id
             AND s.test_type = a.alert_rule_id
             AND (CURRENT_DATE - s.test_date)::integer < $2
         )`,
      ['复查已在周期内，自动关闭', INFECTION_WARNING_DAYS]
    );

    const { rows: noScreenPatients } = await pool.query(
      `SELECT p.id, p.name FROM patients p
       WHERE p.status = 'active'
         AND NOT EXISTS (SELECT 1 FROM infection_screenings s WHERE s.patient_id = p.id)`
    );

    let count = 0;
    for (const row of noScreenPatients) {
      const exists = await this._alertExists(row.id, 'infection_screening_due', 'pending_initial_four');
      if (exists) continue;

      await this._insertAlert(
        buildAlertDraft({
          patientId: row.id,
          alertRuleId: 'pending_initial_four',
          alertType: 'infection_screening_due',
          severity: 'warning',
          title: `传染病筛查待完善：${row.name}`,
          message: `患者 ${row.name} 尚未在系统中录入传染病筛查（四项），请安排检验并在传染病筛查模块登记`,
        })
      );
      count++;
    }

    const { rows } = await pool.query(
      `WITH active_patients AS (
         SELECT id, name FROM patients WHERE status = 'active'
       ),
       latest AS (
         SELECT DISTINCT ON (patient_id, test_type)
           patient_id, test_type, test_date
         FROM infection_screenings
         ORDER BY patient_id, test_type, test_date DESC
       )
       SELECT ap.id, ap.name, r.test_type AS test_type,
              l.test_date,
              CASE
                WHEN l.test_date IS NULL THEN NULL
                ELSE (CURRENT_DATE - l.test_date)::integer
              END AS days_since
       FROM active_patients ap
       INNER JOIN (SELECT unnest($1::text[]) AS test_type) r ON true
       LEFT JOIN latest l ON l.patient_id = ap.id AND l.test_type = r.test_type
       WHERE EXISTS (SELECT 1 FROM infection_screenings s WHERE s.patient_id = ap.id)`,
      [REQUIRED_TYPES]
    );

    for (const row of rows) {
      const label = TYPE_LABEL[row.test_type] || row.test_type;

      if (row.test_date == null) {
        const exists = await this._alertExists(row.id, 'infection_screening_due', row.test_type);
        if (exists) continue;

        await this._insertAlert(
          buildAlertDraft({
            patientId: row.id,
            alertRuleId: row.test_type,
            alertType: 'infection_screening_due',
            severity: 'warning',
            title: `感染筛查待完善：${row.name}`,
            message: `患者 ${row.name} 尚未录入 ${label} 筛查结果，请安排检验并在系统中登记`,
          })
        );
        count++;
        continue;
      }

      if (row.days_since >= INFECTION_WARNING_DAYS) {
        const exists = await this._alertExists(row.id, 'infection_screening_due', row.test_type);
        if (exists) continue;

        const overdue = row.days_since >= INFECTION_OVERDUE_DAYS;
        await this._insertAlert(
          buildAlertDraft({
            patientId: row.id,
            alertRuleId: row.test_type,
            alertType: 'infection_screening_due',
            severity: 'warning',
            title: overdue ? `感染筛查超期：${row.name}` : `感染筛查到期：${row.name}`,
            message: overdue
              ? `患者 ${row.name} 的 ${label} 筛查已 ${row.days_since} 天未复查（已超过 ${INFECTION_OVERDUE_DAYS} 天），请尽快安排复查`
              : `患者 ${row.name} 的 ${label} 筛查已 ${row.days_since} 天未复查（已达 ${INFECTION_WARNING_DAYS} 天提醒线），请安排复查`,
          })
        );
        count++;
      }
    }
    return count;
  }

  /**
   * 最近两次Kt/V连续未达标提醒
   */
  async checkLowKtV() {
    const { rows } = await pool.query(
      `SELECT patient_id, array_agg(ktv ORDER BY session_date DESC) as ktv_values
       FROM (
         SELECT patient_id, ktv, session_date,
                 ROW_NUMBER() OVER (PARTITION BY patient_id ORDER BY session_date DESC) as rn
          FROM dialysis_records
         WHERE ktv IS NOT NULL
        ) sub WHERE rn <= 2
        GROUP BY patient_id
        HAVING COUNT(*) = 2 AND EVERY(ktv < 1.2)`
    );

    let count = 0;
    for (const row of rows) {
      const exists = await this._alertExists(row.patient_id, 'low_ktv', 'default');
      if (exists) continue;

      const { rows: pRows } = await pool.query('SELECT name FROM patients WHERE id=$1', [row.patient_id]);
      const pname = pRows[0]?.name || row.patient_id;

      await this._insertAlert(buildAlertDraft({
        patientId: row.patient_id,
        alertRuleId: 'default',
        alertType: 'low_ktv',
        severity: 'warning',
        title: `Kt/V持续偏低：${pname}`,
        message: `患者 ${pname} 最近两次Kt/V均 < 1.2（${row.ktv_values.join(', ')}），请评估透析充分性`,
      }));
      count++;
    }
    return count;
  }

  /**
   * 化验项目复查到期提醒（各项目周期不同）
   */
  async checkLabReview() {
    const LAB_REVIEW_CYCLE = {
      hb:   30,  k:    30,  p:    30,  ca:   30,
      ipth: 90,  alb:  90,  b2mg: 180, sf:   90, tsat: 90,
    };

    let count = 0;
    for (const [testType, days] of Object.entries(LAB_REVIEW_CYCLE)) {
      const { rows } = await pool.query(
        `SELECT DISTINCT ON (lr.patient_id)
           lr.patient_id, lr.test_date, p.name
         FROM lab_results lr
         JOIN patients p ON lr.patient_id = p.id
         WHERE lr.test_type = $1 AND p.status = 'active'
         ORDER BY lr.patient_id, lr.test_date DESC`,
        [testType]
      );

      for (const row of rows) {
        const daysSince = Math.floor((Date.now() - new Date(row.test_date).getTime()) / 86400000);
        if (daysSince >= days - 7) {
          const exists = await this._alertExists(row.patient_id, 'lab_review_due', testType);
          if (exists) continue;

          await this._insertAlert(buildAlertDraft({
            patientId: row.patient_id,
            alertRuleId: testType,
            alertType: 'lab_review_due',
            severity: 'warning',
            title: `化验到期提醒：${row.name}`,
            message: `患者 ${row.name} 的 ${testType.toUpperCase()} 已${daysSince}天未复查（周期${days}天）`,
          }));
          count++;
        }
      }

      // 从未检测过该项目的患者
      const { rows: neverRows } = await pool.query(
        `SELECT p.id, p.name FROM patients p
         WHERE p.status = 'active' AND NOT EXISTS (
           SELECT 1 FROM lab_results lr WHERE lr.patient_id = p.id AND lr.test_type = $1
         )`,
        [testType]
      );
      for (const row of neverRows) {
        const exists = await this._alertExists(row.id, 'lab_review_due', testType);
        if (exists) continue;

        await this._insertAlert(buildAlertDraft({
          patientId: row.id,
          alertRuleId: testType,
          alertType: 'lab_review_due',
          severity: 'warning',
          title: `化验到期提醒：${row.name}`,
          message: `患者 ${row.name} 从未检测过 ${testType.toUpperCase()}，请安排检验`,
        }));
        count++;
      }
    }
    return count;
  }

  /**
   * CVC高风险预警（评分≥6分）
   */
  async checkCVCHighRisk() {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (va.patient_id)
         va.patient_id, va.id as access_id, cva.total_score, p.name
       FROM vascular_accesses va
       JOIN cvc_risk_assessments cva ON cva.vascular_access_id = va.id
       JOIN patients p ON p.id = va.patient_id
       WHERE va.access_type IN ('ncc','tcc') AND va.is_active = true
         AND cva.total_score >= 6
       ORDER BY va.patient_id, cva.assessed_at DESC`
    );

    let count = 0;
    for (const row of rows) {
      const exists = await this._alertExists(row.patient_id, 'cvc_high_risk', 'default');
      if (exists) continue;

      await this._insertAlert(buildAlertDraft({
        patientId: row.patient_id,
        alertRuleId: 'default',
        alertType: 'cvc_high_risk',
        severity: 'critical',
        title: `CVC高风险：${row.name}`,
        message: `患者 ${row.name} CVC感染风险评分 ${row.total_score} 分（≥6分），请重点关注`,
      }));
      count++;
    }
    return count;
  }

  /**
   * 扣眼穿刺每周监测提醒
   */
  async checkButtonholeMonitoring() {
    const { rows } = await pool.query(
      `SELECT va.patient_id, p.name,
         MAX(MAKE_DATE(im.monitor_year::int, im.monitor_month::int, 1)) AS last_monitor_date
       FROM vascular_accesses va
       JOIN patients p ON p.id = va.patient_id
       LEFT JOIN infection_monitoring im ON im.vascular_access_id = va.id
       WHERE va.is_buttonhole = true AND va.is_active = true
       GROUP BY va.patient_id, p.name`
    );

    let count = 0;
    for (const row of rows) {
      const daysSince = row.last_monitor_date
        ? Math.floor((Date.now() - new Date(row.last_monitor_date).getTime()) / 86400000)
        : 9999;

      if (daysSince >= 7) {
        const exists = await this._alertExists(row.patient_id, 'buttonhole_monitor', 'default');
        if (exists) continue;

        await this._insertAlert(buildAlertDraft({
          patientId: row.patient_id,
          alertRuleId: 'default',
          alertType: 'buttonhole_monitor',
          severity: 'info',
          title: `扣眼穿刺监测提醒：${row.name}`,
          message: `患者 ${row.name} 采用扣眼穿刺，${row.last_monitor_date ? daysSince + '天' : '从未'}记录周监测，请及时记录`,
        }));
        count++;
      }
    }
    return count;
  }

  /**
   * 超滤量超过干体重5%预警（medical-domain-rules §5）
   * 由 dialysis.js POST 在保存记录后异步调用
   * @param {string} patientId
   * @param {number} ufVolume 超滤量（mL）
   * @param {number} dryWeight 干体重（kg）
   * @param {number} ufPct 超滤占干体重百分比（如 5.3 表示 5.3%）
   */
  async checkUltrafiltrationAlert(patientId, ufVolume, dryWeight, ufPct) {
    const { rows: pRows } = await pool.query('SELECT name FROM patients WHERE id=$1', [patientId]);
    const pname = pRows[0]?.name || patientId;

    const exists = await this._alertExists(patientId, 'ultrafiltration_exceed', 'default');
    if (exists) return;

    await this._insertAlert(buildAlertDraft({
      patientId,
      alertRuleId: 'default',
      alertType: 'ultrafiltration_exceed',
      severity: 'critical',
      title: `超滤超标：${pname}`,
      message: `超滤量 ${ufVolume}mL 超过干体重5%（实际 ${ufPct.toFixed(1)}%），请医生评估`,
    }));
  }

  /**
   * 防重复预警检查
   */
  async _alertExists(patientId, alertType, alertRuleId) {
    const { rows } = await pool.query(
      `SELECT 1 FROM alerts
        WHERE patient_id = $1 AND alert_type = $2
          AND alert_rule_id = $3
          AND status = $4
        LIMIT 1`,
      [patientId, alertType, alertRuleId, ALERT_STATUS_ACTIVE]
    );
    return rows.length > 0;
  }

  async _insertAlert(draft) {
    await pool.query(
      `INSERT INTO alerts (
         patient_id,
         machine_id,
         alert_rule_id,
         alert_type,
         severity,
         title,
         message,
         status,
         notified_roles
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        draft.patientId,
        draft.machineId,
        draft.alertRuleId,
        draft.alertType,
        draft.severity,
        draft.title,
        draft.message,
        ALERT_STATUS_ACTIVE,
        draft.notifiedRoles,
      ],
    );
  }
}

module.exports = new AlertEngine();
