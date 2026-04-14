/**
 * 认证 REST 路由（登录、退出、修改密码）
 * 主要作用：完成身份校验与 JWT 签发，支撑全站登录态与登出吊销。
 * 主要功能：账号密码登录；bcrypt 校验；签发含 jti 的 Token；Redis 黑名单；改密校验。
 */
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const { cache } = require('../config/redis');
const auth = require('../middleware/auth');
const { validateLoginPayload, validateChangePasswordPayload } = require('../validators/authValidators');
const { success, error, unauthorized } = require('../utils/response');
require('dotenv').config();

// 登录失败计数（内存，生产环境应存Redis）
const loginAttempts = new Map();
const LOGIN_MAX_ATTEMPTS = Math.max(1, parseInt(process.env.LOGIN_MAX_ATTEMPTS || '5', 10));
const LOGIN_LOCK_MINUTES = Math.max(1, parseInt(process.env.LOGIN_LOCK_MINUTES || '30', 10));
const LOGIN_CACHE_PREFIX = 'login_attempts:';

function loginAttemptKey(username) {
  return `${LOGIN_CACHE_PREFIX}${String(username || '').trim().toLowerCase()}`;
}

async function getLoginAttemptRecord(username) {
  const key = loginAttemptKey(username);
  const cached = await cache.get(key);
  if (cached && typeof cached === 'object') {
    return {
      count: Number(cached.count) || 0,
      lockedUntil: Number(cached.lockedUntil) || 0,
    };
  }
  return loginAttempts.get(key) || { count: 0, lockedUntil: 0 };
}

async function persistLoginAttemptRecord(username, record) {
  const key = loginAttemptKey(username);
  const ttlSeconds = Math.max(LOGIN_LOCK_MINUTES * 60, 30 * 60);
  const saved = await cache.set(key, record, ttlSeconds);
  if (saved) {
    loginAttempts.delete(key);
    return;
  }
  loginAttempts.set(key, record);
}

async function clearLoginAttemptRecord(username) {
  const key = loginAttemptKey(username);
  await cache.del(key);
  loginAttempts.delete(key);
}

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const valid = validateLoginPayload(req.body);
    if (!valid.ok) return error(res, valid.message);

    const { username, password } = valid.value;

    // 检查登录失败次数
    const attempts = await getLoginAttemptRecord(username);
    if (attempts.lockedUntil > Date.now()) {
      const mins = Math.ceil((attempts.lockedUntil - Date.now()) / 60000);
      return error(res, `账号已锁定，请 ${mins} 分钟后重试`, 429);
    }

    const { rows } = await pool.query(
      'SELECT id, username, password_hash, real_name, role, is_active, menu_permissions FROM users WHERE username = $1',
      [username]
    );

    if (rows.length === 0) {
      const failed = await recordFailedAttempt(username);
      if (failed.lockedUntil > Date.now()) {
        return error(res, `账号已锁定，请 ${LOGIN_LOCK_MINUTES} 分钟后重试`, 429);
      }
      return unauthorized(res, '用户名或密码错误');
    }

    const user = rows[0];

    if (!user.is_active) {
      return unauthorized(res, '账号已被禁用，请联系管理员');
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      const failed = await recordFailedAttempt(username);
      if (failed.lockedUntil > Date.now()) {
        return error(res, `账号已锁定，请 ${LOGIN_LOCK_MINUTES} 分钟后重试`, 429);
      }
      const remaining = LOGIN_MAX_ATTEMPTS - (failed.count || 0);
      return unauthorized(res, `用户名或密码错误，还可尝试 ${Math.max(0, remaining)} 次`);
    }

    // 登录成功，清除失败计数
    await clearLoginAttemptRecord(username);

    // 更新最后登录时间
    await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    const token = jwt.sign(
      { id: user.id, username: user.username, real_name: user.real_name, role: user.role },
      process.env.JWT_SECRET,
      {
        expiresIn: process.env.JWT_EXPIRES_IN || '8h',
        issuer:    'dialysis-system',
        audience:  'dialysis-app',
      }
    );

    return success(res, {
      token,
      user: {
        id: user.id,
        username: user.username,
        real_name: user.real_name,
        role: user.role,
        menu_permissions: user.menu_permissions,
      },
    }, '登录成功');
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/logout
router.post('/logout', auth, async (req, res, next) => {
  try {
    // 将Token加入黑名单（8小时后自动过期，与 JWT_EXPIRES_IN 一致）
    await cache.blacklistToken(req.token, 28800);
    return success(res, null, '已退出登录');
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/change-password
router.post('/change-password', auth, async (req, res, next) => {
  try {
    const valid = validateChangePasswordPayload(req.body);
    if (!valid.ok) return error(res, valid.message);
    const { old_password, new_password } = valid.value;

    if (new_password.length < 6 || !/^[A-Za-z0-9]+$/.test(new_password)) {
      return error(res, '新密码至少6位，且只能包含字母与数字');
    }

    const { rows } = await pool.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [req.user.id]
    );

    if (rows.length === 0) return error(res, '用户不存在', 404);

    const match = await bcrypt.compare(old_password, rows[0].password_hash);
    if (!match) return error(res, '旧密码不正确');

    const newHash = await bcrypt.hash(new_password, 12);
    await pool.query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [newHash, req.user.id]
    );

    // 将旧Token加入黑名单，强制重新登录
    await cache.blacklistToken(req.token, 28800);

    return success(res, null, '密码修改成功，请重新登录');
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me
router.get('/me', auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, username, real_name, role, menu_permissions, last_login_at, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (rows.length === 0) return error(res, '用户不存在', 404);
    return success(res, rows[0]);
  } catch (err) {
    next(err);
  }
});

// 记录登录失败次数（默认5次锁定30分钟；Redis 可用时多实例共享）
async function recordFailedAttempt(username) {
  const record = await getLoginAttemptRecord(username);
  record.count++;
  if (record.count >= LOGIN_MAX_ATTEMPTS) {
    record.lockedUntil = Date.now() + LOGIN_LOCK_MINUTES * 60 * 1000;
    record.count = 0;
  }
  await persistLoginAttemptRecord(username, record);
  return record;
}

module.exports = router;
