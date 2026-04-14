/**
 * 质控报表 REST 路由
 * 主要作用：生成与查询月度质控上报数据，对接 ReportGenerator 与护士长确认流程。
 * 主要功能：触发或读取月度五项指标汇总；报表状态；导出相关接口（若启用）。
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const auth = require('../middleware/auth');
const { rbac } = require('../middleware/rbac');
const ReportGenerator = require('../services/ReportGenerator');
const QcRoutineMetricsService = require('../services/QcRoutineMetricsService');
const MonthlyWorkloadService = require('../services/MonthlyWorkloadService');
const { validateYearMonthParams, validateTrendYearsQuery } = require('../validators/reportsValidators');
const { success, error, notFound } = require('../utils/response');

async function ensureQcReportDraft(year, month) {
  const yy = parseInt(year, 10);
  const mm = parseInt(month, 10);

  let { rows } = await pool.query(
    'SELECT * FROM qc_reports WHERE report_year = $1 AND report_month = $2',
    [yy, mm],
  );
  if (rows.length > 0) return rows[0];

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
    ],
  );
  return insertRes.rows[0] || null;
}

// GET /api/reports/qc-routine/:year/:month - 科室内部质控指标（实时聚合，不落库）
router.get('/qc-routine/:year/:month', auth, async (req, res, next) => {
  try {
    const valid = validateYearMonthParams(req.params);
    if (!valid.ok) return error(res, valid.message);
    const data = await QcRoutineMetricsService.getRoutineMetrics(valid.value.year, valid.value.month);
    return success(res, data);
  } catch (err) { next(err); }
});

// GET /api/reports/monthly-workload/:year/:month - 月度工作量（需求 3.8.1，实时聚合）
router.get('/monthly-workload/:year/:month', auth, async (req, res, next) => {
  try {
    const valid = validateYearMonthParams(req.params);
    if (!valid.ok) return error(res, valid.message);
    const data = await MonthlyWorkloadService.getMonthlyWorkload(valid.value.year, valid.value.month);
    return success(res, data);
  } catch (err) { next(err); }
});

// GET /api/reports/qc-upload/:year/:month - 获取月度质控上报数据
router.get('/qc-upload/:year/:month', auth, async (req, res, next) => {
  try {
    const valid = validateYearMonthParams(req.params);
    if (!valid.ok) return error(res, valid.message);
    const { year: yy, month: mm } = valid.value;

    const { rows } = await pool.query(
      'SELECT * FROM qc_reports WHERE report_year = $1 AND report_month = $2',
      [yy, mm]
    );
    return success(res, rows[0] || null);
  } catch (err) { next(err); }
});

// POST /api/reports/qc-upload/:year/:month/init - 显式初始化月度质控草稿
router.post('/qc-upload/:year/:month/init', auth, rbac(['admin', 'head_nurse']), async (req, res, next) => {
  try {
    const valid = validateYearMonthParams(req.params);
    if (!valid.ok) return error(res, valid.message);
    const { year: yy, month: mm } = valid.value;
    const row = await ensureQcReportDraft(yy, mm);
    return success(res, row, '质控月报草稿已初始化');
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

// PATCH /api/reports/qc-upload/:year/:month — 补充时点/周日护患比、备注（草稿或待审批可改）
router.patch('/qc-upload/:year/:month', auth, rbac(['admin', 'head_nurse']), async (req, res, next) => {
  try {
    const valid = validateYearMonthParams(req.params);
    if (!valid.ok) return error(res, valid.message);
    const { year: yy, month: mm } = valid.value;

    const { rows: cur } = await pool.query(
      'SELECT id, status FROM qc_reports WHERE report_year = $1 AND report_month = $2',
      [yy, mm],
    );
    if (cur.length === 0) return notFound(res, '报表不存在');
    if (cur[0].status === 'confirmed') return error(res, '已确认上报，不可再修改补充项');

    const { notes, spot_check_ratio, sunday_ratio } = req.body;
    const updates = [];
    const vals = [];
    let i = 1;
    if (notes !== undefined) {
      updates.push(`notes = $${i++}`);
      vals.push(notes === null || notes === '' ? null : String(notes));
    }
    if (spot_check_ratio !== undefined) {
      updates.push(`spot_check_ratio = $${i++}`);
      if (spot_check_ratio === null || spot_check_ratio === '') vals.push(null);
      else {
        const n = Number(spot_check_ratio);
        if (Number.isNaN(n) || n < 0 || n > 999.99) return error(res, '时点护患比数值无效');
        vals.push(n);
      }
    }
    if (sunday_ratio !== undefined) {
      updates.push(`sunday_ratio = $${i++}`);
      if (sunday_ratio === null || sunday_ratio === '') vals.push(null);
      else {
        const n = Number(sunday_ratio);
        if (Number.isNaN(n) || n < 0 || n > 999.99) return error(res, '周日时点护患比数值无效');
        vals.push(n);
      }
    }
    if (updates.length === 0) return error(res, '无可更新字段');

    vals.push(yy, mm);
    const { rows } = await pool.query(
      `UPDATE qc_reports SET ${updates.join(', ')}, updated_at = NOW()
       WHERE report_year = $${i++} AND report_month = $${i}
       RETURNING *`,
      vals,
    );
    return success(res, rows[0], '已保存');
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
    sheet.addRow(['时点护患比', report.spot_check_ratio != null && report.spot_check_ratio !== '' ? `1:${report.spot_check_ratio}` : '待填', '时点调查']);
    sheet.addRow(['某周日时点护患比', report.sunday_ratio != null && report.sunday_ratio !== '' ? `1:${report.sunday_ratio}` : '待填', '周日抽查']);
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

// GET /api/reports/qc-upload/:year/:month/export-pdf — 简明 PDF（ASCII 标签，含全部数值；正式中文表请用 Excel）
router.get('/qc-upload/:year/:month/export-pdf', auth, async (req, res, next) => {
  try {
    const { year, month } = req.params;
    const valid = validateYearMonthParams(req.params);
    if (!valid.ok) return error(res, valid.message);
    const { year: yy, month: mm } = valid.value;
    const { rows } = await pool.query(
      'SELECT * FROM qc_reports WHERE report_year = $1 AND report_month = $2',
      [yy, mm],
    );
    if (rows.length === 0) return notFound(res, '报表不存在');

    const PDFDocument = require('pdfkit');
    const report = rows[0];
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="qc_report_${year}_${month}.pdf"`,
    );
    doc.pipe(res);

    doc.fontSize(14).text('Dialysis Unit — Monthly QC Indicators (summary)', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(10).text(`Period: ${year}-${String(month).padStart(2, '0')}   Status: ${report.status}`, {
      align: 'center',
    });
    doc.moveDown();

    const line = (label, val) => {
      doc.fontSize(10).text(`${label}: ${val}`, { continued: false });
    };

    line('Nurse:patient ratio (avg)', `1:${report.nurse_patient_ratio}`);
    line('Patient sessions / Nurse sessions', `${report.total_patient_sessions} / ${report.total_nurse_sessions}`);
    if (report.spot_check_ratio != null) line('Spot-check ratio', `1:${report.spot_check_ratio}`);
    if (report.sunday_ratio != null) line('Sunday spot ratio', `1:${report.sunday_ratio}`);
    doc.moveDown(0.3);
    line('Total dialysis sessions', String(report.total_sessions));
    line('Circuit clotting count / rate', `${report.circuit_clotting_count} / ${report.circuit_clotting_rate}`);
    line('Membrane rupture count / rate', `${report.membrane_rupture_count} / ${report.membrane_rupture_rate}`);
    line('AVF sessions', String(report.avf_sessions));
    line('Puncture injury count / rate', `${report.puncture_injury_count} / ${report.puncture_injury_rate}`);
    line('CVC catheter-days / CRBSI / rate', `${report.cvc_catheter_days} / ${report.crbsi_count} / ${report.crbsi_rate}`);
    if (report.notes) {
      doc.moveDown();
      doc.fontSize(9).text(`Notes: ${report.notes}`, { width: 500 });
    }
    doc.end();
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
    const valid = validateTrendYearsQuery(req.query);
    if (!valid.ok) return error(res, valid.message);
    const startYear = new Date().getFullYear() - valid.value.years + 1;

    const { rows } = await pool.query(
      `SELECT report_year, report_month, nurse_patient_ratio,
              circuit_clotting_rate, membrane_rupture_rate,
              puncture_injury_rate, crbsi_rate
       FROM qc_reports
       WHERE status IN ('submitted','confirmed')
         AND report_year >= $1
       ORDER BY report_year ASC, report_month ASC`,
      [startYear]
    );
    return success(res, rows);
  } catch (err) { next(err); }
});

module.exports = router;
