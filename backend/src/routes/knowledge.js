/**
 * 知识库路由：kb_documents / kb_chunks 的查询与元数据更新
 * 主要作用：为前端知识管理页与 AI 检索提供分页列表、详情（含分块）及校验状态 PATCH。
 * 主要功能：参数化 SQL 分页；按 source_type 筛选；PATCH 更新 is_verified/status；迁移缺失列时返回明确提示。
 */
const express = require('express');
const { pool } = require('../config/database');
const auth = require('../middleware/auth');
const { requireMenuPermission } = require('../middleware/menuPermission');
const { success, error, notFound } = require('../utils/response');

const router = express.Router();

/** 侧栏「知识库管理」白名单（users.menu_permissions 含 /ai/knowledge） */
const kbRead = [auth, requireMenuPermission('/ai/knowledge')];

// --- 文档列表（分页 + 可选来源类型） ---
router.get('/documents', ...kbRead, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize || '20'), 10) || 20));
    const sourceType = req.query.sourceType ? String(req.query.sourceType) : null;
    const offset = (page - 1) * pageSize;
    const cond = ['1=1'];
    const params = [];
    let i = 1;
    if (sourceType) {
      cond.push(`source_type = $${i++}`);
      params.push(sourceType);
    }
    const where = cond.join(' AND ');
    const { rows: list } = await pool.query(
      `SELECT id, source_type, title, source_url, content_hash, status,
              COALESCE(is_verified, false) AS is_verified,
              created_at, COALESCE(updated_at, created_at) AS updated_at
       FROM kb_documents
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT $${i} OFFSET $${i + 1}`,
      [...params, pageSize, offset],
    );
    const { rows: c } = await pool.query(
      `SELECT count(*)::int AS n FROM kb_documents WHERE ${where}`,
      [...params],
    );
    return success(res, {
      list,
      total: c[0]?.n || 0,
      page,
      pageSize,
    });
  } catch (err) {
    return error(res, err.message || '查询失败', 500);
  }
});

// --- 单文档详情及下属文本分块 ---
router.get('/documents/:id', ...kbRead, async (req, res) => {
  try {
    const { id } = req.params;
    const { rows: docs } = await pool.query(
      `SELECT id, source_type, title, source_url, content_hash, status, COALESCE(is_verified, false) AS is_verified,
              created_at, COALESCE(updated_at, created_at) AS updated_at
       FROM kb_documents WHERE id = $1`,
      [id],
    );
    const doc = docs[0];
    if (!doc) return notFound(res);
    const { rows: chunks } = await pool.query(
      `SELECT id, chunk_index, content_text, tags, created_at
       FROM kb_chunks WHERE document_id = $1 ORDER BY chunk_index ASC`,
      [id],
    );
    return success(res, { document: doc, chunks });
  } catch (err) {
    return error(res, err.message || '查询失败', 500);
  }
});

// --- 更新校验状态 / 发布状态（部分字段 PATCH） ---
router.patch('/documents/:id', ...kbRead, async (req, res) => {
  try {
    const { id } = req.params;
    const { is_verified, status } = req.body || {};
    const sets = [];
    const vals = [];
    let n = 1;
    if (typeof is_verified === 'boolean') {
      sets.push(`is_verified = $${n++}`);
      vals.push(is_verified);
    }
    if (status === 'draft' || status === 'published') {
      sets.push(`status = $${n++}`);
      vals.push(status);
    }
    if (!sets.length) {
      return error(res, '无有效更新字段', 400);
    }
    sets.push('updated_at = NOW()');
    vals.push(id);
    const { rows } = await pool.query(
      `UPDATE kb_documents SET ${sets.join(', ')} WHERE id = $${n} RETURNING id, source_type, title, status, is_verified`,
      vals,
    );
    if (!rows[0]) return notFound(res);
    return success(res, rows[0]);
  } catch (err) {
    if (err.code === '42703') {
      return error(res, '请先执行数据库迁移 035（is_verified 列）', 503);
    }
    return error(res, err.message || '更新失败', 500);
  }
});

module.exports = router;
