/**
 * 指南阅读中心：创建文献、生成读书笔记、保存到知识库
 */
const express = require('express');
const auth = require('../middleware/auth');
const { requireMenuPermission } = require('../middleware/menuPermission');
const { success, created, error, notFound } = require('../utils/response');
const GuidelineReaderService = require('../services/GuidelineReaderService');
const GuidelineNoticeService = require('../services/GuidelineNoticeService');

const router = express.Router();

/** 侧栏「指南阅读中心」白名单（users.menu_permissions 含 /ai/guidelines） */
const guidelineAccess = [auth, requireMenuPermission('/ai/guidelines')];

router.get('/notices', ...guidelineAccess, async (req, res) => {
  try {
    const list = await GuidelineNoticeService.listUnread(req.user.id);
    return success(res, { list });
  } catch (err) {
    return error(res, err.message || '查询失败', 500);
  }
});

router.post('/notices/read-all', ...guidelineAccess, async (req, res) => {
  try {
    const r = await GuidelineNoticeService.markAllRead(req.user.id);
    return success(res, r);
  } catch (err) {
    return error(res, err.message || '操作失败', 500);
  }
});

router.get('/', ...guidelineAccess, async (req, res) => {
  try {
    const page = parseInt(String(req.query.page || '1'), 10) || 1;
    const pageSize = parseInt(String(req.query.pageSize || '20'), 10) || 20;
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const data = await GuidelineReaderService.listGuidelines(page, pageSize, q);
    return success(res, data);
  } catch (err) {
    return error(res, err.message || '查询失败', 500);
  }
});

router.get('/:id', ...guidelineAccess, async (req, res) => {
  try {
    const doc = await GuidelineReaderService.getGuideline(req.params.id);
    if (!doc) return notFound(res);
    return success(res, doc);
  } catch (err) {
    return error(res, err.message || '查询失败', 500);
  }
});

router.post('/', ...guidelineAccess, async (req, res) => {
  try {
    const row = await GuidelineReaderService.createGuideline({
      title: req.body?.title,
      sourceType: req.body?.sourceType,
      sourceUrl: req.body?.sourceUrl || null,
      sourceDoi: req.body?.sourceDoi || null,
      rawText: req.body?.rawText || null,
      uploadedBy: req.user?.id || null,
    });
    return created(res, row);
  } catch (err) {
    const code = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    return error(res, err.message || '创建失败', code);
  }
});

router.post('/:id/generate-note', ...guidelineAccess, async (req, res) => {
  try {
    const row = await GuidelineReaderService.generateReadingNote(req.params.id);
    return success(res, row);
  } catch (err) {
    const code = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    return error(res, err.message || '生成失败', code);
  }
});

router.post('/:id/save-to-kb', ...guidelineAccess, async (req, res) => {
  try {
    const r = await GuidelineReaderService.saveReadingNoteToKb(req.params.id, req.user?.id || null);
    return success(res, r);
  } catch (err) {
    const code = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    return error(res, err.message || '保存失败', code);
  }
});

router.delete('/:id', ...guidelineAccess, async (req, res) => {
  try {
    const r = await GuidelineReaderService.deleteGuideline(req.params.id);
    return success(res, r);
  } catch (err) {
    const code = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    return error(res, err.message || '删除失败', code);
  }
});

module.exports = router;
