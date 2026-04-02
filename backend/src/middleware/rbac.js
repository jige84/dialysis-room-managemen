/**
 * RBAC 角色权限控制中间件
 * 主要作用：在 JWT 认证之后按角色白名单拦截接口，落实五类用户权限边界。
 * 主要功能：rbac(allowedRoles) 与 requireMinRole；基于 ROLE_LEVELS 的最小职级校验；无权限返回 403。
 */
const { forbidden } = require('../utils/response');

/**
 * 角色层级（数字越大权限越高）
 */
const ROLE_LEVELS = {
  quality:    1,   // 质控（只读）
  qc:         1,   // 与 quality 等价（历史种子/账号兼容）
  nurse:      2,   // 护士
  doctor:     3,   // 医生
  head_nurse: 4,   // 护士长
  admin:      5,   // 超级管理员
};

/** 白名单中 quality 与 qc 视为同一角色 */
function expandAllowedRoles(allowedRoles) {
  const s = new Set(allowedRoles);
  if (s.has('quality')) s.add('qc');
  if (s.has('qc')) s.add('quality');
  return s;
}

/**
 * 检查是否有指定角色权限
 * @param {string[]} allowedRoles 允许的角色列表
 */
function rbac(allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return forbidden(res, '未认证，无法进行权限校验');
    }

    const userRole = req.user.role;

    // admin 拥有所有权限
    if (userRole === 'admin') return next();

    const allowed = expandAllowedRoles(allowedRoles);
    if (!allowed.has(userRole)) {
      return forbidden(res, `权限不足，需要以下角色之一：${allowedRoles.join('、')}`);
    }

    next();
  };
}

/**
 * 检查最低角色等级
 * @param {string} minRole 最低要求角色
 */
function minRole(minRoleStr) {
  return (req, res, next) => {
    if (!req.user) return forbidden(res, '未认证');
    const userLevel = ROLE_LEVELS[req.user.role] ?? 0;
    const minLevel = ROLE_LEVELS[minRoleStr] ?? 999;
    if (userLevel < minLevel) {
      return forbidden(res, '权限不足');
    }
    next();
  };
}

module.exports = { rbac, minRole };
