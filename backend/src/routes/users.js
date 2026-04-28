/**
 * 系统用户 REST 路由（仅管理员）
 * 主要作用：维护登录账号、角色与基础资料，落实 RBAC 账号侧配置。
 * 主要功能：用户列表与分页；创建/更新/禁用；密码哈希存储；操作审计。
 */
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool } = require('../config/database');
const auth = require('../middleware/auth');
const { rbac } = require('../middleware/rbac');
const auditLog = require('../middleware/audit');
const { success, created, paginated, error, notFound } = require('../utils/response');

/** 与 DB users_role_check 及 rbac 中间件一致；qc 与 quality 并存 */
const VALID_ROLES = ['admin', 'doctor', 'nurse', 'head_nurse', 'technician', 'qc', 'quality'];

/** 与前端侧栏 menu key 一致；menu_permissions 为 JSON 数组白名单 */
const ALLOWED_MENU_KEYS = new Set([
  '/dashboard',
  '/alerts',
  '/patients',
  '/dialysis/today',
  '/dialysis/entry',
  '/prescription',
  '/orders',
  '/labs',
  '/vascular',
  '/infection',
  '/schedule',
  '/reports',
  '/cqi',
  '/ai/assistant',
  '/ai/guidelines',
  '/ai/knowledge',
  '/ai/sites',
  '/devices',
  '/admin/users',
  // AI 分析助手子功能（与前端 aiAssistantFeatures 一致）
  'ai_feat:patient_trend',
  'ai_feat:labs_analysis',
  'ai_feat:ktv',
  'ai_feat:cvc',
  'ai_feat:nlp',
  'ai_feat:medication',
  'ai_feat:anomaly',
]);

const ADMIN_ONLY_MENU_KEYS = new Set(['/admin/users', '/ai/sites']);
const CLINICAL_AI_MENU_KEYS = new Set(['/ai/assistant', '/ai/guidelines', '/ai/knowledge']);
const AI_FEATURE_PREFIX = 'ai_feat:';

function canRoleAccessClinicalAi(role) {
  return ['admin', 'doctor', 'head_nurse'].includes(role);
}

/**
 * @param {string} role
 * @param {unknown} raw
 * @returns {string[] | null}
 */
function normalizeMenuPermissions(role, raw) {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  let filtered = raw.filter((k) => typeof k === 'string' && ALLOWED_MENU_KEYS.has(k));
  if (role !== 'admin') {
    filtered = filtered.filter((k) => !ADMIN_ONLY_MENU_KEYS.has(k));
  }
  if (!canRoleAccessClinicalAi(role)) {
    filtered = filtered.filter(
      (k) => !CLINICAL_AI_MENU_KEYS.has(k) && !String(k).startsWith(AI_FEATURE_PREFIX),
    );
  }
  return filtered;
}

/**
 * node-pg 将 JS 数组绑定为 PostgreSQL text[]，直接写入 JSONB 会触发 22P02；
 * 必须传 JSON 文本并由库侧转为 jsonb。
 * @param {string[] | null | undefined} mp
 * @returns {string | null}
 */
function menuPermissionsJsonbParam(mp) {
  if (mp === null || mp === undefined) return null;
  return JSON.stringify(mp);
}

/** 与认证策略一致：至少 6 位，仅 ASCII 字母与数字 */
const PASSWORD_ALLOWED = /^[A-Za-z0-9]+$/;
const USERNAME_MAX_LENGTH = 50;
const REAL_NAME_MAX_LENGTH = 50;

function validatePasswordStrength(password) {
  const text = String(password || '');
  if (text.length < 6) return '密码不能少于6位';
  if (!PASSWORD_ALLOWED.test(text)) return '密码只能包含字母与数字';
  return null;
}

function normalizeTextInput(value) {
  if (value === undefined || value === null) return undefined;
  return String(value).trim();
}

function generateTemporaryPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 10; i += 1) {
    out += chars[crypto.randomInt(0, chars.length)];
  }
  return out;
}

function validateUsername(username) {
  if (!username) return '用户名不能为空';
  if (username.length > USERNAME_MAX_LENGTH) return `用户名不能超过${USERNAME_MAX_LENGTH}个字符`;
  return null;
}

function validateRealName(realName) {
  if (!realName) return '姓名不能为空';
  if (realName.length > REAL_NAME_MAX_LENGTH) return `姓名不能超过${REAL_NAME_MAX_LENGTH}个字符`;
  return null;
}

// GET /api/users/nursing-staff — 本科室已启用护理人员（责任护士等下拉，须在 GET / 之前避免被误匹配）
router.get('/nursing-staff', auth, rbac(['admin', 'doctor']), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, real_name, role
       FROM users
       WHERE role IN ('nurse', 'head_nurse') AND is_active = true
       ORDER BY real_name ASC`
    );
    return success(res, rows);
  } catch (err) { next(err); }
});

// GET /api/users
router.get('/', auth, rbac(['admin']), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, username, real_name, role, is_active, menu_permissions, last_login_at, created_at
       FROM users ORDER BY role, real_name`
    );
    return success(res, rows);
  } catch (err) { next(err); }
});

// POST /api/users
router.post('/', auth, rbac(['admin']), auditLog('users', 'CREATE'), async (req, res, next) => {
  try {
    const { username, real_name, role, password, menu_permissions: menuPermsBody } = req.body;
    const normalizedUsername = normalizeTextInput(username);
    const normalizedRealName = normalizeTextInput(real_name);

    if (!normalizedUsername || !normalizedRealName || !role || !password) {
      return error(res, '用户名、姓名、角色、密码均为必填项');
    }
    const usernameErr = validateUsername(normalizedUsername);
    if (usernameErr) return error(res, usernameErr);
    const realNameErr = validateRealName(normalizedRealName);
    if (realNameErr) return error(res, realNameErr);
    if (!VALID_ROLES.includes(role)) {
      return error(res, `角色必须是以下之一：${VALID_ROLES.join('、')}`);
    }
    const pwdErr = validatePasswordStrength(password);
    if (pwdErr) return error(res, pwdErr);

    const menu_permissions = normalizeMenuPermissions(role, menuPermsBody);

    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      `INSERT INTO users (username, real_name, role, password_hash, menu_permissions)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING id, username, real_name, role, is_active, menu_permissions, created_at`,
      [normalizedUsername, normalizedRealName, role, hash, menuPermissionsJsonbParam(menu_permissions)]
    );
    return created(res, rows[0], '用户创建成功');
  } catch (err) {
    if (err.code === '23505') return error(res, '用户名已存在');
    next(err);
  }
});

// PUT /api/users/:id
router.put('/:id', auth, rbac(['admin']), auditLog('users', 'UPDATE'), async (req, res, next) => {
  try {
    const { username, real_name, role, menu_permissions: menuPermsBody } = req.body;
    const { id } = req.params;
    const normalizedUsername = normalizeTextInput(username);
    const normalizedRealName = normalizeTextInput(real_name);

    if (role && !VALID_ROLES.includes(role)) {
      return error(res, `角色无效`);
    }

    const { rows: existingRows } = await pool.query(
      'SELECT role FROM users WHERE id = $1',
      [id]
    );
    if (existingRows.length === 0) return notFound(res, '用户不存在');
    const effectiveRole = role || existingRows[0].role;

    let menuPatch;
    if (Object.prototype.hasOwnProperty.call(req.body, 'menu_permissions')) {
      menuPatch = normalizeMenuPermissions(effectiveRole, menuPermsBody);
    }

    const sets = [];
    const params = [];
    let paramIdx = 1;

    if (username !== undefined && username !== null) {
      const usernameErr = validateUsername(normalizedUsername);
      if (usernameErr) return error(res, usernameErr);
      sets.push(`username = $${paramIdx++}`);
      params.push(normalizedUsername);
    }
    if (real_name !== undefined && real_name !== null) {
      const realNameErr = validateRealName(normalizedRealName);
      if (realNameErr) return error(res, realNameErr);
      sets.push(`real_name = $${paramIdx++}`);
      params.push(normalizedRealName);
    }
    if (role !== undefined && role !== null) {
      sets.push(`role = $${paramIdx++}`);
      params.push(role);
    }
    if (menuPatch !== undefined) {
      sets.push(`menu_permissions = $${paramIdx++}::jsonb`);
      params.push(menuPermissionsJsonbParam(menuPatch));
    }

    if (sets.length === 0) {
      const { rows: cur } = await pool.query(
        'SELECT id, username, real_name, role, is_active, menu_permissions FROM users WHERE id = $1',
        [id]
      );
      return success(res, cur[0], '用户信息更新成功');
    }

    sets.push('updated_at = NOW()');
    params.push(id);

    const { rows } = await pool.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${paramIdx} RETURNING id, username, real_name, role, is_active, menu_permissions`,
      params
    );

    if (rows.length === 0) return notFound(res, '用户不存在');

    let row = rows[0];
    if (effectiveRole !== 'admin' && row.menu_permissions && Array.isArray(row.menu_permissions)) {
      const filtered = row.menu_permissions.filter((k) => !ADMIN_ONLY_MENU_KEYS.has(k));
      if (filtered.length !== row.menu_permissions.length) {
        const { rows: r2 } = await pool.query(
          `UPDATE users SET menu_permissions = $1::jsonb, updated_at = NOW() WHERE id = $2
           RETURNING id, username, real_name, role, is_active, menu_permissions`,
          [menuPermissionsJsonbParam(filtered.length ? filtered : null), id]
        );
        row = r2[0];
      }
    }

    return success(res, row, '用户信息更新成功');
  } catch (err) {
    if (err.code === '23505') return error(res, '用户名已存在');
    next(err);
  }
});

// PATCH /api/users/:id/toggle-active
router.patch('/:id/toggle-active', auth, rbac(['admin']), auditLog('users', 'UPDATE'), async (req, res, next) => {
  try {
    // 防止管理员禁用自己
    if (String(req.params.id) === String(req.user.id)) {
      return error(res, '不能禁用自己的账号');
    }

    const { rows } = await pool.query(
      `UPDATE users SET is_active = NOT is_active, updated_at = NOW()
       WHERE id = $1
       RETURNING id, username, real_name, role, is_active`,
      [req.params.id]
    );

    if (rows.length === 0) return notFound(res, '用户不存在');
    const action = rows[0].is_active ? '启用' : '禁用';
    return success(res, rows[0], `用户已${action}`);
  } catch (err) { next(err); }
});

// PATCH /api/users/:id/password — 管理员重置他人密码（未传 new_password 时自动生成临时密码）
router.patch('/:id/password', auth, rbac(['admin']), async (req, res, next) => {
  try {
    const { id } = req.params;
    const inputPassword = normalizeTextInput(req.body?.new_password);
    const newPassword = inputPassword || generateTemporaryPassword();

    const pwdErr = validatePasswordStrength(newPassword);
    if (pwdErr) return error(res, pwdErr);

    const newHash = await bcrypt.hash(newPassword, 12);
    const { rows } = await pool.query(
      `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2
       RETURNING id, username, real_name, role`,
      [newHash, id]
    );

    if (rows.length === 0) return notFound(res, '用户不存在');

    try {
      await pool.query(
        `INSERT INTO audit_logs
           (user_id, user_name, user_role, action, table_name, record_id, new_values, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          req.user?.id || null,
          req.user?.real_name || '系统',
          req.user?.role || null,
          'UPDATE',
          'users',
          id,
          JSON.stringify({ password_reset_by_admin: true, target_username: rows[0].username }),
          req.ip || req.socket?.remoteAddress,
        ]
      );
    } catch (auditErr) {
      // 审计失败不阻断业务
    }

    return success(
      res,
      { id: rows[0].id, username: rows[0].username, temporary_password: newPassword },
      '密码已重置（系统生成密码仅本次返回）',
    );
  } catch (err) { next(err); }
});

// DELETE /api/users/:id — 管理员删除用户（仅未被业务数据引用时可删）
router.delete('/:id', auth, rbac(['admin']), auditLog('users', 'DELETE'), async (req, res, next) => {
  try {
    const { id } = req.params;
    if (String(id) === String(req.user.id)) {
      return error(res, '不能删除自己的账号');
    }

    const { rows: existsRows } = await pool.query(
      'SELECT id, username, real_name, role FROM users WHERE id = $1',
      [id],
    );
    if (existsRows.length === 0) return notFound(res, '用户不存在');
    const target = existsRows[0];

    if (target.role === 'admin') {
      const { rows: adminCountRows } = await pool.query(
        "SELECT COUNT(*)::int AS c FROM users WHERE role = 'admin' AND is_active = true",
      );
      const activeAdminCount = adminCountRows[0]?.c || 0;
      if (activeAdminCount <= 1) {
        return error(res, '系统至少保留 1 个启用中的管理员，无法删除');
      }
    }

    const { rows } = await pool.query(
      'DELETE FROM users WHERE id = $1 RETURNING id, username, real_name, role',
      [id],
    );
    if (rows.length === 0) return notFound(res, '用户不存在');
    return success(res, rows[0], '用户已删除');
  } catch (err) {
    if (err?.code === '23503') {
      return error(res, '该用户已被业务数据引用，无法删除。请改为禁用账号。');
    }
    next(err);
  }
});

// GET /api/audit-logs（审计日志查询）
router.get('/audit-logs', auth, rbac(['admin']), async (req, res, next) => {
  try {
    const { user_id, table_name, action, start_date, end_date, page = 1, page_size = 30 } = req.query;
    const offset = (page - 1) * page_size;

    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (user_id)    { conditions.push(`user_id = $${paramIdx++}`);   params.push(user_id); }
    if (table_name) { conditions.push(`table_name = $${paramIdx++}`); params.push(table_name); }
    if (action)     { conditions.push(`action = $${paramIdx++}`);    params.push(action); }
    if (start_date) { conditions.push(`created_at >= $${paramIdx++}`); params.push(start_date); }
    if (end_date)   { conditions.push(`created_at <= $${paramIdx++}`); params.push(end_date + ' 23:59:59'); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const countResult = await pool.query(`SELECT COUNT(*) FROM audit_logs ${where}`, params);
    const total = parseInt(countResult.rows[0].count);

    const { rows } = await pool.query(
      `SELECT id, user_name, user_role, action, table_name, record_id, new_values, ip_address, created_at
       FROM audit_logs ${where}
       ORDER BY created_at DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, page_size, offset]
    );

    return paginated(res, rows, total, page, page_size);
  } catch (err) { next(err); }
});

module.exports = router;
