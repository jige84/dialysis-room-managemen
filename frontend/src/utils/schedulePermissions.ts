/**
 * 与后端 middleware/schedulePermissionCaps.js 一致：解析 menu_permissions 中的排班能力
 */
import { normalizeMenuPermissions } from './menuAccess';

export type ScheduleCaps = {
  unrestricted: boolean;
  patientRead: boolean;
  patientWrite: boolean;
  nurseRead: boolean;
  nurseWrite: boolean;
};

export function resolveScheduleCaps(menuPermissions: unknown): ScheduleCaps {
  const mp = normalizeMenuPermissions(menuPermissions);
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
  if (mp.includes('/schedule')) {
    return {
      unrestricted: false,
      patientRead: true,
      patientWrite: true,
      nurseRead: true,
      nurseWrite: true,
    };
  }
  const patientRead = mp.includes('schedule_patient:read') || mp.includes('schedule_patient:write');
  const patientWrite = mp.includes('schedule_patient:write');
  const nurseRead = mp.includes('schedule_nurse:read') || mp.includes('schedule_nurse:write');
  const nurseWrite = mp.includes('schedule_nurse:write');
  return {
    unrestricted: false,
    patientRead,
    patientWrite,
    nurseRead,
    nurseWrite,
  };
}

/** 是否具备访问排班页所需任一查看权限（用于菜单 /schedule） */
export function canAccessScheduleMenu(menuPermissions: unknown): boolean {
  const c = resolveScheduleCaps(menuPermissions);
  return c.unrestricted || c.patientRead || c.nurseRead;
}
