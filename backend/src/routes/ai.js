/**
 * AI 辅助分析路由
 * 主要作用：为前端提供统一的 AI 分析 API 入口。
 * 权限说明：
 *  - 趋势/检验/CVC 解读：admin / doctor / head_nurse 可用
 *  - 用药建议：仅 admin / doctor
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const auth = require('../middleware/auth');
const { rbac } = require('../middleware/rbac');
const { success, error } = require('../utils/response');
const aiAnalysisService = require('../services/AiAnalysisService');

const router = express.Router();

// 针对 AI 接口的专用速率限制：每用户每分钟最多 10 次
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 429, data: null, message: 'AI 分析请求过于频繁，请稍后重试' },
});

router.use(aiLimiter);
router.use(auth);

// 单患者透析趋势解读
router.post(
  '/patient-trend',
  rbac(['admin', 'doctor', 'head_nurse']),
  async (req, res) => {
    const { patientId, months } = req.body || {};
    if (!patientId) {
      return error(res, 'patientId 为必填参数', 400);
    }
    try {
      const result = await aiAnalysisService.analyzePatientTrend(
        patientId,
        months || 3,
      );
      return success(res, result);
    } catch (err) {
      return error(res, err.message || 'AI 分析失败', 500);
    }
  },
);

// 检验结果综合分析
router.post(
  '/labs-analysis',
  rbac(['admin', 'doctor', 'head_nurse']),
  async (req, res) => {
    const { patientId } = req.body || {};
    if (!patientId) {
      return error(res, 'patientId 为必填参数', 400);
    }
    try {
      const result = await aiAnalysisService.analyzeLabs(patientId);
      return success(res, result);
    } catch (err) {
      return error(res, err.message || 'AI 分析失败', 500);
    }
  },
);

// Kt/V 不达标原因辅助分析
router.post(
  '/ktv-root-cause',
  rbac(['admin', 'doctor', 'head_nurse']),
  async (req, res) => {
    const { dialysisRecordId } = req.body || {};
    if (!dialysisRecordId) {
      return error(res, 'dialysisRecordId 为必填参数', 400);
    }
    try {
      const result = await aiAnalysisService.analyzeKtvRootCause(
        dialysisRecordId,
      );
      return success(res, result);
    } catch (err) {
      return error(res, err.message || 'AI 分析失败', 500);
    }
  },
);

// CVC 感染高危评分解读
router.post(
  '/cvc-risk-explain',
  rbac(['admin', 'doctor', 'head_nurse']),
  async (req, res) => {
    const { assessmentId } = req.body || {};
    if (!assessmentId) {
      return error(res, 'assessmentId 为必填参数', 400);
    }
    try {
      const result = await aiAnalysisService.analyzeCvcRisk(assessmentId);
      return success(res, result);
    } catch (err) {
      return error(res, err.message || 'AI 分析失败', 500);
    }
  },
);

// 自然语言查询
router.post(
  '/nlp-query',
  rbac(['admin', 'doctor', 'head_nurse']),
  async (req, res) => {
    const { query, context } = req.body || {};
    if (!query || typeof query !== 'string') {
      return error(res, 'query 为必填字符串参数', 400);
    }
    try {
      const result = await aiAnalysisService.answerNlpQuery(query, context);
      return success(res, result);
    } catch (err) {
      return error(res, err.message || 'AI 分析失败', 500);
    }
  },
);

// 医嘱用药建议（仅 admin / doctor）
router.post(
  '/medication-advice',
  rbac(['admin', 'doctor']),
  async (req, res) => {
    const { patientId, summary } = req.body || {};
    if (!patientId) {
      return error(res, 'patientId 为必填参数', 400);
    }
    try {
      const result = await aiAnalysisService.analyzeMedicationPlan(
        patientId,
        summary || null,
      );
      return success(res, result);
    } catch (err) {
      return error(res, err.message || 'AI 分析失败', 500);
    }
  },
);

module.exports = router;

