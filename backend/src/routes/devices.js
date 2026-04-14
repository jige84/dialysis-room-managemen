/**
 * 透析机与耗材 REST 路由
 * 主要作用：透析机台账、machine_maintenance、耗材批次与出入库。
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const auth = require('../middleware/auth');
const { rbac } = require('../middleware/rbac');
const { success, created, error, notFound } = require('../utils/response');
const DevicesMachineService = require('../services/DevicesMachineService');
const {
  validateMachineCreatePayload,
  buildMachinePatchPayload,
  normalizeMachineStatusPayload,
  validateMachineMaintenancePayload,
  normalizeMachineAlertPayload,
} = require('../validators/devicesValidators');
const DevicesWaterService = require('../services/DevicesWaterService');
const {
  validateWaterMachineCreatePayload,
  validateWaterMachineMaintenancePayload,
  validateLegacyMaintenancePayload,
  normalizeMaintenanceListQuery,
  normalizeWaterDailyInspectionListQuery,
  validateWaterDailyInspectionCreatePayload,
} = require('../validators/devicesWaterValidators');
const DevicesWaterQualityService = require('../services/DevicesWaterQualityService');
const {
  normalizeWaterQualityListQuery,
  normalizeWaterQualityCreatePayload,
} = require('../validators/devicesWaterQualityValidators');
const DevicesConsumablesService = require('../services/DevicesConsumablesService');
const {
  validateConsumableCreatePayload,
  validateConsumableInboundPayload,
  normalizeConsumableOutboundLinesQuery,
  validateConsumablePatientUsageQuery,
  validateConsumableStockPatchPayload,
} = require('../validators/devicesConsumablesValidators');
const PG_UNDEFINED_COLUMN = '42703';
const PG_FOREIGN_KEY_VIOLATION = '23503';

// ── 透析机 ────────────────────────────────────────────────

router.get('/machines', auth, async (req, res, next) => {
  try {
    const { rows } = await DevicesMachineService.listMachines(pool);
    return success(res, rows);
  } catch (err) { next(err); }
});

router.post('/machines', auth, rbac(['admin', 'head_nurse']), async (req, res, next) => {
  try {
    const valid = validateMachineCreatePayload(req.body);
    if (!valid.ok) return error(res, valid.message);
    const { rows } = await DevicesMachineService.createMachine(pool, valid.value);
    return created(res, rows[0], '透析机已登记');
  } catch (err) { next(err); }
});

router.patch('/machines/:id', auth, rbac(['admin', 'head_nurse']), async (req, res, next) => {
  try {
    const valid = buildMachinePatchPayload(req.body);
    if (!valid.ok) return error(res, valid.message);
    const { rows } = await DevicesMachineService.patchMachine(
      pool,
      req.params.id,
      valid.value.updates,
      valid.value.values,
    );
    if (rows.length === 0) return notFound(res, '设备不存在');
    return success(res, rows[0], '已更新');
  } catch (err) { next(err); }
});

router.patch('/machines/:id/status', auth, rbac(['admin', 'head_nurse']), async (req, res, next) => {
  try {
    const valid = normalizeMachineStatusPayload(req.body);
    if (!valid.ok) return error(res, valid.message);
    const { rows } = await DevicesMachineService.patchMachineStatus(
      pool,
      req.params.id,
      valid.value.status,
      valid.value.notes,
    );
    if (rows.length === 0) return notFound(res, '设备不存在');
    return success(res, rows[0], '设备状态已更新');
  } catch (err) { next(err); }
});

router.delete('/machines/:id', auth, rbac(['admin', 'head_nurse', 'technician']), async (req, res, next) => {
  try {
    const { rows } = await DevicesMachineService.deleteMachine(pool, req.params.id);
    if (rows.length === 0) return notFound(res, '设备不存在');
    return success(res, rows[0], '透析机已删除');
  } catch (err) {
    if (err?.code === PG_FOREIGN_KEY_VIOLATION) {
      return error(res, '该透析机已被透析记录或维护记录引用，无法删除。请先处理关联数据或改为停用。', 400);
    }
    next(err);
  }
});

router.get('/machines/:id/maintenance', auth, async (req, res, next) => {
  try {
    const { rows } = await DevicesMachineService.listMachineMaintenance(pool, req.params.id);
    return success(res, rows);
  } catch (err) { next(err); }
});

router.post('/machines/:id/maintenance', auth, rbac(['admin', 'head_nurse']), async (req, res, next) => {
  try {
    const valid = validateMachineMaintenancePayload(req.body);
    if (!valid.ok) return error(res, valid.message);
    const { rows } = await DevicesMachineService.createMachineMaintenance(
      pool,
      req.params.id,
      valid.value,
      req.user.id,
    );
    return created(res, rows[0], '维护记录已保存');
  } catch (err) { next(err); }
});

router.get('/machines/:id/alerts', auth, async (req, res, next) => {
  try {
    const { rows } = await DevicesMachineService.listMachineAlerts(pool, req.params.id);
    return success(res, rows);
  } catch (err) { next(err); }
});

router.post('/machines/:id/alerts', auth, rbac(['admin', 'head_nurse']), async (req, res, next) => {
  try {
    const valid = normalizeMachineAlertPayload(req.body);
    if (!valid.ok) return error(res, valid.message);
    const { rows } = await DevicesMachineService.createMachineAlert(
      pool,
      req.params.id,
      valid.value,
    );
    return created(res, rows[0], '设备异常报警已登记');
  } catch (err) { next(err); }
});

// ── 水机台账与维护 ─────────────────────────────────────────

router.get('/water-machines', auth, async (req, res, next) => {
  try {
    const { rows } = await DevicesWaterService.listWaterMachines(pool);
    return success(res, rows);
  } catch (err) {
    // 表不存在时（尚未执行迁移），返回空列表而不是 500，避免前端报错
    if (err.code === '42P01') {
      return success(res, []);
    }
    next(err);
  }
});

router.post('/water-machines', auth, rbac(['admin', 'head_nurse', 'nurse']), async (req, res, next) => {
  try {
    const valid = validateWaterMachineCreatePayload(req.body);
    if (!valid.ok) return error(res, valid.message);
    const { rows } = await DevicesWaterService.createWaterMachine(pool, valid.value);
    return created(res, rows[0], '水机已登记');
  } catch (err) { next(err); }
});

router.delete('/water-machines/:id', auth, rbac(['admin', 'head_nurse', 'technician']), async (req, res, next) => {
  try {
    const { rows } = await DevicesWaterService.deleteWaterMachine(pool, req.params.id);
    if (rows.length === 0) return notFound(res, '水机不存在');
    return success(res, rows[0], '水机已删除');
  } catch (err) {
    if (err?.code === PG_FOREIGN_KEY_VIOLATION) {
      return error(res, '该水机已被维护/水质/日常检测记录引用，无法删除。请先处理关联数据。', 400);
    }
    next(err);
  }
});

router.get('/water-machines/:id/maintenance', auth, async (req, res, next) => {
  try {
    const { rows } = await DevicesWaterService.listWaterMachineMaintenance(pool, req.params.id);
    return success(res, rows);
  } catch (err) { next(err); }
});

router.post('/water-machines/:id/maintenance', auth, rbac(['admin', 'head_nurse', 'nurse']), async (req, res, next) => {
  try {
    const valid = validateWaterMachineMaintenancePayload(req.body);
    if (!valid.ok) return error(res, valid.message);
    const { rows } = await DevicesWaterService.createWaterMachineMaintenance(
      pool,
      req.params.id,
      valid.value,
      req.user.id,
    );
    return created(res, rows[0], '水机维护记录已保存');
  } catch (err) { next(err); }
});

// ── 兼容旧路径：设备维护（已废弃，指向 machine_maintenance）──────────

router.get('/maintenance', auth, async (req, res, next) => {
  try {
    const valid = normalizeMaintenanceListQuery(req.query);
    if (!valid.ok) return error(res, valid.message, valid.statusCode || 400);
    const { rows } = await DevicesWaterService.listLegacyMaintenance(pool, valid.value);
    return success(res, rows);
  } catch (err) { next(err); }
});

router.post('/maintenance', auth, rbac(['admin', 'head_nurse']), async (req, res, next) => {
  try {
    const valid = validateLegacyMaintenancePayload(req.body);
    if (!valid.ok) return error(res, valid.message);
    const { rows } = await DevicesWaterService.createLegacyMaintenance(pool, valid.value, req.user.id);
    return created(res, rows[0], '维护记录已保存');
  } catch (err) { next(err); }
});

// ── 水质检测记录 ──────────────────────────────────────────

router.get('/water-quality', auth, async (req, res, next) => {
  try {
    const valid = normalizeWaterQualityListQuery(req.query);
    if (!valid.ok) return error(res, valid.message, valid.statusCode || 400);
    const rows = await DevicesWaterQualityService.listWaterQuality(pool, valid.value);
    return success(res, rows);
  } catch (err) {
    // 若旧环境尚未创建 water_quality_records 表，则容忍并返回空数组
    if (err.code === '42P01') {
      return success(res, []);
    }
    // 未执行 055 迁移时 wq.water_machine_id 不存在
    if (
      err.code === PG_UNDEFINED_COLUMN
      && (err.column === 'water_machine_id' || String(err.message || '').includes('water_machine_id'))
    ) {
      return error(res, '请先执行数据库迁移（含 water_quality_records.water_machine_id）', 503);
    }
    next(err);
  }
});

router.post('/water-quality', auth, rbac(['admin', 'head_nurse', 'nurse']), async (req, res, next) => {
  try {
    const valid = normalizeWaterQualityCreatePayload(req.body);
    if (!valid.ok) return error(res, valid.message, valid.statusCode || 400);
    const row = await DevicesWaterQualityService.createWaterQuality(pool, valid.value, req.user.id);
    return created(res, row, '水质检测记录已保存');
  } catch (err) {
    if (err.statusCode === 400) {
      return error(res, err.message || '请求参数无效', 400);
    }
    if (err.code === PG_FOREIGN_KEY_VIOLATION) {
      return error(res, '关联的水机不存在或数据不一致', 400);
    }
    next(err);
  }
});

// ── 水处理日常检测记录（硬度、压差、电导等）────────────────

router.get('/water-daily-inspections', auth, async (req, res, next) => {
  try {
    const valid = normalizeWaterDailyInspectionListQuery(req.query);
    if (!valid.ok) return error(res, valid.message, valid.statusCode || 400);
    const { rows } = await DevicesWaterService.listWaterDailyInspections(pool, valid.value);
    return success(res, rows);
  } catch (err) {
    if (err.code === '42P01') {
      return success(res, []);
    }
    next(err);
  }
});

router.post('/water-daily-inspections', auth, rbac(['admin', 'head_nurse', 'nurse']), async (req, res, next) => {
  try {
    const valid = validateWaterDailyInspectionCreatePayload(req.body);
    if (!valid.ok) return error(res, valid.message, valid.statusCode || 400);
    const row = await DevicesWaterService.createWaterDailyInspection(pool, valid.value, req.user.id);
    return created(res, row, '日常检测记录已保存');
  } catch (err) {
    if (err.statusCode === 400) {
      return error(res, err.message || '请求参数无效', 400);
    }
    if (err.code === '42P01') {
      return error(res, '请先执行数据库迁移以创建 water_daily_inspections 表', 503);
    }
    if (err.code === PG_FOREIGN_KEY_VIOLATION) {
      return error(res, '关联的水机不存在或数据不一致', 400);
    }
    next(err);
  }
});

// ── 耗材库存 ──────────────────────────────────────────────

router.get('/consumables', auth, async (req, res, next) => {
  try {
    const { rows } = await DevicesConsumablesService.listConsumables(pool);
    return success(res, rows);
  } catch (err) { next(err); }
});

router.post('/consumables', auth, rbac(['admin', 'head_nurse']), async (req, res, next) => {
  try {
    const valid = validateConsumableCreatePayload(req.body);
    if (!valid.ok) return error(res, valid.message);
    const { rows } = await DevicesConsumablesService.createConsumable(pool, valid.value, req.user.id);
    return created(res, rows[0], '耗材目录已创建');
  } catch (err) { next(err); }
});

router.delete('/consumables/:id', auth, rbac(['admin', 'head_nurse', 'technician']), async (req, res, next) => {
  try {
    const { rows } = await DevicesConsumablesService.deleteConsumable(pool, req.params.id);
    if (rows.length === 0) return notFound(res, '耗材目录不存在');
    return success(res, rows[0], '耗材目录已删除');
  } catch (err) {
    if (err?.code === PG_FOREIGN_KEY_VIOLATION) {
      return error(res, '该耗材目录已存在入库批次或出库记录，无法删除。请先处理关联数据。', 400);
    }
    next(err);
  }
});

router.get('/consumables/:id/last-inbound', auth, async (req, res, next) => {
  try {
    const { rows } = await DevicesConsumablesService.getConsumableLastInbound(pool, req.params.id);
    return success(res, rows[0] || null);
  } catch (err) { next(err); }
});

router.post('/consumables/inbound', auth, rbac(['admin', 'head_nurse', 'nurse']), async (req, res, next) => {
  try {
    const valid = validateConsumableInboundPayload(req.body);
    if (!valid.ok) return error(res, valid.message);
    const row = await DevicesConsumablesService.inboundConsumable(pool, valid.value, req.user.id);
    return created(res, row, '入库成功');
  } catch (err) { next(err); }
});

router.get('/consumables/outbound-lines', auth, async (req, res, next) => {
  try {
    const valid = normalizeConsumableOutboundLinesQuery(req.query);
    if (!valid.ok) return error(res, valid.message, valid.statusCode || 400);
    const { rows } = await DevicesConsumablesService.listConsumableOutboundLines(pool, valid.value);
    return success(res, rows);
  } catch (err) { next(err); }
});

router.get('/consumables/patient-usage', auth, async (req, res, next) => {
  try {
    const valid = validateConsumablePatientUsageQuery(req.query);
    if (!valid.ok) return error(res, valid.message, valid.statusCode || 400);
    const { rows } = await DevicesConsumablesService.listConsumablePatientUsage(pool, valid.value);
    return success(res, rows);
  } catch (err) { next(err); }
});

router.get('/consumables/today-summary', auth, async (req, res, next) => {
  try {
    const data = await DevicesConsumablesService.getConsumablesTodaySummary(pool);
    return success(res, data);
  } catch (err) { next(err); }
});

router.patch('/consumables/:id/stock', auth, rbac(['admin', 'head_nurse', 'nurse']), async (req, res, next) => {
  try {
    const valid = validateConsumableStockPatchPayload(req.body);
    if (!valid.ok) return error(res, valid.message, valid.statusCode || 400);
    const { rows } = await DevicesConsumablesService.patchConsumableStock(
      pool,
      req.params.id,
      valid.value,
      req.user.id,
    );
    if (rows.length === 0) return notFound(res, '耗材记录不存在');
    return success(res, rows[0], '库存已更新');
  } catch (err) { next(err); }
});

module.exports = router;
