/**
 * 审计日志中间件
 * 自动记录所有写操作（POST/PUT/PATCH/DELETE）
 * 审计日志不可修改、不可删除
 */
const { pool } = require('../config/database');
const logger = require('../utils/logger');

/**
 * 创建审计日志
 * @param {string} tableName 操作的数据表
 * @param {string} action CREATE/UPDATE/DELETE/LOGIN/LOGOUT
 */
function auditLog(tableName, action) {
  return (req, res, next) => {
    const originalJson = res.json.bind(res);

    res.json = async (body) => {
      // 只记录成功的写操作
      if (body && body.code >= 200 && body.code < 300 &&
          ['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT'].includes(action)) {
        try {
          await pool.query(
            `INSERT INTO audit_logs
               (user_id, user_name, user_role, action, table_name, record_id, new_values, ip_address)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              req.user?.id || null,
              req.user?.real_name || '系统',
              req.user?.role || null,
              action,
              tableName,
              body.data?.id || req.params?.id || null,
              JSON.stringify(req.body || {}),
              req.ip || req.socket?.remoteAddress
            ]
          );
        } catch (err) {
          logger.warn('审计日志写入失败（不影响业务）：' + err.message);
        }
      }
      return originalJson(body);
    };

    next();
  };
}

module.exports = auditLog;
