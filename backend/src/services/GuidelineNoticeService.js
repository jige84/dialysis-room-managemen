/**
 * 指南阅读中心站内提醒：向 menu_permissions 含 /ai/guidelines 的用户写入通知
 */
const { pool } = require('../config/database');
const logger = require('../utils/logger');

function isMissingTable(err) {
  return Boolean(err && err.code === '42P01');
}

function isPermissionDenied(err) {
  return Boolean(err && err.code === '42501');
}

/**
 * @returns {Promise<string[]>} 用户 id 列表
 */
async function listUserIdsWithGuidelineMenu() {
  try {
    const { rows } = await pool.query(
      `SELECT id FROM users
       WHERE COALESCE(is_active, true) = true
         AND menu_permissions @> '["/ai/guidelines"]'::jsonb`,
    );
    return rows.map((r) => r.id);
  } catch (err) {
    if (isMissingTable(err) || isPermissionDenied(err)) {
      logger.warn('[GuidelineNoticeService] 无法查询用户菜单权限');
      return [];
    }
    throw err;
  }
}

/**
 * @param {{ title: string, message: string }} p
 */
async function notifyAllGuidelineReaders(p) {
  const title = String(p.title || '').slice(0, 200);
  const message = String(p.message || '').slice(0, 4000);
  if (!title || !message) return { inserted: 0 };
  const userIds = await listUserIdsWithGuidelineMenu();
  if (!userIds.length) return { inserted: 0 };
  try {
    const values = [];
    const params = [];
    let i = 1;
    for (const uid of userIds) {
      values.push(`($${i++}, $${i++}, $${i++})`);
      params.push(uid, title, message);
    }
    await pool.query(
      `INSERT INTO user_guideline_notices (user_id, title, message) VALUES ${values.join(', ')}`,
      params,
    );
    return { inserted: userIds.length };
  } catch (err) {
    if (isMissingTable(err) || isPermissionDenied(err)) {
      logger.warn('[GuidelineNoticeService] user_guideline_notices 不可用，已跳过提醒');
      return { inserted: 0 };
    }
    throw err;
  }
}

/**
 * @param {string} userId
 */
async function listUnread(userId) {
  try {
    const { rows } = await pool.query(
      `SELECT id, title, message, created_at
       FROM user_guideline_notices
       WHERE user_id = $1 AND read_at IS NULL
       ORDER BY created_at DESC
       LIMIT 50`,
      [userId],
    );
    return rows;
  } catch (err) {
    if (isMissingTable(err) || isPermissionDenied(err)) {
      return [];
    }
    throw err;
  }
}

/**
 * @param {string} userId
 */
async function markAllRead(userId) {
  try {
    const { rowCount } = await pool.query(
      `UPDATE user_guideline_notices SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL`,
      [userId],
    );
    return { updated: rowCount };
  } catch (err) {
    if (isMissingTable(err) || isPermissionDenied(err)) {
      return { updated: 0 };
    }
    throw err;
  }
}

module.exports = {
  notifyAllGuidelineReaders,
  listUnread,
  markAllRead,
  listUserIdsWithGuidelineMenu,
};
