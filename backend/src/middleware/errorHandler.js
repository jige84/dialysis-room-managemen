/**
 * 全局错误处理中间件（Express 错误栈末尾）
 * 主要作用：捕获路由与中间件中未处理的异常，向客户端返回统一 JSON 错误体。
 * 主要功能：区分业务错误与系统错误；开发环境附带堆栈；错误写入日志且不泄露敏感信息。
 */
const logger = require('../utils/logger');

module.exports = (err, req, res, next) => {
  logger.error(`[${req.method} ${req.path}] 未捕获的错误：`, {
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    user: req.user?.real_name,
    body: req.body,
  });

  // PostgreSQL约束违反错误
  if (err.code === '23505') {
    return res.status(400).json({ code: 400, data: null, message: '数据已存在，请勿重复提交' });
  }
  if (err.code === '23503') {
    return res.status(400).json({ code: 400, data: null, message: '关联数据不存在' });
  }
  if (err.code === '23514') {
    return res.status(400).json({ code: 400, data: null, message: '数据格式不符合要求' });
  }

  const statusCode = err.status || err.statusCode || 500;
  const message = statusCode === 500 ? '服务器内部错误，请联系管理员' : err.message;

  res.status(statusCode).json({ code: statusCode, data: null, message });
};
