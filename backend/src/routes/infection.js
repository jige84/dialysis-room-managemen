/**
 * 感染监控 REST 路由（筛查 + 监测数据）
 * 主要作用：维护传染病四项筛查与感染监测记录，支撑隔离区分配与 CRBSI 等指标。
 * 主要功能：筛查记录 CRUD 与最新结果查询；监测月报相关数据写入与查询。
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const auth = require('../middleware/auth');
const { rbac } = require('../middleware/rbac');
const { success, created, error } = require('../utils/response');
const InfectionService = require('../services/InfectionService');
const {
  validateLatestBatchPayload,
  normalizeScreeningItemsPayload,
  validateMonitoringPayload,
  validateMonitoringBatchPayload,
  normalizeButtonholeFilters,
} = require('../validators/infectionValidators');

// ── 感染筛查 ──────────────────────────────────────────────

// GET /api/infection/screenings/overdue - 全科到期筛查（静态路由，必须在 :patientId 之前）
router.get('/screenings/overdue', auth, rbac(['admin','head_nurse']), async (req, res, next) => {
  try {
    const { rows } = await InfectionService.listOverdueScreenings(pool);
    return success(res, rows);
  } catch (err) { next(err); }
});

// POST /api/infection/screenings/latest/batch - 批量获取患者最新筛查结果（用于感染页汇总）
router.post('/screenings/latest/batch', auth, rbac(['admin', 'doctor', 'head_nurse', 'nurse', 'technician', 'quality', 'qc']), async (req, res, next) => {
  try {
    const valid = validateLatestBatchPayload(req.body);
    if (!valid.ok) return error(res, valid.message);
    const patientIds = valid.value;
    if (patientIds.length === 0) return success(res, []);

    const { rows } = await InfectionService.listLatestScreeningsBatch(pool, patientIds);

    return success(res, rows);
  } catch (err) { next(err); }
});

// GET /api/infection/screenings/:patientId - 某患者筛查历史
router.get('/screenings/:patientId', auth, async (req, res, next) => {
  try {
    const { rows } = await InfectionService.listScreeningsByPatient(pool, req.params.patientId);
    return success(res, rows);
  } catch (err) { next(err); }
});

// GET /api/infection/screenings/:patientId/latest - 最新各项筛查结果
router.get('/screenings/:patientId/latest', auth, async (req, res, next) => {
  try {
    const { rows } = await InfectionService.listLatestScreeningsByPatient(pool, req.params.patientId);
    return success(res, rows);
  } catch (err) { next(err); }
});

// POST /api/infection/screenings/:patientId - 录入筛查结果（支持批量）
router.post('/screenings/:patientId', auth, rbac(['admin', 'doctor', 'head_nurse', 'nurse', 'technician']), async (req, res, next) => {
  try {
    const valid = normalizeScreeningItemsPayload(req.body);
    if (!valid.ok) return error(res, valid.message);

    const results = await InfectionService.createScreenings(
      pool,
      req.params.patientId,
      valid.value,
      req.user.id,
    );

    return created(res, results, `${results.length}条筛查结果已录入`);
  } catch (err) { next(err); }
});

// ── 感染监测月报（CVC/CRBSI数据） ─────────────────────────

// GET /api/infection/monitoring/:year/:month - 获取月度监测报告
router.get('/monitoring/:year/:month', auth, async (req, res, next) => {
  try {
    const year = parseInt(req.params.year, 10);
    const month = parseInt(req.params.month, 10);
    const { rows } = await InfectionService.listMonitoringByMonth(pool, year, month);
    return success(res, rows);
  } catch (err) { next(err); }
});

// POST /api/infection/monitoring - 录入或更新月度导管天数
router.post('/monitoring', auth, rbac(['admin','head_nurse','nurse']), async (req, res, next) => {
  try {
    const valid = validateMonitoringPayload(req.body);
    if (!valid.ok) return error(res, valid.message);
    const { rows } = await InfectionService.saveMonitoring(pool, valid.value, req.user.id);
    return created(res, rows[0], '感染监测数据已保存');
  } catch (err) { next(err); }
});

// POST /api/infection/monitoring/batch - 批量导入月度导管日数据
router.post('/monitoring/batch', auth, rbac(['admin','head_nurse']), async (req, res, next) => {
  try {
    const valid = validateMonitoringBatchPayload(req.body);
    if (!valid.ok) return error(res, valid.message);

    const { count } = await InfectionService.saveMonitoringBatch(pool, valid.value, req.user.id);
    return success(res, { count }, `已录入 ${count} 条导管日记录`);
  } catch (err) { next(err); }
});

// GET /api/infection/buttonhole-monitoring - 扣眼穿刺相关感染监测
router.get('/buttonhole-monitoring', auth, async (req, res, next) => {
  try {
    const valid = normalizeButtonholeFilters(req.query);
    if (!valid.ok) return error(res, valid.message);

    const { rows } = await InfectionService.listButtonholeMonitoring(pool, valid.value);
    return success(res, rows);
  } catch (err) { next(err); }
});

module.exports = router;
