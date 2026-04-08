/**
 * 侧栏 menu_permissions 校验（与 users.menu_permissions JSON 白名单一致）
 * 主要作用：在已登录前提下，按管理员配置的模块 key 放行，替代临床 AI 等场景的固定角色列表。
 * 规则：NULL/未设置 → 不限制；[] → 全部拒绝；非空数组 → 须包含所需 key。
 */
const { pool } = require('../config/database');
const { forbidden } = require('../utils/response');

/**
 * @param {unknown} raw
 * @returns {string[] | null | undefined}
 */
function normalizeMenuPermissions(raw) {
  if (raw === null || raw === undefined) return raw;
  if (Array.isArray(raw)) {
    return raw.filter((k) => typeof k === 'string').map((k) => k.trim());
  }
  return null;
}

/**
 * @param {string} userId
 * @returns {Promise<string[] | null | undefined>}
 */
async function fetchMenuPermissionsByUserId(userId) {
  const { rows } = await pool.query('SELECT menu_permissions FROM users WHERE id = $1', [userId]);
  if (rows.length === 0) return null;
  return normalizeMenuPermissions(rows[0].menu_permissions);
}

/**
 * @param {string[] | null | undefined} mp
 * @param {string} requiredKey
 */
function isKeyAllowed(mp, requiredKey) {
  const normalized = normalizeMenuPermissions(mp);
  if (normalized === null || normalized === undefined) return true;
  if (normalized.length === 0) return false;
  return normalized.includes(requiredKey);
}

/**
 * @param {string[] | null | undefined} mp
 * @param {string[]} keys
 */
function isAnyKeyAllowed(mp, keys) {
  const normalized = normalizeMenuPermissions(mp);
  if (normalized === null || normalized === undefined) return true;
  if (normalized.length === 0) return false;
  return keys.some((k) => normalized.includes(k));
}

const AI_FEAT_PREFIX = 'ai_feat:';

/**
 * AI 分析助手子功能：须先有 /ai/assistant；若无任一 ai_feat:* → 视为可使用全部子功能。
 * @param {string[] | null | undefined} mp
 * @param {string} featureKey 如 ai_feat:patient_trend
 */
function hasAiAssistantFeature(mp, featureKey) {
  const normalized = normalizeMenuPermissions(mp);
  if (normalized === null || normalized === undefined) return true;
  if (normalized.length === 0) return false;
  if (!normalized.includes('/ai/assistant')) return false;
  const granular = normalized.filter((k) => k.startsWith(AI_FEAT_PREFIX));
  if (granular.length === 0) return true;
  return granular.includes(featureKey);
}

/**
 * @param {string} featureKey 如 ai_feat:patient_trend
 */
function requireAiAssistantFeature(featureKey) {
  return async (req, res, next) => {
    if (!req.user?.id) {
      return forbidden(res, '未认证');
    }
    try {
      const mp = await fetchMenuPermissionsByUserId(req.user.id);
      if (!hasAiAssistantFeature(mp, featureKey)) {
        return forbidden(
          res,
          '您未被授权使用此 AI 子功能，请联系管理员在「用户管理」中勾选对应分析项',
        );
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

/**
 * @param {string} menuKey 与前端侧栏一致，如 '/ai/assistant'
 */
function requireMenuPermission(menuKey) {
  return async (req, res, next) => {
    if (!req.user?.id) {
      return forbidden(res, '未认证');
    }
    try {
      const mp = await fetchMenuPermissionsByUserId(req.user.id);
      if (!isKeyAllowed(mp, menuKey)) {
        return forbidden(
          res,
          '您未被授权使用此功能，请联系管理员在「用户管理」中勾选对应侧栏模块',
        );
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

/**
 * @param {string[]} menuKeys 满足其一即可（用于质控月报解读等跨模块能力）
 */
function requireMenuPermissionAny(menuKeys) {
  return async (req, res, next) => {
    if (!req.user?.id) {
      return forbidden(res, '未认证');
    }
    try {
      const mp = await fetchMenuPermissionsByUserId(req.user.id);
      if (!isAnyKeyAllowed(mp, menuKeys)) {
        return forbidden(
          res,
          '您未被授权使用此功能，请联系管理员在「用户管理」中勾选对应侧栏模块',
        );
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = {
  requireMenuPermission,
  requireMenuPermissionAny,
  requireAiAssistantFeature,
  hasAiAssistantFeature,
  fetchMenuPermissionsByUserId,
  normalizeMenuPermissions,
};
