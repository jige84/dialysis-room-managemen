/**
 * 审计日志中间件
 * 主要作用：在关键写请求链路上自动落库审计记录，满足医疗系统可追溯要求。
 * 主要功能：拦截 POST/PUT/PATCH/DELETE；解析用户与资源信息；写入审计表；审计记录不可篡改删除。
 */
const { pool } = require('../config/database');
const logger = require('../utils/logger');
const SENSITIVE_KEYS = new Set([
  'password',
  'new_password',
  'old_password',
  'password_hash',
  'token',
  'authorization',
  'jwt',
]);

function redactAuditPayload(value) {
  if (Array.isArray(value)) return value.map(redactAuditPayload);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_KEYS.has(String(k).toLowerCase())) {
        out[k] = '***REDACTED***';
      } else {
        out[k] = redactAuditPayload(v);
      }
    }
    return out;
  }
  return value;
}

/** 审计表 new_values 为 JSONB：须为可序列化对象，避免 BigInt/循环引用导致 JSON.stringify 抛错拖垮业务响应 */
function cloneBodyForAudit(body) {
  try {
    return redactAuditPayload(JSON.parse(JSON.stringify(body ?? {})));
  } catch {
    return { _audit_note: 'request_body_not_serializable' };
  }
}

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
              cloneBodyForAudit(req.body),
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
