/**
 * 系统用户 API（仅管理员后端放行）
 */
import request, { type ApiResponse } from './request';

export type SystemUserRole = 'admin' | 'doctor' | 'nurse' | 'head_nurse' | 'technician' | 'qc' | 'quality';

export interface UserRow {
  id: string;
  username: string;
  real_name: string;
  role: SystemUserRole;
  is_active: boolean;
  /** 侧栏模块白名单；null 表示不限制 */
  menu_permissions?: string[] | null;
  last_login_at: string | null;
  created_at: string;
}

export interface CreateUserPayload {
  username: string;
  real_name: string;
  role: SystemUserRole;
  password: string;
  /** 不传或 null 表示不限制侧栏 */
  menu_permissions?: string[] | null;
}

export interface UpdateUserPayload {
  real_name?: string;
  role?: SystemUserRole;
  /** 显式传入 null 表示取消限制；不传则不修改 */
  menu_permissions?: string[] | null;
}

/** GET /users/nursing-staff — 本科室已启用护士/护士长（患者责任护士下拉） */
export interface NursingStaffRow {
  id: string;
  real_name: string;
  role: 'nurse' | 'head_nurse';
}

export const usersApi = {
  list: () => request.get<ApiResponse<UserRow[]>>('/users'),

  /** 护理人员选项（管理员/医生） */
  nursingStaff: () =>
    request.get<ApiResponse<NursingStaffRow[]>>('/users/nursing-staff'),

  create: (payload: CreateUserPayload) =>
    request.post<ApiResponse<UserRow>>('/users', payload),

  update: (id: string, payload: UpdateUserPayload) =>
    request.put<ApiResponse<UserRow>>(`/users/${id}`, payload),

  toggleActive: (id: string) =>
    request.patch<ApiResponse<UserRow>>(`/users/${id}/toggle-active`),

  resetPassword: (id: string, new_password: string) =>
    request.patch<ApiResponse<{ id: string; username: string }>>(`/users/${id}/password`, {
      new_password,
    }),

  remove: (id: string) =>
    request.delete<ApiResponse<{ id: string; username: string; real_name: string; role: SystemUserRole }>>(`/users/${id}`),
};
