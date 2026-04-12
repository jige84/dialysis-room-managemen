/**
 * 责任护士解析（患者建档 / 批量导入共用）
 * 主要作用：将 UUID 或真实姓名解析为已启用的 nurse / head_nurse 用户 id。
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value) {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

/**
 * @param {import('pg').Pool} pool
 * @param {unknown} raw
 * @returns {Promise<{ id: string | null, error: string | null }>}
 */
async function resolveResponsibleNurseId(pool, raw) {
  if (raw === undefined || raw === null || raw === '') return { id: null, error: null };
  if (!isValidUuid(String(raw))) return { id: null, error: '责任护士ID格式无效' };
  const { rows } = await pool.query(
    `SELECT id FROM users
     WHERE id = $1 AND role IN ('nurse', 'head_nurse') AND is_active = true`,
    [raw],
  );
  if (rows.length === 0) {
    return { id: null, error: '责任护士须从本科室已启用的护士或护士长账号中选择' };
  }
  return { id: rows[0].id, error: null };
}

/**
 * 按真实姓名精确匹配（去首尾空格）；重名时须改用 UUID。
 * @param {import('pg').Pool} pool
 * @param {unknown} rawName
 * @returns {Promise<{ id: string | null, error: string | null }>}
 */
async function resolveResponsibleNurseByRealName(pool, rawName) {
  const name = rawName == null ? '' : String(rawName).trim();
  if (!name) return { id: null, error: '责任护士姓名不能为空' };
  const { rows } = await pool.query(
    `SELECT id FROM users
     WHERE role IN ('nurse', 'head_nurse') AND is_active = true AND real_name = $1`,
    [name],
  );
  if (rows.length === 0) {
    return { id: null, error: '未找到匹配的责任护士，请核对姓名或使用责任护士ID列' };
  }
  if (rows.length > 1) {
    return { id: null, error: '责任护士姓名在系统中不唯一，请使用责任护士ID列（UUID）' };
  }
  return { id: rows[0].id, error: null };
}

module.exports = {
  isValidUuid,
  resolveResponsibleNurseId,
  resolveResponsibleNurseByRealName,
};
