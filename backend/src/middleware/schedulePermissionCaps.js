/**
 * 排班 menu_permissions 细分（与前端 constants/sidebarModules SCHEDULE_PERMISSION_KEYS 一致）
 * legacy：`/schedule` 表示患者+护士排班全部可读可改（与旧数据兼容）
 */
const { forbidden } = require('../utils/response');

const SCHEDULE_LEGACY = '/schedule';
const SCHEDULE_PATIENT_READ = 'schedule_patient:read';
const SCHEDULE_PATIENT_WRITE = 'schedule_patient:write';
const SCHEDULE_NURSE_READ = 'schedule_nurse:read';
const SCHEDULE_NURSE_WRITE = 'schedule_nurse:write';

/**
 * @param {{ menu_permissions?: unknown, role?: string }} user — JWT payload
 */
function resolveScheduleCaps(user) {
  const mp = user?.menu_permissions;
  const unrestricted = mp === null || mp === undefined;
  if (unrestricted) {
    return {
      unrestricted: true,
      patientRead: true,
      patientWrite: true,
      nurseRead: true,
      nurseWrite: true,
    };
  }
  if (!Array.isArray(mp)) {
    return {
      unrestricted: false,
      patientRead: false,
      patientWrite: false,
      nurseRead: false,
      nurseWrite: false,
    };
  }
  if (mp.includes(SCHEDULE_LEGACY)) {
    return {
      unrestricted: false,
      patientRead: true,
      patientWrite: true,
      nurseRead: true,
      nurseWrite: true,
    };
  }
  const patientRead = mp.includes(SCHEDULE_PATIENT_READ) || mp.includes(SCHEDULE_PATIENT_WRITE);
  const patientWrite = mp.includes(SCHEDULE_PATIENT_WRITE);
  const nurseRead = mp.includes(SCHEDULE_NURSE_READ) || mp.includes(SCHEDULE_NURSE_WRITE);
  const nurseWrite = mp.includes(SCHEDULE_NURSE_WRITE);
  return {
    unrestricted: false,
    patientRead,
    patientWrite,
    nurseRead,
    nurseWrite,
  };
}

function requireScheduleWeekView(req, res, next) {
  const c = resolveScheduleCaps(req.user);
  if (c.unrestricted || c.patientRead || c.nurseRead) return next();
  return forbidden(res, '无排班周视图权限');
}

function requireSchedulePatientRead(req, res, next) {
  const c = resolveScheduleCaps(req.user);
  if (c.unrestricted || c.patientRead) return next();
  return forbidden(res, '无患者排班查看权限');
}

function requireScheduleNurseRead(req, res, next) {
  const c = resolveScheduleCaps(req.user);
  if (c.unrestricted || c.nurseRead) return next();
  return forbidden(res, '无护士排班查看权限');
}

/** 在 rbac(['admin','head_nurse']) 之后挂载：按账号菜单细分是否允许改患者排班 */
function requireSchedulePatientWrite(req, res, next) {
  const c = resolveScheduleCaps(req.user);
  if (c.unrestricted || c.patientWrite) return next();
  return forbidden(res, '无患者排班修改权限');
}

/** 在 rbac(['admin','head_nurse']) 之后挂载 */
function requireScheduleNurseWrite(req, res, next) {
  const c = resolveScheduleCaps(req.user);
  if (c.unrestricted || c.nurseWrite) return next();
  return forbidden(res, '无护士排班修改权限');
}

module.exports = {
  resolveScheduleCaps,
  SCHEDULE_LEGACY,
  SCHEDULE_PATIENT_READ,
  SCHEDULE_PATIENT_WRITE,
  SCHEDULE_NURSE_READ,
  SCHEDULE_NURSE_WRITE,
  requireScheduleWeekView,
  requireSchedulePatientRead,
  requireScheduleNurseRead,
  requireSchedulePatientWrite,
  requireScheduleNurseWrite,
};
