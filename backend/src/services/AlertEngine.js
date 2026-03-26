/**
 * 预警引擎
 * 负责扫描并生成各类预警到 alerts 表
 * 每日凌晨6点由 node-cron 调用
 */
const { pool } = require('../config/database');
const { isWithinDays } = require('../utils/dateUtils');

class AlertEngine {
  async runAll() {
    let generated = 0;
    generated += await this.checkInfectionScreeningDue();
    generated += await this.checkLowKtV();
    generated += await this.checkLabReview();
    generated += await this.checkCVCHighRisk();
    generated += await this.checkButtonholeMonitoring();
    return { generated };
  }

  /**
   * 感染筛查到期提醒（HBV/HCV/HIV/TP每半年）
   */
  async checkInfectionScreeningDue() {
    const DUE_DAYS = 180;
    const WARN_BEFORE_DAYS = 14;

    const { rows: patients } = await pool.query(
      `SELECT DISTINCT ON (p.id, is.screen_type)
         p.id, p.name, is.screen_type, is.screen_date
       FROM patients p
       LEFT JOIN infection_screenings is ON is.patient_id = p.id
       WHERE p.status = 'active'
       ORDER BY p.id, is.screen_type, is.screen_date DESC`
    );

    let count = 0;
    for (const row of patients) {
      const daysSince = row.screen_date
        ? Math.floor((Date.now() - new Date(row.screen_date).getTime()) / 86400000)
        : 9999;

      if (daysSince >= DUE_DAYS - WARN_BEFORE_DAYS) {
        const dueDate = row.screen_date
          ? new Date(new Date(row.screen_date).getTime() + DUE_DAYS * 86400000).toISOString().slice(0, 10)
          : null;

        const exists = await this._alertExists(row.id, 'infection_screening_due', row.screen_type);
        if (exists) continue;

        await pool.query(
          `INSERT INTO alerts (patient_id, alert_type, alert_subtype, priority, title, message, due_date)
           VALUES ($1, 'infection_screening_due', $2, $3, $4, $5, $6)
           ON CONFLICT (patient_id, alert_type, alert_subtype) WHERE status='pending' DO NOTHING`,
          [
            row.id,
            row.screen_type || '初筛',
            daysSince >= DUE_DAYS ? 'high' : 'medium',
            `感染筛查到期：${row.name}`,
            `患者 ${row.name} 的 ${row.screen_type || '感染'} 筛查已${daysSince}天未复查，请安排复查`,
            dueDate,
          ]
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
      `SELECT patient_id, array_agg(spktv ORDER BY session_date DESC) as ktv_values
       FROM (
         SELECT patient_id, spktv, session_date,
                ROW_NUMBER() OVER (PARTITION BY patient_id ORDER BY session_date DESC) as rn
         FROM dialysis_records
         WHERE spktv IS NOT NULL
       ) sub WHERE rn <= 2
       GROUP BY patient_id
       HAVING COUNT(*) = 2 AND EVERY(spktv < 1.2)`
    );

    let count = 0;
    for (const row of rows) {
      const exists = await this._alertExists(row.patient_id, 'low_ktv', null);
      if (exists) continue;

      const { rows: pRows } = await pool.query('SELECT name FROM patients WHERE id=$1', [row.patient_id]);
      const pname = pRows[0]?.name || row.patient_id;

      await pool.query(
        `INSERT INTO alerts (patient_id, alert_type, priority, title, message)
         VALUES ($1, 'low_ktv', 'medium', $2, $3)
         ON CONFLICT (patient_id, alert_type, alert_subtype) WHERE status='pending' DO NOTHING`,
        [
          row.patient_id,
          `Kt/V持续偏低：${pname}`,
          `患者 ${pname} 最近两次Kt/V均 < 1.2（${row.ktv_values.join(', ')}），请评估透析充分性`
        ]
      );
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

          await pool.query(
            `INSERT INTO alerts (patient_id, alert_type, alert_subtype, priority, title, message)
             VALUES ($1, 'lab_review_due', $2, 'low', $3, $4)
             ON CONFLICT (patient_id, alert_type, alert_subtype) WHERE status='pending' DO NOTHING`,
            [
              row.patient_id,
              testType,
              `化验到期提醒：${row.name}`,
              `患者 ${row.name} 的 ${testType.toUpperCase()} 已${daysSince}天未复查（周期${days}天）`
            ]
          );
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

        await pool.query(
          `INSERT INTO alerts (patient_id, alert_type, alert_subtype, priority, title, message)
           VALUES ($1, 'lab_review_due', $2, 'low', $3, $4)
           ON CONFLICT (patient_id, alert_type, alert_subtype) WHERE status='pending' DO NOTHING`,
          [
            row.id, testType,
            `化验到期提醒：${row.name}`,
            `患者 ${row.name} 从未检测过 ${testType.toUpperCase()}，请安排检验`
          ]
        );
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
       JOIN cvc_risk_assessments cva ON cva.access_id = va.id
       JOIN patients p ON p.id = va.patient_id
       WHERE va.access_type IN ('ncc','tcc') AND va.is_current = true
         AND cva.total_score >= 6
       ORDER BY va.patient_id, cva.assessed_at DESC`
    );

    let count = 0;
    for (const row of rows) {
      const exists = await this._alertExists(row.patient_id, 'cvc_high_risk', null);
      if (exists) continue;

      await pool.query(
        `INSERT INTO alerts (patient_id, alert_type, priority, title, message)
         VALUES ($1, 'cvc_high_risk', 'high', $2, $3)`,
        [
          row.patient_id,
          `CVC高风险：${row.name}`,
          `患者 ${row.name} CVC感染风险评分 ${row.total_score} 分（≥6分），请重点关注`
        ]
      );
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
         MAX(im.monitor_date) as last_monitor_date
       FROM vascular_accesses va
       JOIN patients p ON p.id = va.patient_id
       LEFT JOIN infection_monitoring im ON im.access_id = va.id
       WHERE va.is_buttonhole = true AND va.is_current = true
       GROUP BY va.patient_id, p.name`
    );

    let count = 0;
    for (const row of rows) {
      const daysSince = row.last_monitor_date
        ? Math.floor((Date.now() - new Date(row.last_monitor_date).getTime()) / 86400000)
        : 9999;

      if (daysSince >= 7) {
        const exists = await this._alertExists(row.patient_id, 'buttonhole_monitor', null);
        if (exists) continue;

        await pool.query(
          `INSERT INTO alerts (patient_id, alert_type, priority, title, message)
           VALUES ($1, 'buttonhole_monitor', 'medium', $2, $3)`,
          [
            row.patient_id,
            `扣眼穿刺监测提醒：${row.name}`,
            `患者 ${row.name} 采用扣眼穿刺，${row.last_monitor_date ? daysSince + '天' : '从未'}记录周监测，请及时记录`
          ]
        );
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
   * @param {number} ufPct 超滤比例（0~1）
   */
  async checkUltrafiltrationAlert(patientId, ufVolume, dryWeight, ufPct) {
    const { rows: pRows } = await pool.query('SELECT name FROM patients WHERE id=$1', [patientId]);
    const pname = pRows[0]?.name || patientId;

    await pool.query(
      `INSERT INTO alerts (patient_id, alert_type, priority, title, message)
       VALUES ($1, 'ultrafiltration_exceed', 'high', $2, $3)
       ON CONFLICT (patient_id, alert_type, alert_subtype) WHERE status='pending' DO NOTHING`,
      [
        patientId,
        `超滤超标：${pname}`,
        `超滤量 ${ufVolume}mL 超过干体重5%（${(ufPct * 100).toFixed(1)}%），请医生评估`
      ]
    );
  }

  /**
   * 防重复预警检查
   */
  async _alertExists(patientId, alertType, subtype) {
    const { rows } = await pool.query(
      `SELECT 1 FROM alerts
       WHERE patient_id = $1 AND alert_type = $2
         AND ($3::text IS NULL OR alert_subtype = $3)
         AND status = 'pending'
       LIMIT 1`,
      [patientId, alertType, subtype]
    );
    return rows.length > 0;
  }
}

module.exports = new AlertEngine();
