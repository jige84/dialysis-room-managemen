/**
 * 质控报表路由
 * 核心：自动汇总5项质控指标，生成月度上报报表
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const auth = require('../middleware/auth');
const { rbac } = require('../middleware/rbac');
const ReportGenerator = require('../services/ReportGenerator');
const { success, error, notFound } = require('../utils/response');

// GET /api/reports/qc-upload/:year/:month - 获取月度质控上报数据
router.get('/qc-upload/:year/:month', auth, async (req, res, next) => {
  try {
    const { year, month } = req.params;
    const yy = parseInt(year);
    const mm = parseInt(month);

    // 查找或生成草稿
    let { rows } = await pool.query(
      'SELECT * FROM qc_reports WHERE report_year = $1 AND report_month = $2',
      [yy, mm]
    );

    if (rows.length === 0) {
      // 自动生成草稿
      const generated = await ReportGenerator.generateQCUpload(yy, mm);
      const insertRes = await pool.query(
        `INSERT INTO qc_reports (
           report_year, report_month,
           total_patient_sessions, total_nurse_sessions, nurse_patient_ratio,
           total_sessions, circuit_clotting_count, circuit_clotting_rate,
           membrane_rupture_count, membrane_rupture_rate,
           avf_sessions, puncture_injury_count, puncture_injury_rate,
           cvc_catheter_days, crbsi_count, crbsi_rate, status
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'draft')
         RETURNING *`,
        [
          yy, mm,
          generated.total_patient_sessions, generated.total_nurse_sessions, generated.nurse_patient_ratio,
          generated.total_sessions, generated.circuit_clotting_count, generated.circuit_clotting_rate,
          generated.membrane_rupture_count, generated.membrane_rupture_rate,
          generated.avf_sessions, generated.puncture_injury_count, generated.puncture_injury_rate,
          generated.cvc_catheter_days, generated.crbsi_count, generated.crbsi_rate,
        ]
      );
      rows = insertRes.rows;
    }

    return success(res, rows[0]);
  } catch (err) { next(err); }
});

// POST /api/reports/qc-upload/:year/:month/submit - 护士长提交审核
router.post('/qc-upload/:year/:month/submit', auth, rbac(['admin','head_nurse']), async (req, res, next) => {
  try {
    const { year, month } = req.params;
    const { rows } = await pool.query(
      `UPDATE qc_reports
       SET status = 'submitted', submitted_by = $1, submitted_at = NOW(), updated_at = NOW()
       WHERE report_year = $2 AND report_month = $3 AND status IN ('draft')
       RETURNING *`,
      [req.user.id, parseInt(year), parseInt(month)]
    );
    if (rows.length === 0) return error(res, '报表不存在或状态不允许提交');
    return success(res, rows[0], '报表已提交审核');
  } catch (err) { next(err); }
});

// POST /api/reports/qc-upload/:year/:month/confirm - 科主任确认
router.post('/qc-upload/:year/:month/confirm', auth, rbac(['admin']), async (req, res, next) => {
  try {
    const { year, month } = req.params;
    const { rows } = await pool.query(
      `UPDATE qc_reports
       SET status = 'confirmed', confirmed_by = $1, confirmed_at = NOW(), updated_at = NOW()
       WHERE report_year = $2 AND report_month = $3 AND status IN ('submitted')
       RETURNING *`,
      [req.user.id, parseInt(year), parseInt(month)]
    );
    if (rows.length === 0) return error(res, '报表不存在或尚未提交');
    return success(res, rows[0], '科主任已确认签字');
  } catch (err) { next(err); }
});

// GET /api/reports/qc-upload/:year/:month/export - 导出Excel
router.get('/qc-upload/:year/:month/export', auth, async (req, res, next) => {
  try {
    const { year, month } = req.params;
    const { rows } = await pool.query(
      'SELECT * FROM qc_reports WHERE report_year = $1 AND report_month = $2',
      [parseInt(year), parseInt(month)]
    );
    if (rows.length === 0) return notFound(res, '报表不存在');

    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('质控指标月报');

    const report = rows[0];
    const title = `涉县善谷医院血液透析专业质控指标月度上报`;
    sheet.mergeCells('A1:D1');
    sheet.getCell('A1').value = title;
    sheet.getCell('A1').font = { bold: true, size: 14 };
    sheet.getCell('A1').alignment = { horizontal: 'center' };

    sheet.addRow(['填报月份', `${year}年${month}月`, '填报人', '杨晨']);
    sheet.addRow([]);

    sheet.addRow(['质控指标', '数值', '计算说明']);
    sheet.addRow(['平均护患比', `1:${report.nurse_patient_ratio}`, `患者${report.total_patient_sessions}次 / 护士${report.total_nurse_sessions}次`]);
    sheet.addRow(['时点护患比', report.spot_check_ratio ? `1:${report.spot_check_ratio}` : '待填', '时点调查']);
    sheet.addRow(['体外循环凝血发生率', report.circuit_clotting_rate, `${report.circuit_clotting_count}次/${report.total_sessions}次`]);
    sheet.addRow(['体外循环漏血发生率', report.membrane_rupture_rate, `${report.membrane_rupture_count}次/${report.total_sessions}次`]);
    sheet.addRow(['内瘘穿刺损伤发生率', report.puncture_injury_rate, `${report.puncture_injury_count}次/${report.avf_sessions}次`]);
    sheet.addRow(['CRBSI发生率(每千导管日)', report.crbsi_rate, `${report.crbsi_count}例/${report.cvc_catheter_days}导管天`]);
    sheet.addRow([]);
    sheet.addRow(['审核状态', report.status, `确认时间：${report.confirmed_at || '-'}`]);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=quality_report_${year}_${month}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) { next(err); }
});

// GET /api/reports/qc-upload/history - 近12个月质控上报状态
router.get('/qc-upload/history', auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT report_year, report_month, status, nurse_patient_ratio,
              circuit_clotting_rate, membrane_rupture_rate, puncture_injury_rate, crbsi_rate,
              confirmed_at
       FROM qc_reports
       ORDER BY report_year DESC, report_month DESC
       LIMIT 12`
    );
    return success(res, rows);
  } catch (err) { next(err); }
});

// GET /api/reports/qc-trend?years=2 - 质控趋势图数据
router.get('/qc-trend', auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT report_year, report_month, nurse_patient_ratio,
              circuit_clotting_rate, membrane_rupture_rate,
              puncture_injury_rate, crbsi_rate
       FROM qc_reports WHERE status IN ('submitted','confirmed')
       ORDER BY report_year ASC, report_month ASC`
    );
    return success(res, rows);
  } catch (err) { next(err); }
});

module.exports = router;
