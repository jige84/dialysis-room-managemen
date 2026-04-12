/**
 * 定时任务注册（node-cron）
 * 主要作用：在进程启动时注册周期性任务，驱动预警与质控报表等后台逻辑。
 * 主要功能：每日凌晨预警扫描；每月初自动生成上月质控报表草稿；可选每日数据库备份钩子。
 */
const cron = require('node-cron');
const AlertEngine = require('../services/AlertEngine');
const ReportGenerator = require('../services/ReportGenerator');
const { pool } = require('../config/database');
const logger = require('../utils/logger');

function initScheduledTasks() {
  // ── 每日凌晨6点运行预警扫描 ─────────────────────────────
  cron.schedule('0 6 * * *', async () => {
    logger.info('[定时任务] 开始运行预警扫描...');
    try {
      const result = await AlertEngine.runAll();
      logger.info(`[定时任务] 预警扫描完成，生成 ${result.generated} 条新预警`);
    } catch (err) {
      logger.error('[定时任务] 预警扫描失败：', err.message);
    }
  }, { timezone: 'Asia/Shanghai' });

  // ── 每月1号早8点自动生成上月质控报表草稿 ────────────────
  cron.schedule('0 8 1 * *', async () => {
    const now = new Date();
    const year  = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const month = now.getMonth() === 0 ? 12 : now.getMonth();

    logger.info(`[定时任务] 自动生成 ${year}年${month}月 质控报表草稿...`);
    try {
      // 检查是否已存在
      const { rows } = await pool.query(
        'SELECT id FROM qc_reports WHERE report_year = $1 AND report_month = $2',
        [year, month]
      );
      if (rows.length > 0) {
        logger.info('[定时任务] 质控报表已存在，跳过生成');
        return;
      }
      const generated = await ReportGenerator.generateQCUpload(year, month);
      await pool.query(
        `INSERT INTO qc_reports (
           report_year, report_month,
           total_patient_sessions, total_nurse_sessions, nurse_patient_ratio,
           total_sessions, circuit_clotting_count, circuit_clotting_rate,
           membrane_rupture_count, membrane_rupture_rate,
           avf_sessions, puncture_injury_count, puncture_injury_rate,
           cvc_catheter_days, crbsi_count, crbsi_rate, status
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'draft')`,
        [
          year, month,
          generated.total_patient_sessions, generated.total_nurse_sessions, generated.nurse_patient_ratio,
          generated.total_sessions, generated.circuit_clotting_count, generated.circuit_clotting_rate,
          generated.membrane_rupture_count, generated.membrane_rupture_rate,
          generated.avf_sessions, generated.puncture_injury_count, generated.puncture_injury_rate,
          generated.cvc_catheter_days, generated.crbsi_count, generated.crbsi_rate,
        ]
      );
      logger.info(`[定时任务] ${year}年${month}月质控报表草稿已生成`);
    } catch (err) {
      logger.error('[定时任务] 质控报表生成失败：', err.message);
    }
  }, { timezone: 'Asia/Shanghai' });

  // ── 每周一早9点提醒CQI季报 ──────────────────────────────
  cron.schedule('0 9 * * 1', async () => {
    const month = new Date().getMonth() + 1;
    if ([1, 4, 7, 10].includes(month)) {
      const year = new Date().getFullYear();
      const quarter = Math.floor((month - 1) / 3) + 1;
      const alertRuleId = `${year}-Q${quarter}`;
      logger.info('[定时任务] 提醒：本月为季度CQI总结月，请及时录入CQI分析报告');
      // 生成CQI季度提醒预警
      try {
        const { rows: existsRows } = await pool.query(
          `SELECT 1
             FROM alerts
            WHERE alert_type = 'cqi_quarterly'
              AND alert_rule_id = $1
              AND status = 'active'
            LIMIT 1`,
          [alertRuleId],
        );
        if (existsRows.length > 0) {
          logger.info('[定时任务] 本季度 CQI 提醒已存在，跳过生成');
          return;
        }
        await pool.query(
          `INSERT INTO alerts (
             alert_rule_id, alert_type, severity, title, message, status
           )
           VALUES ($1, 'cqi_quarterly', 'info', 'CQI季度总结提醒',
                   '本季度CQI分析会议请于本月内召开，请护士长安排并录入会议记录', 'active')`,
          [alertRuleId],
        );
      } catch (err) {
        logger.error('[定时任务] CQI提醒生成失败：', err.message);
      }
    }
  }, { timezone: 'Asia/Shanghai' });

  logger.info('[定时任务] 所有定时任务已注册（时区：亚洲/上海）');
}

module.exports = initScheduledTasks;
