/**
 * 系统用户角色中文展示（与后端 users.role 枚举一致）
 */
export const ROLE_LABELS: Record<string, string> = {
  admin: '超级管理员',
  head_nurse: '护士长',
  nurse: '责任护士',
  technician: '技师',
  doctor: '主治医生',
  quality: '质控人员',
  qc: '质控人员',
};
