/**
 * CQI（持续质量改进）REST 路由
 * 修复：静态路由 /defects/list 放在 /:id 通配之前；PUT 加 rbac。
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const auth = require('../middleware/auth');
const { rbac } = require('../middleware/rbac');
const auditLog = require('../middleware/audit');
const { success, created, error, notFound } = require('../utils/response');
const { formatDate } = require('../utils/dateUtils');

const CQI_READ_ROLES = ['admin', 'doctor', 'head_nurse', 'nurse', 'quality'];

const CQI_WRITE_ROLES = ['admin', 'head_nurse'];

/** @param {unknown} v */
function isUuidString(v) {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

/** @param {unknown} arr @returns {Promise<string[]|null>} 校验失败返回 null */
async function normalizeParticipantIds(arr) {
  if (arr === undefined || arr === null) return [];
  if (!Array.isArray(arr)) return null;
  const ids = arr.filter((x) => isUuidString(x));
  if (ids.length !== arr.length) return null;
  if (ids.length === 0) return [];
  const { rows } = await pool.query(
    `SELECT id FROM users WHERE id = ANY($1::uuid[])`,
    [ids],
  );
  if (rows.length !== ids.length) return null;
  return ids;
}

// GET /api/cqi - CQI 记录列表
router.get('/', auth, rbac(CQI_READ_ROLES), async (req, res, next) => {
  try {
    const { status, page = 1, page_size = 20 } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(page_size, 10);
    const conditions = [];
    const params = [];
    let idx = 1;
    if (status) { conditions.push(`cr.status = $${idx++}`); params.push(status); }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const countRes = await pool.query(`SELECT COUNT(*) FROM cqi_records cr ${where}`, params);
    const { rows } = await pool.query(
      `SELECT cr.*,
              u.real_name as created_by_name,
              ul.real_name as leader_name,
              ud.real_name as director_sign_name
       FROM cqi_records cr
       LEFT JOIN users u ON cr.created_by = u.id
       LEFT JOIN users ul ON cr.leader_id = ul.id
       LEFT JOIN users ud ON cr.director_sign_id = ud.id
       ${where}
       ORDER BY cr.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, parseInt(page_size, 10), offset]
    );

    return success(res, { data: rows, total: parseInt(countRes.rows[0].count, 10) });
  } catch (err) { next(err); }
});

// ── 静态路由（必须在 /:id 通配之前） ────────────────────

// GET /api/cqi/user-options — CQI 负责人/参与人/科主任签名下拉（不含敏感字段）
router.get('/user-options', auth, rbac(CQI_WRITE_ROLES), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, real_name, role FROM users
       WHERE is_active = true
         AND role IN ('admin','doctor','head_nurse','nurse','quality','qc')
       ORDER BY real_name ASC`,
    );
    return success(res, rows);
  } catch (err) { next(err); }
});

// GET /api/cqi/defects/list - 缺陷上报列表
router.get('/defects/list', auth, rbac(CQI_READ_ROLES), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT dr.*, u.real_name as reported_by_name
       FROM defect_reports dr
       LEFT JOIN users u ON dr.reported_by = u.id
       ORDER BY dr.event_time DESC LIMIT 100`
    );
    return success(res, rows);
  } catch (err) { next(err); }
});

// POST /api/cqi/defects - 上报缺陷/不良事件
router.post(
  '/defects',
  auth,
  rbac(['admin', 'doctor', 'head_nurse', 'nurse']),
  auditLog('defect_reports', 'CREATE'),
  async (req, res, next) => {
    try {
      const {
        event_time, event_type, severity, description,
        involved_patient_ids, immediate_action, anonymous,
      } = req.body;
      if (!event_time || !event_type) return error(res, '事件时间和事件类型为必填项');

      const desc = description != null && String(description).trim() !== ''
        ? String(description).trim()
        : '（未填写详细描述）';

      const { rows } = await pool.query(
        `INSERT INTO defect_reports
         (event_time, event_type, severity, description,
          involved_patient_ids, immediate_action, is_anonymous, reported_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, event_type, event_time`,
        [
          event_time,
          event_type,
          severity || 'minor',
          desc,
          involved_patient_ids || null,
          immediate_action || null,
          anonymous || false,
          req.user.id,
        ]
      );
      return created(res, rows[0], '缺陷事件已上报');
    } catch (err) { next(err); }
  },
);

// ── 通配路由 ────────────────────────────────────────────

// GET /api/cqi/:id - 单条 CQI 记录
router.get('/:id', auth, rbac(CQI_READ_ROLES), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT cr.*,
              u.real_name as created_by_name,
              ul.real_name as leader_name,
              ud.real_name as director_sign_name
       FROM cqi_records cr
       LEFT JOIN users u ON cr.created_by = u.id
       LEFT JOIN users ul ON cr.leader_id = ul.id
       LEFT JOIN users ud ON cr.director_sign_id = ud.id
       WHERE cr.id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return notFound(res, 'CQI记录不存在');
    const row = rows[0];
    if (Array.isArray(row.participants) && row.participants.length > 0) {
      const pr = await pool.query(
        'SELECT id, real_name FROM users WHERE id = ANY($1::uuid[])',
        [row.participants],
      );
      row.participant_users = pr.rows;
    } else {
      row.participant_users = [];
    }
    return success(res, row);
  } catch (err) { next(err); }
});

// POST /api/cqi - 新建 CQI 项目
router.post('/', auth, rbac(CQI_WRITE_ROLES),
  auditLog('cqi_records', 'CREATE'),
  async (req, res, next) => {
    try {
      const {
        project_type, title, problem_found, measures,
        start_date, target_description, target_value, target_unit, notes,
        status, leader_id,
        root_cause, participants, review_date,
      } = req.body;
      if (!title || !project_type) return error(res, '标题和项目类型为必填项');

      let leaderUuid = null;
      if (leader_id && typeof leader_id === 'string') {
        const u = await pool.query('SELECT id FROM users WHERE id = $1', [leader_id]);
        if (u.rows.length) leaderUuid = leader_id;
      }

      const partIds = await normalizeParticipantIds(participants);
      if (partIds === null) return error(res, '参与人员 ID 无效');

      const { rows } = await pool.query(
        `INSERT INTO cqi_records
         (project_type, title, problem_found, measures,
          start_date, target_description, target_value, target_unit,
          notes, leader_id, created_by, status,
          root_cause, participants, review_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
        [
          project_type,
          title,
          problem_found || '',
          measures || '',
          start_date || formatDate(new Date()),
          target_description,
          target_value,
          target_unit,
          notes,
          leaderUuid || req.user.id,
          req.user.id,
          status && ['planning', 'ongoing', 'completed', 'overdue'].includes(status)
            ? status
            : 'ongoing',
          root_cause != null ? String(root_cause) : '',
          partIds.length ? partIds : null,
          review_date && typeof review_date === 'string' ? review_date : null,
        ]
      );
      return created(res, rows[0], 'CQI项目已创建');
    } catch (err) { next(err); }
  },
);

// PUT /api/cqi/:id - 更新 CQI 进展
router.put('/:id', auth, rbac(CQI_WRITE_ROLES),
  auditLog('cqi_records', 'UPDATE'),
  async (req, res, next) => {
    try {
      const allowed = [
        'status', 'measures', 'implementation_notes',
        'outcome', 'actual_end_date', 'summary',
        'problem_found', 'target_description', 'target_value', 'target_unit', 'notes',
        'root_cause', 'review_date', 'implementation_date',
        'effect_description', 'actual_value', 'is_goal_achieved',
      ];
      const updates = {};
      for (const k of allowed) {
        if (req.body[k] !== undefined) updates[k] = req.body[k];
      }
      if (req.body.leader_id !== undefined) {
        const lid = req.body.leader_id;
        if (lid === null || lid === '') {
          updates.leader_id = null;
        } else if (typeof lid === 'string') {
          const u = await pool.query('SELECT id FROM users WHERE id = $1', [lid]);
          if (u.rows.length) updates.leader_id = lid;
        }
      }
      if (req.body.participants !== undefined) {
        const partIds = await normalizeParticipantIds(req.body.participants);
        if (partIds === null) return error(res, '参与人员 ID 无效');
        updates.participants = partIds.length ? partIds : null;
      }
      if (req.body.director_sign_id !== undefined) {
        const sid = req.body.director_sign_id;
        if (sid === null || sid === '') {
          updates.director_sign_id = null;
          updates.director_sign_date = null;
        } else if (typeof sid === 'string' && isUuidString(sid)) {
          const u = await pool.query('SELECT id FROM users WHERE id = $1', [sid]);
          if (u.rows.length) updates.director_sign_id = sid;
        }
      }
      if (req.body.director_sign_date !== undefined) {
        const sd = req.body.director_sign_date;
        if (sd === null || sd === '') {
          updates.director_sign_date = null;
        } else if (typeof sd === 'string') {
          updates.director_sign_date = sd.slice(0, 10);
        }
      }
      if (Object.keys(updates).length === 0) return error(res, '无可更新字段');

      const keys = Object.keys(updates);
      const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
      const { rows } = await pool.query(
        `UPDATE cqi_records SET ${sets}, updated_at = NOW() WHERE id = $1 RETURNING *`,
        [req.params.id, ...keys.map((k) => updates[k])]
      );
      if (rows.length === 0) return notFound(res, 'CQI记录不存在');
      return success(res, rows[0], 'CQI项目已更新');
    } catch (err) { next(err); }
  },
);

module.exports = router;
