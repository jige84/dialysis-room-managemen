/**
 * 专业医学网站配置（读：医护；写/测试：admin）
 */
const express = require('express');
const auth = require('../middleware/auth');
const { rbac } = require('../middleware/rbac');
const { requireMenuPermissionAny } = require('../middleware/menuPermission');
const { success, error } = require('../utils/response');
const MedicalSiteService = require('../services/MedicalSiteService');

const router = express.Router();

/** 列表供 AI/指南检索引用：至少需侧栏 AI 相关模块之一（NULL 表示不限制） */
router.get(
  '/',
  auth,
  requireMenuPermissionAny(['/ai/assistant', '/ai/guidelines', '/ai/knowledge', '/ai/sites']),
  async (req, res) => {
  try {
    const list = await MedicalSiteService.listAllSites();
    return success(res, list);
  } catch (err) {
    return error(res, err.message || '查询失败', 500);
  }
});

router.patch('/:siteKey', auth, rbac(['admin']), async (req, res) => {
  try {
    const { siteKey } = req.params;
    const patch = req.body || {};
    const row = await MedicalSiteService.updateSite(siteKey, patch);
    if (!row) return error(res, '站点不存在', 404);
    return success(res, row);
  } catch (err) {
    return error(res, err.message || '更新失败', 500);
  }
});

router.post('/:siteKey/test', auth, rbac(['admin']), async (req, res) => {
  try {
    const { siteKey } = req.params;
    const r = await MedicalSiteService.testReachability(siteKey);
    return success(res, r);
  } catch (err) {
    const code = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    return error(res, err.message || '测试失败', code);
  }
});

module.exports = router;
