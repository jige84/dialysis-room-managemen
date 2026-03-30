/**
 * 系统用户 REST 路由（仅管理员）
 * 主要作用：维护登录账号、角色与基础资料，落实 RBAC 账号侧配置。
 * 主要功能：用户列表与分页；创建/更新/禁用；密码哈希存储；操作审计。
 */
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { pool } = require('../config/database');
const auth = require('../middleware/auth');
const { rbac } = require('../middleware/rbac');
const auditLog = require('../middleware/audit');
const { success, created, paginated, error, notFound } = require('../utils/response');

const VALID_ROLES = ['admin', 'doctor', 'nurse', 'head_nurse', 'qc'];

// GET /api/users
router.get('/', auth, rbac(['admin']), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, username, real_name, role, is_active, last_login_at, created_at
       FROM users ORDER BY role, real_name`
    );
    return success(res, rows);
  } catch (err) { next(err); }
});

// POST /api/users
router.post('/', auth, rbac(['admin']), auditLog('users', 'CREATE'), async (req, res, next) => {
  try {
    const { username, real_name, role, password } = req.body;

    if (!username || !real_name || !role || !password) {
      return error(res, '用户名、姓名、角色、密码均为必填项');
    }
    if (!VALID_ROLES.includes(role)) {
      return error(res, `角色必须是以下之一：${VALID_ROLES.join('、')}`);
    }
    if (password.length < 8) {
      return error(res, '密码不能少于8位');
    }

    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      `INSERT INTO users (username, real_name, role, password_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, username, real_name, role, is_active, created_at`,
      [username, real_name, role, hash]
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
    const { real_name, role } = req.body;
    const { id } = req.params;

    if (role && !VALID_ROLES.includes(role)) {
      return error(res, `角色无效`);
    }

    const { rows } = await pool.query(
      `UPDATE users SET
         real_name = COALESCE($1, real_name),
         role = COALESCE($2, role),
         updated_at = NOW()
       WHERE id = $3
       RETURNING id, username, real_name, role, is_active`,
      [real_name, role, id]
    );

    if (rows.length === 0) return notFound(res, '用户不存在');
    return success(res, rows[0], '用户信息更新成功');
  } catch (err) { next(err); }
});

// PATCH /api/users/:id/toggle-active
router.patch('/:id/toggle-active', auth, rbac(['admin']), auditLog('users', 'UPDATE'), async (req, res, next) => {
  try {
    // 防止管理员禁用自己
    if (req.params.id === req.user.id) {
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
