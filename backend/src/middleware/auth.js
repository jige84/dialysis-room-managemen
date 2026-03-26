/**
 * JWT认证中间件
 * 验证 Authorization: Bearer <token>
 */
const jwt = require('jsonwebtoken');
const { cache } = require('../config/redis');
const { unauthorized } = require('../utils/response');
require('dotenv').config();

module.exports = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return unauthorized(res, '未提供认证Token');
  }

  const token = authHeader.replace('Bearer ', '').trim();

  // 检查Token是否已被加入黑名单（退出登录）
  const blacklisted = await cache.isBlacklisted(token);
  if (blacklisted) {
    return unauthorized(res, '已退出登录，请重新登录');
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      issuer:   'dialysis-system',
      audience: 'dialysis-app',
    });
    req.user = decoded;
    req.token = token;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return unauthorized(res, 'Token已过期，请重新登录');
    }
    return unauthorized(res, 'Token无效');
  }
};
