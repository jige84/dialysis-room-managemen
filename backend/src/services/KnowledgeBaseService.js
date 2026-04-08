/**
 * 知识库服务：向量/关键词检索、场景元数据与使用审计
 * 主要作用：为 AiAnalysisService 与各 AI 场景提供统一检索入口，并记录检索上下文供合规审计。
 * 主要功能：查询 kb_chunks；按 AI 场景键（AI_KB_SCENARIO）关联元数据；处理权限/唯一约束/缺列等 PostgreSQL 错误码；可选外联补全由环境变量控制（默认关闭）。
 */
const crypto = require('crypto');
const { pool } = require('../config/database');
const logger = require('../utils/logger');

/** 与前端、AiAnalysisService 约定的 AI 入库场景键（一级分类） */
const AI_KB_SCENARIO = {
  ANOMALY: 'anomaly_analysis',
  PATIENT_TREND: 'patient_trend',
  LABS: 'labs_analysis',
  KTV_ROOT_CAUSE: 'ktv_root_cause',
  CVC_RISK: 'cvc_risk',
  NLP: 'nlp_query',
  MEDICATION: 'medication_advice',
  GUIDELINE_NOTE: 'guideline_note',
  /** 科室月度质控聚合解读（无患者标识） */
  QC_MONTHLY: 'qc_monthly_insight',
};

/** PostgreSQL insufficient_privilege */
function isPermissionDenied(err) {
  return Boolean(err && err.code === '42501');
}

function isUniqueViolation(err) {
  return Boolean(err && err.code === '23505');
}

/** 未执行 034 迁移时 ai_scenario 等列不存在 */
function isUndefinedColumn(err) {
  return Boolean(err && err.code === '42703');
}

function isWebSearchEnabled() {
  return String(process.env.WEB_SEARCH_ENABLED || '').toLowerCase() === 'true';
}

/**
 * 全文检索资料片段（无 PII）
 * @param {string} queryText
 * @param {number} [limit]
 */
async function searchChunks(queryText, limit = 5) {
  const lim = Math.min(20, Math.max(1, limit));
  const q = (queryText || '').trim().slice(0, 500);
  if (!q) return [];

  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.content_text, c.tags,
              ts_rank_cd(c.search_vector, plainto_tsquery('simple', $1)) AS rank
       FROM kb_chunks c
       JOIN kb_documents d ON d.id = c.document_id
       WHERE d.status = 'published'
         AND c.search_vector @@ plainto_tsquery('simple', $1)
       ORDER BY rank DESC NULLS LAST
       LIMIT $2`,
      [q, lim],
    );
    return rows;
  } catch (err) {
    if (isPermissionDenied(err)) {
      logger.warn('[KnowledgeBaseService] 资料库表无访问权限，跳过片段检索（请执行迁移 033 或授予 kb_* 表权限）');
      return [];
    }
    throw err;
  }
}

/**
 * 按异常类型构造检索 query（关键词，不含患者标识）
 * @param {string} anomalyType
 */
/**
 * 非异常类 AI 场景的本地资料检索关键词（中英混合便于命中）
 * @param {string} scenario - AI_KB_SCENARIO 值或简短键
 */
function buildSearchQueryForScenario(scenario) {
  const map = {
    patient_trend: '透析 充分性 KtV URR 干体重 超滤',
    labs_analysis: '检验 血红蛋白 钙 磷 甲状旁腺 透析',
    ktv_root_cause: 'KtV URR 透析 血流量 时长',
    cvc_risk: '导管 CRBSI 感染 隧道',
    nlp_query: '血液透析 质控',
    medication_advice: '用药 抗凝 透析 药物',
    guideline_note: '指南 共识 血液净化',
    qc_monthly_insight: '质控 血液透析 月度 上报 持续改进',
  };
  const key = String(scenario || '').trim();
  return map[key] || '血液透析 血液净化';
}

function buildSearchQueryForAnomaly(anomalyType) {
  const map = {
    lab_abnormal: 'laboratory abnormal result dialysis',
    lab_critical: 'critical value laboratory emergency',
    ktv_inadequate: 'ktv dialysis adequacy urr',
    urr_inadequate: 'urr dialysis adequacy',
    bun_invalid: 'bun pre post dialysis',
    uf_exceed: 'ultrafiltration dry weight',
    infection_overdue: 'infection screening hepatitis',
    infection_warning: 'infection screening review',
    vascular_assessment_due: 'vascular access avf',
    dry_weight_overdue: 'dry weight assessment',
    cvc_high_risk: 'catheter infection crbsi',
    nurse_ratio: 'nurse patient ratio',
    lab_critical_alert: 'critical laboratory',
    ktv_inadequate_alert: 'ktv',
    default: 'dialysis hemodialysis',
  };
  return map[anomalyType] || map.default;
}

/**
 * 记录一次检索与使用（审计）
 */
async function logUsage({
  requestKind,
  patientId = null,
  anomalyType = null,
  queryText = '',
  retrievedChunkIds = [],
  usedWebFallback = false,
  userId = null,
}) {
  try {
    await pool.query(
      `INSERT INTO kb_usage_log (
         request_kind, patient_id, anomaly_type, query_text,
         retrieved_chunk_ids, used_web_fallback, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        requestKind,
        patientId,
        anomalyType,
        queryText?.slice(0, 2000) || null,
        retrievedChunkIds.length ? retrievedChunkIds : null,
        usedWebFallback,
        userId,
      ],
    );
  } catch (err) {
    if (isPermissionDenied(err)) {
      logger.warn('[KnowledgeBaseService] kb_usage_log 无写入权限，已跳过使用审计');
      return;
    }
    throw err;
  }
}

/**
 * 可选联网补全（占位：未配置搜索 API 时返回 null）
 * @returns {Promise<string|null>}
 */
async function maybeFetchWebSummary(queryText) {
  if (!isWebSearchEnabled()) return null;
  logger.info('[KnowledgeBaseService] WEB_SEARCH_ENABLED 但未配置外部搜索实现，跳过');
  return null;
}

/**
 * 将资料正文写入 kb_documents / kb_chunks（仅当调用方显式要求保存时调用）。
 * 正文应为检索片段拼接或指南 raw_text，非大模型回答（见 hd-ai-clinical SKILL 入库规范）。
 * 去重：同一正文 SHA-256 在 ai_session 下仅保留一条（先查后插，冲突时视为重复）
 * @param {object} options
 * @param {string} options.title 标题（禁止含患者姓名、身份证、手机号）
 * @param {string} options.summaryText 待持久化正文（历史参数名保留）
 * @param {string} [options.tags] 检索辅助标签
 * @param {string} [options.scenario] 一级分类 AI_KB_SCENARIO.*
 * @param {string|null} [options.subcategory] 二级分类（如 anomalyType）
 * @param {string|null} [options.userId] 操作人
 * @returns {Promise<{ saved: boolean, duplicate: boolean, documentId: string|null }>}
 */
async function recordSessionSummary({
  title,
  summaryText,
  tags = '',
  scenario = null,
  subcategory = null,
  userId = null,
}) {
  const text = (summaryText || '').trim().slice(0, 80000);
  if (!text) {
    return { saved: false, duplicate: false, documentId: null };
  }

  const contentHash = crypto.createHash('sha256').update(text).digest('hex');

  const trySelectDup = async () => {
    const { rows } = await pool.query(
      `SELECT id FROM kb_documents
       WHERE source_type = 'ai_session' AND content_hash = $1`,
      [contentHash],
    );
    return rows[0]?.id || null;
  };

  try {
    const existingId = await trySelectDup();
    if (existingId) {
      return { saved: false, duplicate: true, documentId: existingId };
    }

    let docId;
    try {
      const { rows: docRows } = await pool.query(
        `INSERT INTO kb_documents (
           source_type, title, content_hash, status,
           ai_scenario, ai_subcategory, created_by
         )
         VALUES ('ai_session', $1, $2, 'published', $3, $4, $5)
         RETURNING id`,
        [
          title.slice(0, 500),
          contentHash,
          scenario ? scenario.slice(0, 40) : null,
          subcategory ? subcategory.slice(0, 120) : null,
          userId,
        ],
      );
      docId = docRows[0].id;
    } catch (insertErr) {
      if (isUndefinedColumn(insertErr)) {
        const mergedTags = [tags, scenario, subcategory].filter(Boolean).join(' ').trim();
        const { rows: docRows } = await pool.query(
          `INSERT INTO kb_documents (source_type, title, content_hash, status)
           VALUES ('ai_session', $1, $2, 'published')
           RETURNING id`,
          [title.slice(0, 500), contentHash],
        );
        docId = docRows[0].id;
        await pool.query(
          `INSERT INTO kb_chunks (document_id, chunk_index, content_text, tags)
           VALUES ($1, 0, $2, $3)`,
          [docId, text, mergedTags.slice(0, 500)],
        );
        return { saved: true, duplicate: false, documentId: docId };
      }
      throw insertErr;
    }

    await pool.query(
      `INSERT INTO kb_chunks (document_id, chunk_index, content_text, tags)
       VALUES ($1, 0, $2, $3)`,
      [docId, text, tags.slice(0, 500)],
    );

    return { saved: true, duplicate: false, documentId: docId };
  } catch (err) {
    if (isUniqueViolation(err)) {
      const id = await trySelectDup();
      if (id) {
        return { saved: false, duplicate: true, documentId: id };
      }
    }
    if (isPermissionDenied(err)) {
      logger.warn('[KnowledgeBaseService] 无法写入 kb_documents/kb_chunks，已跳过资料入库');
      return { saved: false, duplicate: false, documentId: null };
    }
    throw err;
  }
}

module.exports = {
  AI_KB_SCENARIO,
  searchChunks,
  buildSearchQueryForAnomaly,
  buildSearchQueryForScenario,
  logUsage,
  maybeFetchWebSummary,
  recordSessionSummary,
  isWebSearchEnabled,
};
