/**
 * AI 辅助分析路由
 * 主要作用：为前端提供统一的 AI 分析 API 入口。
 * 权限说明：在已登录前提下，由 users.menu_permissions 侧栏白名单控制（与前端「用户管理」一致）；
 * 患者维度 AI 接口需包含 `/ai/assistant`；质控月报解读需 `/reports` 或 `/ai/assistant` 之一。
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const auth = require('../middleware/auth');
const { requireMenuPermissionAny, requireAiAssistantFeature } = require('../middleware/menuPermission');
const auditLog = require('../middleware/audit');
const { success, error } = require('../utils/response');
const aiAnalysisService = require('../services/AiAnalysisService');

const router = express.Router();

/** 是否将本次检索到的资料片段写入本地知识库（须前端显式勾选；正文非模型输出） */
function parseSaveToKnowledgeBase(body) {
  const v = body?.saveToKnowledgeBase;
  return v === true || v === 'true';
}

/** AI 路由统一错误：未配置密钥等为 503，其余 500 */
function handleAiRouteError(res, err) {
  const msg = err.message || 'AI 分析失败';
  const code =
    typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 600
      ? err.statusCode
      : msg.includes('未配置')
        ? 503
        : 500;
  return error(res, msg, code);
}

// 针对 AI 接口的专用速率限制：每用户每分钟最多 10 次
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 429, data: null, message: 'AI 分析请求过于频繁，请稍后重试' },
});

/** 质控月报解读单独收紧（与全局限流叠加） */
const qcMonthlyInsightLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 429, data: null, message: '质控月报解读请求过于频繁，请稍后重试' },
});

router.use(aiLimiter);
router.use(auth);

// 单患者透析趋势解读
router.post(
  '/patient-trend',
  requireAiAssistantFeature('ai_feat:patient_trend'),
  async (req, res) => {
    const { patientId, months } = req.body || {};
    if (!patientId) {
      return error(res, 'patientId 为必填参数', 400);
    }
    try {
      const result = await aiAnalysisService.analyzePatientTrend(patientId, months || 3, {
        saveToKb: parseSaveToKnowledgeBase(req.body),
        userId: req.user?.id || null,
      });
      return success(res, result);
    } catch (err) {
      return handleAiRouteError(res, err);
    }
  },
);

// 检验结果综合分析
router.post(
  '/labs-analysis',
  requireAiAssistantFeature('ai_feat:labs_analysis'),
  async (req, res) => {
    const { patientId } = req.body || {};
    if (!patientId) {
      return error(res, 'patientId 为必填参数', 400);
    }
    try {
      const result = await aiAnalysisService.analyzeLabs(patientId, {
        saveToKb: parseSaveToKnowledgeBase(req.body),
        userId: req.user?.id || null,
      });
      return success(res, result);
    } catch (err) {
      return handleAiRouteError(res, err);
    }
  },
);

// Kt/V 不达标原因辅助分析
router.post(
  '/ktv-root-cause',
  requireAiAssistantFeature('ai_feat:ktv'),
  async (req, res) => {
    const { dialysisRecordId } = req.body || {};
    if (!dialysisRecordId) {
      return error(res, 'dialysisRecordId 为必填参数', 400);
    }
    try {
      const result = await aiAnalysisService.analyzeKtvRootCause(dialysisRecordId, {
        saveToKb: parseSaveToKnowledgeBase(req.body),
        userId: req.user?.id || null,
      });
      return success(res, result);
    } catch (err) {
      return handleAiRouteError(res, err);
    }
  },
);

// CVC 感染高危评分解读
router.post(
  '/cvc-risk-explain',
  requireAiAssistantFeature('ai_feat:cvc'),
  async (req, res) => {
    const { assessmentId } = req.body || {};
    if (!assessmentId) {
      return error(res, 'assessmentId 为必填参数', 400);
    }
    try {
      const result = await aiAnalysisService.analyzeCvcRisk(assessmentId, {
        saveToKb: parseSaveToKnowledgeBase(req.body),
        userId: req.user?.id || null,
      });
      return success(res, result);
    } catch (err) {
      return handleAiRouteError(res, err);
    }
  },
);

// 自然语言查询
router.post(
  '/nlp-query',
  requireAiAssistantFeature('ai_feat:nlp'),
  async (req, res) => {
    const { query, context } = req.body || {};
    if (!query || typeof query !== 'string') {
      return error(res, 'query 为必填字符串参数', 400);
    }
    try {
      const result = await aiAnalysisService.answerNlpQuery(query, context, {
        saveToKb: parseSaveToKnowledgeBase(req.body),
        userId: req.user?.id || null,
      });
      return success(res, result);
    } catch (err) {
      return handleAiRouteError(res, err);
    }
  },
);

// 医嘱用药建议（侧栏「AI 分析助手」权限；处方业务仍由前端与医嘱接口 RBAC 约束）
router.post(
  '/medication-advice',
  requireAiAssistantFeature('ai_feat:medication'),
  async (req, res) => {
    const { patientId, summary } = req.body || {};
    if (!patientId) {
      return error(res, 'patientId 为必填参数', 400);
    }
    try {
      const result = await aiAnalysisService.analyzeMedicationPlan(patientId, summary || null, {
        saveToKb: parseSaveToKnowledgeBase(req.body),
        userId: req.user?.id || null,
      });
      return success(res, result);
    } catch (err) {
      return handleAiRouteError(res, err);
    }
  },
);

// 按异常类型分析（近 3 个月结构化数据 + 资料库优先）
router.post(
  '/anomaly-analysis',
  requireAiAssistantFeature('ai_feat:anomaly'),
  async (req, res) => {
    const { patientId, anomalyType, contextId } = req.body || {};
    if (!patientId || !anomalyType) {
      return error(res, 'patientId、anomalyType 为必填参数', 400);
    }
    try {
      const result = await aiAnalysisService.analyzeAnomaly({
        patientId,
        anomalyType,
        contextId: contextId || null,
        userId: req.user?.id || null,
        // 入库改为「阅读结果后」专用接口，避免未审阅即写入
        saveToKb: false,
      });
      return success(res, result);
    } catch (err) {
      return handleAiRouteError(res, err);
    }
  },
);

// 月度质控月报辅助解读（qc_reports 已存数值 + evidence；不重算公式）
router.post(
  '/qc-monthly-insight',
  qcMonthlyInsightLimiter,
  requireMenuPermissionAny(['/reports', '/ai/assistant']),
  auditLog('ai_qc_monthly_insight', 'CREATE'),
  async (req, res) => {
    const { year, month, historyMonths, userQuestion } = req.body || {};
    if (year === undefined || year === null || month === undefined || month === null) {
      return error(res, 'year、month 为必填参数', 400);
    }
    try {
      const result = await aiAnalysisService.analyzeQcMonthlyInsight({
        year,
        month,
        historyMonths: historyMonths ?? 6,
        userQuestion: userQuestion || '',
        userId: req.user?.id || null,
        saveToKb: parseSaveToKnowledgeBase(req.body),
      });
      return success(res, result);
    } catch (err) {
      return handleAiRouteError(res, err);
    }
  },
);

// 阅读异常分析结果后，将本次检索到的资料片段写入本地知识库（须校验患者存在）
router.post(
  '/anomaly-analysis/save-kb',
  requireAiAssistantFeature('ai_feat:anomaly'),
  async (req, res) => {
    const { patientId, anomalyType } = req.body || {};
    if (!patientId || !anomalyType) {
      return error(res, 'patientId、anomalyType 为必填参数', 400);
    }
    try {
      const result = await aiAnalysisService.saveAnomalyAnalysisKb({
        patientId,
        anomalyType,
        userId: req.user?.id || null,
      });
      return success(res, result);
    } catch (err) {
      return handleAiRouteError(res, err);
    }
  },
);

module.exports = router;

