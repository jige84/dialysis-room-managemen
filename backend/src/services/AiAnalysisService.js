/**
 * AI 辅助分析服务（通义千问接入层）
 * 主要作用：聚合透析/检验/CVC 等结构化数据，将其与精心设计的 Prompt 一起发送给大模型，
 *          返回经过合规包装的分析结果。
 * 约束要求：
 *  - 不传身份证号、手机号等直接标识符，只使用患者内部ID及必要的医疗指标
 *  - 所有响应统一附带合规免责声明，供前端展示
 */

const crypto = require('crypto');
const { pool } = require('../config/database');
const logger = require('../utils/logger');
const { buildAnomalyEvidencePayload, isValidAnomalyType } = require('../utils/anomalyPayloads');
const {
  getAnomalyAnalysisPrompts,
  sanitizeAnomalyAnalysisDisplayText,
} = require('../utils/anomalyPrompts');
const KnowledgeBaseService = require('./KnowledgeBaseService');
const MedicationRuleService = require('./MedicationRuleService');
const MedicalSiteService = require('./MedicalSiteService');
const NlpQueryService = require('./NlpQueryService');
const { formatDate } = require('../utils/dateUtils');

const { AI_KB_SCENARIO } = KnowledgeBaseService;

/** 临床分析共用系统提示（指南范围与输出约束） */
const CLINICAL_BASE_SYSTEM_PROMPT = `你是一位具有丰富临床经验的血液净化专科医师助手，
熟悉《血液净化标准操作规程（2021版）》、
《中国血液透析充分性临床实践指南（2020年版）》、
《KDIGO 慢性肾脏病贫血管理指南（2024版）》、
《KDIGO CKD 矿物质和骨代谢异常指南（2017版）》、
《中国血液透析用血管通路专家共识（第2版，2019年）》、
《血液透析患者抗凝治疗中国专家共识（2022版）》、
《中国血液净化中心感染控制专家共识（2021版）》、
《中国慢性肾脏病继发性甲状旁腺功能亢进诊疗指南（2021版）》。

分析时必须严格遵守：
1. 每条建议注明【依据】：指南名称 + 章节号或推荐级别（若资料库片段有则引用）。
2. 上下文未提供患者姓名时，禁止编造姓名；不得使用真实可识别的第三方姓名。
3. 所有化验值在引用时标注：当前值与参考范围（若 JSON 中已给出）。
4. 给出可量化改进目标（如目标 Hb 110–120 g/L）在适用时。
5. 区分处置优先级：立即处理 / 下次透析前 / 本月内处理（可用文字表述，勿用 emoji）。
6. 药物建议须为通用名与方向性提示，避免给出具体处方剂量除非规则摘录已明确。
7. 全文必须使用简体中文输出。`;

function isoTimestampZh(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString('zh-CN', { hour12: false });
  } catch {
    return iso;
  }
}

function buildFullDisclaimer(isoTime, model = 'qwen3-max') {
  const t = isoTimestampZh(isoTime);
  return (
    `⚠️【AI 辅助分析声明】本内容由 ${model || 'AI'} 大模型辅助生成，` +
    '仅供具有执业资质的医护人员参考，不构成医疗诊断建议，不能替代临床判断。' +
    '最终治疗方案须由主治医师结合患者实际情况决定。' +
    ` 生成时间：${t}`
  );
}

/**
 * 检索本地资料片段；命中不足时附加已启用的专业网站元数据，并尽量抓取公开摘要
 * @param {string} scenarioKey - buildSearchQueryForScenario 的键
 */
async function retrieveKbAndMedicalSites(scenarioKey) {
  const q = KnowledgeBaseService.buildSearchQueryForScenario(scenarioKey);
  let chunks = [];
  try {
    chunks = await KnowledgeBaseService.searchChunks(q, 5);
  } catch (e) {
    logger.warn('[AiAnalysisService] searchChunks failed', { message: e.message });
  }
  let sites = [];
  let siteExcerpts = [];
  if (chunks.length < 2) {
    try {
      sites = await MedicalSiteService.listEnabledSitesForPrompt(8);
    } catch (e) {
      logger.warn('[AiAnalysisService] listEnabledSitesForPrompt failed', { message: e.message });
    }
    try {
      siteExcerpts = await MedicalSiteService.fetchEnabledSiteExcerpts(q, 3);
    } catch (e) {
      logger.warn('[AiAnalysisService] fetchEnabledSiteExcerpts failed', { message: e.message });
    }
  }
  const kbSnippets = chunks.map((c, i) => ({
    id: c.id,
    label: `KB${i + 1}`,
    text: c.content_text,
  }));
  return {
    retrieval: {
      kb_chunk_count: chunks.length,
      kb_query: q,
      medical_site_keys: sites.map((s) => s.site_key),
      medical_site_names: sites.map((s) => s.display_name),
      medical_site_excerpt_names: siteExcerpts.map((s) => s.display_name),
      web_excerpt_count: siteExcerpts.length,
      used_web_fallback: false,
    },
    kbSnippets,
    medicalSites: sites,
    medicalSiteExcerpts: siteExcerpts,
  };
}

function formatKbAndSitesForSystem(kbSnippets, medicalSites, medicalSiteExcerpts = []) {
  let s = '';
  if (kbSnippets.length) {
    s +=
      '\n\n【📚 本地知识库检索片段】（引用时标注来源为 [📚 本地知识库]）：\n' +
      kbSnippets.map((x) => `[${x.label}] ${x.text}`).join('\n');
  } else {
    s += '\n\n【📚 本地知识库】本次未命中片段。';
  }
  if (medicalSites.length) {
    s +=
      '\n\n【🌐 已启用专业网站（仅作查阅指引，标注 [🌐 专业网站: 名称]）】\n' +
      medicalSites
        .map(
          (m) =>
            `- ${m.display_name}：${m.guidelines_url || m.base_url || ''}`,
        )
        .join('\n');
  }
  if (medicalSiteExcerpts.length) {
    s +=
      '\n\n【🌐 专业网站公开摘要】（可引用为 [🌐 专业网站: 名称]）：\n' +
      medicalSiteExcerpts
        .map((item) => `[🌐 专业网站: ${item.display_name}] ${item.excerpt}`)
        .join('\n');
  }
  return s;
}

/** 本地知识库标题日期后缀（不含患者标识） */
function kbTitleDateSuffix() {
  return formatDate(new Date());
}

/**
 * 将本次 RAG 命中的资料片段拼接为入库正文（与注入模型的 [KBn] 顺序一致）
 * @param {Array<{ text?: string, content_text?: string }>} kbSnippets
 * @returns {string}
 */
function formatKbSnippetsForPersist(kbSnippets) {
  if (!Array.isArray(kbSnippets) || kbSnippets.length === 0) return '';
  const parts = kbSnippets
    .map((s, i) => {
      const t = String(s.text ?? s.content_text ?? '')
        .trim();
      if (!t) return '';
      return `[KB${i + 1}] ${t}`;
    })
    .filter(Boolean);
  return parts.join('\n\n');
}

/**
 * 供前端提示：入库内容简要概览（无 PII）
 * @param {Array<{ text?: string, content_text?: string, id?: string }>} kbSnippets
 * @param {{ kbQuery?: string|null, scenario?: string|null, subcategory?: string|null }} opts
 */
function buildKbSaveOverview(kbSnippets, opts = {}) {
  const { kbQuery = null, scenario = null, subcategory = null } = opts;
  const list = Array.isArray(kbSnippets) ? kbSnippets : [];
  const nonEmpty = list.filter((s) => String(s.text ?? s.content_text ?? '').trim());
  const chunk_count = nonEmpty.length;
  let text_preview = '';
  if (nonEmpty.length > 0) {
    const t = String(nonEmpty[0].text ?? nonEmpty[0].content_text ?? '').trim();
    text_preview = t.length > 220 ? `${t.slice(0, 220)}…` : t;
  }
  const out = {
    chunk_count,
    kb_query: kbQuery ? String(kbQuery).slice(0, 500) : undefined,
    scenario: scenario ? String(scenario) : undefined,
    subcategory:
      subcategory != null && subcategory !== '' ? String(subcategory).slice(0, 200) : undefined,
    text_preview: text_preview || undefined,
  };
  return out;
}

async function summarizeKbSnippetsForPersist({ persistText, scenario, subcategory, title }) {
  const source = String(persistText || '').trim();
  if (!source) return '';
  const result = await callQwen({
    systemPrompt:
      '你是血液透析室知识库资料整理助手。请把检索到的资料片段整理为可入库的中文知识摘要，禁止新增未在原文出现的事实，禁止保留患者姓名、身份证、手机号等敏感信息。',
    userPrompt:
      `请围绕场景「${scenario || '通用'}」${subcategory ? `、子类「${subcategory}」` : ''}整理以下资料。` +
      `标题建议：${title || 'AI资料整理'}。\n\n` +
      '输出要求：\n' +
      '1. 用 3-6 条要点总结核心信息。\n' +
      '2. 保留关键阈值、适用条件、处理建议和来源线索。\n' +
      '3. 删除重复、碎片化和无关内容。\n' +
      '4. 不输出内部片段编号。\n\n' +
      `资料片段：\n${source.slice(0, 30000)}`,
    context: null,
    useBaseClinicalPrompt: false,
    appendDisclaimer: false,
    taskType: 'long_summary',
  });
  return String(result.content || '').trim();
}

/**
 * 用户勾选「保存到本地知识库」时写入 kb_*：先将检索片段整理总结，再保存摘要；默认不保存
 * @param {object} p
 * @param {boolean} p.saveToKb
 * @param {string|null} p.userId
 * @param {string} p.scenario AI_KB_SCENARIO
 * @param {string|null} [p.subcategory]
 * @param {string} p.title
 * @param {Array<{ text?: string, content_text?: string }>} p.kbSnippets 本次检索片段（与 prompt 一致）
 * @param {string|null} [p.kbQuery] 检索关键词/查询串（供前端展示）
 */
async function persistAiKbIfRequested({
  saveToKb,
  userId,
  scenario,
  subcategory,
  title,
  kbSnippets,
  kbQuery = null,
}) {
  const overviewMeta = { kbQuery, scenario, subcategory };
  if (!saveToKb) {
    return { kb_save: { skipped: true } };
  }
  const persistText = formatKbSnippetsForPersist(kbSnippets || []);
  if (!persistText.trim()) {
    return {
      kb_save: {
        skipped: false,
        saved: false,
        reason: 'no_kb_chunks',
        overview: buildKbSaveOverview([], overviewMeta),
      },
    };
  }
  const overview = buildKbSaveOverview(kbSnippets || [], overviewMeta);
  let summarizedPersistText = '';
  try {
    summarizedPersistText = await summarizeKbSnippetsForPersist({
      persistText,
      scenario,
      subcategory,
      title,
    });
  } catch (e) {
    logger.warn('[AiAnalysisService] summarizeKbSnippetsForPersist failed', { message: e.message });
    return {
      kb_save: {
        skipped: false,
        saved: false,
        error: 'summary_failed',
        overview,
      },
    };
  }
  if (!summarizedPersistText.trim()) {
    return {
      kb_save: {
        skipped: false,
        saved: false,
        error: 'summary_empty',
        overview,
      },
    };
  }
  let saveRequestId = null;
  try {
    saveRequestId = await KnowledgeBaseService.recordSaveRequest({
      contentHash: crypto.createHash('sha256').update(summarizedPersistText).digest('hex'),
      title,
      sourceTier: 1,
      userId,
      decision: 'approved',
    });
  } catch (e) {
    logger.warn('[AiAnalysisService] recordSaveRequest failed', { message: e.message });
  }
  try {
    const tags = [scenario, subcategory].filter(Boolean).join(' ').trim();
    const r = await KnowledgeBaseService.recordSessionSummary({
      title,
      summaryText: summarizedPersistText,
      tags,
      scenario,
      subcategory,
      userId,
    });
    if (r.duplicate) {
      await KnowledgeBaseService.attachSaveRequestKbEntry(saveRequestId, r.documentId || null);
      return {
        kb_save: {
          skipped: false,
          saved: false,
          duplicate: true,
          document_id: r.documentId || undefined,
          overview,
        },
      };
    }
    if (r.saved) {
      await KnowledgeBaseService.attachSaveRequestKbEntry(saveRequestId, r.documentId || null);
      return {
        kb_save: {
          skipped: false,
          saved: true,
          duplicate: false,
          document_id: r.documentId || undefined,
          overview,
        },
      };
    }
    return {
      kb_save: {
        skipped: false,
        saved: false,
        error: 'persist_failed',
        overview,
      },
    };
  } catch (e) {
    logger.warn('[AiAnalysisService] persistAiKbIfRequested failed', { message: e.message });
    return {
      kb_save: {
        skipped: false,
        saved: false,
        error: 'persist_failed',
        overview,
      },
    };
  }
}

const DEFAULT_QWEN_BASE_URL =
  'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

/**
 * 解析 AI 调用配置：优先 QWEN_*，与 backend/.env.example 中 AI_API_KEY 等兼容。
 */
function resolveAiConfig(taskType = 'general') {
  const route = {
    long_summary: 'kimi',
    guideline_note: 'kimi',
    medical_qa_cn: 'zhipu',
    nlp_query: 'zhipu',
    anomaly_reasoning: 'deepseek',
    qc_reasoning: 'deepseek',
  };
  const provider = route[taskType] || 'default';
  const providerConfigs = {
    kimi: () => process.env.KIMI_API_KEY && ({
      apiKey: process.env.KIMI_API_KEY,
      baseUrl: process.env.KIMI_BASE_URL || 'https://api.moonshot.cn/v1/chat/completions',
      model: process.env.KIMI_MODEL || 'moonshot-v1-8k',
    }),
    zhipu: () => process.env.ZHIPU_API_KEY && ({
      apiKey: process.env.ZHIPU_API_KEY,
      baseUrl: process.env.ZHIPU_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
      model: process.env.ZHIPU_MODEL || 'glm-4-flash',
    }),
    deepseek: () => process.env.DEEPSEEK_API_KEY && ({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/chat/completions',
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    }),
    doubao: () => process.env.DOUBAO_API_KEY && ({
      apiKey: process.env.DOUBAO_API_KEY,
      baseUrl: process.env.DOUBAO_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
      model: process.env.DOUBAO_MODEL || 'doubao-1-5-pro-32k',
    }),
    openai: () => process.env.OPENAI_API_KEY && ({
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1/chat/completions',
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    }),
  };
  const selected = providerConfigs[provider]?.();
  if (selected) return selected;
  const fallbackProvider = String(process.env.AI_FALLBACK_PROVIDER || '').trim().toLowerCase();
  const fallbackSelected = providerConfigs[fallbackProvider]?.();
  if (fallbackSelected) return fallbackSelected;
  for (const key of ['deepseek', 'zhipu', 'kimi', 'doubao', 'openai']) {
    const cfg = providerConfigs[key]?.();
    if (cfg) return cfg;
  }
  const apiKey = process.env.QWEN_API_KEY || process.env.AI_API_KEY || '';
  const baseUrl = process.env.QWEN_BASE_URL || process.env.AI_BASE_URL || DEFAULT_QWEN_BASE_URL;
  const model = process.env.QWEN_MODEL || process.env.AI_MODEL || 'qwen3-max';
  return { apiKey, baseUrl, model };
}

/** 通义单次 HTTP 等待上限（与前端 90s 对齐；深度推理建议更长） */
const DEFAULT_QWEN_HTTP_TIMEOUT_MS = 90000;

function resolveQwenHttpTimeoutMs() {
  const raw = process.env.QWEN_HTTP_TIMEOUT_MS || process.env.AI_HTTP_TIMEOUT_MS;
  if (raw === undefined || raw === '') return DEFAULT_QWEN_HTTP_TIMEOUT_MS;
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n)) return DEFAULT_QWEN_HTTP_TIMEOUT_MS;
  return Math.min(120000, Math.max(10000, n));
}

/** 趋势分析月数：1–24 整数，非法则回退为 3 */
function normalizeTrendMonths(months) {
  const m = Number.parseInt(String(months), 10);
  if (!Number.isFinite(m)) return 3;
  return Math.min(24, Math.max(1, m));
}

/** 异常分析需包含概括、分条（依据+建议+指南来源）与来源汇总，400 字会截断句子；与提示词「约 600–1500 字」对齐 */
const MAX_ANOMALY_CHARS = 2200;

function truncateText(s, maxLen) {
  if (typeof s !== 'string' || !s) return s;
  const arr = Array.from(s);
  if (arr.length <= maxLen) return s;
  return arr.slice(0, maxLen).join('') + '…';
}

/** 保留末尾免责声明块，仅截断正文 */
function truncatePreservingAiFooter(content, maxMain) {
  if (typeof content !== 'string') return content;
  const marker = '\n\n---\n⚠️';
  const i = content.indexOf(marker);
  if (i === -1) return truncateText(content, maxMain + 400);
  const main = truncateText(content.slice(0, i), maxMain);
  return main + content.slice(i);
}

async function safeQuery(sql, params) {
  const client = await pool.connect();
  try {
    const res = await client.query(sql, params);
    return res.rows;
  } finally {
    client.release();
  }
}

/**
 * 通用通义千问调用
 * @param {object} options
 * @param {string} options.systemPrompt - 任务专属系统提示
 * @param {string} options.userPrompt   - 用户提问或任务描述
 * @param {object} [options.context]    - 附带的结构化 JSON 上下文
 * @param {boolean} [options.useBaseClinicalPrompt=true] - 是否拼接 CLINICAL_BASE_SYSTEM_PROMPT
 * @param {boolean} [options.appendDisclaimer=true] - 是否在返回 content 中追加 AI 免责声明
 */
async function callQwen({
  systemPrompt,
  userPrompt,
  context,
  contextClosingHint,
  useBaseClinicalPrompt = true,
  appendDisclaimer = true,
  taskType = 'general',
}) {
  const { apiKey, baseUrl, model } = resolveAiConfig(taskType);
  if (!apiKey) {
    const err = new Error(
      'AI 服务未配置：请设置 QWEN_API_KEY、AI_API_KEY 或任一模型提供商 API_KEY（见 backend/.env.example）',
    );
    err.statusCode = 503;
    throw err;
  }

  const safety =
    '\n\n重要：请严格避免给出具体诊断或确定性处方，仅以「建议」「提示」表述，所有结论均需以执业医师决策为准。';

  const fullSystem = useBaseClinicalPrompt
    ? `${CLINICAL_BASE_SYSTEM_PROMPT}\n\n${systemPrompt}${safety}`
    : `${systemPrompt}${safety}`;

  const messages = [
    {
      role: 'system',
      content: fullSystem,
    },
    {
      role: 'user',
      content: context
        ? `${userPrompt}\n\n以下是与本次任务相关的结构化数据(JSON)：\n\`\`\`json\n${JSON.stringify(
            context,
            null,
            2,
          )}\n\`\`\`\n${
            contextClosingHint ||
            '请先简要概括数据，再按系统提示的结构分条分析。'
          }`
        : userPrompt,
    },
  ];

  const controller = new AbortController();
  const qwenHttpTimeoutMs = resolveQwenHttpTimeoutMs();
  const timeout = setTimeout(() => controller.abort(), qwenHttpTimeoutMs);

  const requestBody = {
    model,
    messages,
    stream: false,
    temperature: 0.1,
    max_tokens: 4096,
  };
  if (String(process.env.AI_ENABLE_THINKING || 'true').toLowerCase() !== 'false') {
    requestBody.extra_body = { enable_thinking: true };
  }

  try {
    const res = await fetch(baseUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const tryPlain =
        requestBody.extra_body &&
        String(process.env.AI_RETRY_WITHOUT_EXTRA_BODY || 'true').toLowerCase() !== 'false';
      if (tryPlain) {
        logger.warn('[AiAnalysisService] 重试：移除 extra_body（兼容当前兼容接口）');
        const { extra_body: _e, ...rest } = requestBody;
        const res2 = await fetch(baseUrl, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(rest),
        });
        if (!res2.ok) {
          const t2 = await res2.text().catch(() => '');
          logger.error('[AiAnalysisService] Qwen API 响应异常', {
            status: res2.status,
            body: t2?.slice(0, 500),
          });
          throw new Error('AI 服务暂时不可用，请稍后重试');
        }
        const data2 = await res2.json();
        return packageQwenContent(data2, model, { appendDisclaimer });
      }
      logger.error('[AiAnalysisService] Qwen API 响应异常', {
        status: res.status,
        body: text?.slice(0, 500),
      });
      throw new Error('AI 服务暂时不可用，请稍后重试');
    }

    const data = await res.json();
    return packageQwenContent(data, model, { appendDisclaimer });
  } catch (err) {
    if (err.name === 'AbortError') {
      logger.warn('[AiAnalysisService] Qwen 请求超时');
      throw new Error('AI 服务响应超时，请稍后重试');
    }
    if (err.message && err.message.includes('AI 服务')) throw err;
    logger.error('[AiAnalysisService] 调用 Qwen 失败', {
      message: err.message,
    });
    throw new Error('AI 分析服务调用失败，请稍后重试');
  } finally {
    clearTimeout(timeout);
  }
}

function packageQwenContent(data, model, { appendDisclaimer = true } = {}) {
  const raw =
    data?.choices?.[0]?.message?.content || 'AI 分析结果为空，请稍后重试。';
  const generatedAt = new Date().toISOString();
  const displayModel = model || 'qwen3-max';
  const disclaimer = buildFullDisclaimer(generatedAt, displayModel);
  const content = appendDisclaimer
    ? `${raw.trim()}\n\n---\n${disclaimer}\n---`
    : raw.trim();
  return {
    content,
    ai_disclaimer: disclaimer,
    model: displayModel,
    generated_at: generatedAt,
  };
}

class AiAnalysisService {
  /**
   * 构造单患者近 N 个月透析趋势数据
   */
  async buildDialysisTrendPayload(patientId, months = 3) {
    const safeMonths = normalizeTrendMonths(months);
    const sql = `
      SELECT
        id,
        session_date,
        ktv,
        urr,
        pre_weight,
        post_weight,
        uf_volume,
        actual_duration,
        blood_flow_rate,
        dialysate_flow_rate,
        uf_pct_of_dry_weight,
        is_circuit_clotted,
        is_membrane_ruptured
      FROM dialysis_records
      WHERE patient_id = $1
        AND session_date >= (CURRENT_DATE - ($2::int * INTERVAL '1 month'))
      ORDER BY session_date ASC;
    `;
    const rows = await safeQuery(sql, [patientId, safeMonths]);
    return {
      patientId,
      months: safeMonths,
      sessions: rows,
    };
  }

  /**
   * 构造最近一次检验结果面板
   */
  async buildLabPanelPayload(patientId) {
    const sql = `
      SELECT *
      FROM lab_results
      WHERE patient_id = $1
      ORDER BY test_date DESC, created_at DESC
      LIMIT 40;
    `;
    const rows = await safeQuery(sql, [patientId]);
    return {
      patientId,
      latestLab: rows[0] || null,
      recentLabs: rows,
    };
  }

  /**
   * 构造单次透析记录及其 Kt/V 相关参数
   */
  async buildKtvRootCausePayload(dialysisRecordId) {
    const sql = `
      SELECT
        dr.id,
        dr.patient_id,
        dr.session_date,
        dr.ktv,
        dr.urr,
        dr.actual_duration,
        dr.blood_flow_rate,
        dr.dialysate_flow_rate,
        dr.pre_weight,
        dr.post_weight,
        dr.uf_volume,
        dr.is_circuit_clotted,
        dr.is_membrane_ruptured,
        dr.puncture_result,
        dr.notes
      FROM dialysis_records dr
      WHERE dr.id = $1;
    `;
    const [row] = await safeQuery(sql, [dialysisRecordId]);
    return {
      dialysisRecordId,
      record: row || null,
    };
  }

  /**
   * CVC 高危评分结果包装
   */
  async buildCvcRiskPayload(assessmentId) {
    const sql = `
      SELECT
        id,
        patient_id,
        total_score,
        risk_grade,
        diabetes_mellitus,
        immunosuppressed,
        recent_hospitalization,
        catheter_days_over90,
        previous_crbsi,
        poor_hygiene,
        assessed_at,
        intervention_notes
      FROM cvc_risk_assessments
      WHERE id = $1;
    `;
    const [row] = await safeQuery(sql, [assessmentId]);
    if (!row) {
      return { assessmentId, assessment: null };
    }

    const factors = [];
    if (row.diabetes_mellitus) factors.push('糖尿病');
    if (row.immunosuppressed) factors.push('免疫抑制');
    if (row.recent_hospitalization) factors.push('近期住院');
    if (row.catheter_days_over90) factors.push('留管>90天');
    if (row.previous_crbsi) factors.push('既往 CRBSI');
    if (row.poor_hygiene) factors.push('卫生依从性差');

    const riskGradeText =
      row.risk_grade === 3 ? '高' : row.risk_grade === 2 ? '中' : '低';

    return {
      assessmentId,
      assessment: {
        id: row.id,
        patient_id: row.patient_id,
        score: row.total_score,
        risk_grade: row.risk_grade,
        risk: riskGradeText,
        factors,
        assessed_at: row.assessed_at,
        intervention_notes: row.intervention_notes,
      },
    };
  }

  /**
   * 单患者透析趋势解读
   */
  async analyzePatientTrend(patientId, months, opts = {}) {
    const saveToKb = Boolean(opts.saveToKb);
    const userId = opts.userId || null;
    const payload = await this.buildDialysisTrendPayload(patientId, months);
    const { retrieval, kbSnippets, medicalSites, medicalSiteExcerpts } =
      await retrieveKbAndMedicalSites('patient_trend');
    const kbBlock = formatKbAndSitesForSystem(kbSnippets, medicalSites, medicalSiteExcerpts);
    const systemPrompt =
      '你是血液透析领域的临床质控助手，负责解读透析充分性与容量管理趋势。' + kbBlock;
    const userPrompt =
      '请根据近几个月的透析记录数据，从 Kt/V、URR、体重和超滤量等角度，总结透析充分性与容量管理趋势，并指出需要关注的问题。上下文中若无患者姓名，不得编造。';
    const result = await callQwen({
      systemPrompt,
      userPrompt,
      context: payload,
      taskType: 'long_summary',
    });
    const kb = await persistAiKbIfRequested({
      saveToKb,
      userId,
      scenario: AI_KB_SCENARIO.PATIENT_TREND,
      subcategory: String(payload.months),
      title: `透析趋势解读 · ${payload.months}个月 · ${kbTitleDateSuffix()}`,
      kbSnippets,
      kbQuery: retrieval.kb_query,
    });
    return { ...result, retrieval, ...kb };
  }

  /**
   * 检验结果综合分析
   */
  async analyzeLabs(patientId, opts = {}) {
    const saveToKb = Boolean(opts.saveToKb);
    const userId = opts.userId || null;
    const payload = await this.buildLabPanelPayload(patientId);
    const { retrieval, kbSnippets, medicalSites, medicalSiteExcerpts } =
      await retrieveKbAndMedicalSites('labs_analysis');
    const kbBlock = formatKbAndSitesForSystem(kbSnippets, medicalSites, medicalSiteExcerpts);
    const systemPrompt =
      '你是一名熟悉血液透析患者检验指标的临床决策支持助手，了解 KDIGO 与国内相关指南的目标范围。' +
      kbBlock;
    const userPrompt =
      '请对检验结果做综合分析，区分达标与异常指标，并给出需关注的方向。不得编造未在数据中出现的化验值。';
    const result = await callQwen({
      systemPrompt,
      userPrompt,
      context: payload,
      taskType: 'medical_qa_cn',
    });
    const kb = await persistAiKbIfRequested({
      saveToKb,
      userId,
      scenario: AI_KB_SCENARIO.LABS,
      subcategory: null,
      title: `检验结果分析 · ${kbTitleDateSuffix()}`,
      kbSnippets,
      kbQuery: retrieval.kb_query,
    });
    return { ...result, retrieval, ...kb };
  }

  /**
   * Kt/V 不达标原因辅助分析
   */
  async analyzeKtvRootCause(dialysisRecordId, opts = {}) {
    const saveToKb = Boolean(opts.saveToKb);
    const userId = opts.userId || null;
    const payload = await this.buildKtvRootCausePayload(dialysisRecordId);
    const { retrieval, kbSnippets, medicalSites, medicalSiteExcerpts } =
      await retrieveKbAndMedicalSites('ktv_root_cause');
    const kbBlock = formatKbAndSitesForSystem(kbSnippets, medicalSites, medicalSiteExcerpts);
    const systemPrompt =
      '你是血液透析充分性评估助手，擅长根据透析参数分析 Kt/V 不达标的可能原因。' + kbBlock;
    const userPrompt =
      '根据这次透析记录，分析若 Kt/V 或 URR 不达标，最可能的原因有哪些，并按优先级列出可供参考的优化方向（避免给出具体处方）。';
    const result = await callQwen({
      systemPrompt,
      userPrompt,
      context: payload,
      taskType: 'anomaly_reasoning',
    });
    const kb = await persistAiKbIfRequested({
      saveToKb,
      userId,
      scenario: AI_KB_SCENARIO.KTV_ROOT_CAUSE,
      subcategory: dialysisRecordId,
      title: `Kt/V 原因分析 · ${kbTitleDateSuffix()}`,
      kbSnippets,
      kbQuery: retrieval.kb_query,
    });
    return { ...result, retrieval, ...kb };
  }

  /**
   * CVC 感染高危评分解读
   */
  async analyzeCvcRisk(assessmentId, opts = {}) {
    const saveToKb = Boolean(opts.saveToKb);
    const userId = opts.userId || null;
    const payload = await this.buildCvcRiskPayload(assessmentId);
    const { retrieval, kbSnippets, medicalSites, medicalSiteExcerpts } =
      await retrieveKbAndMedicalSites('cvc_risk');
    const kbBlock = formatKbAndSitesForSystem(kbSnippets, medicalSites, medicalSiteExcerpts);
    const systemPrompt =
      '你是血液透析导管感染预防助手，熟悉 CRBSI 相关指南与风险评估方法。' + kbBlock;
    const userPrompt =
      '请结合评分结果和各个风险因素，解释当前 CVC 感染风险等级，并给出护理观察要点和建议干预措施（不替代医生决策）。';
    const result = await callQwen({
      systemPrompt,
      userPrompt,
      context: payload,
      taskType: 'anomaly_reasoning',
    });
    const kb = await persistAiKbIfRequested({
      saveToKb,
      userId,
      scenario: AI_KB_SCENARIO.CVC_RISK,
      subcategory: assessmentId,
      title: `CVC 高危解读 · ${kbTitleDateSuffix()}`,
      kbSnippets,
      kbQuery: retrieval.kb_query,
    });
    return { ...result, retrieval, ...kb };
  }

  /**
   * 自然语言查询：由后续 NlpQueryService 编排后调用
   */
  async answerNlpQuery(query, context, opts = {}) {
    const saveToKb = Boolean(opts.saveToKb);
    const userId = opts.userId || null;
    let resolvedContext = context;
    let queryExecution = null;
    if (!resolvedContext) {
      const planned = await NlpQueryService.executeQuery(query);
      resolvedContext = planned.context;
      queryExecution = planned.meta;
    }
    const queryMode = queryExecution?.query_mode || resolvedContext?.query_execution?.query_mode || 'medical_qa';
    const { retrieval, kbSnippets, medicalSites, medicalSiteExcerpts } =
      await retrieveKbAndMedicalSites('nlp_query');
    const kbBlock = formatKbAndSitesForSystem(kbSnippets, medicalSites, medicalSiteExcerpts);
    const modePromptMap = {
      structured_query:
        '当前模式为结构化查询解读。你只能基于 query_execution 与 result_rows/result_summary 回答，不得补充未提供的数据。',
      medical_qa:
        '当前模式为通用医学问答。可结合知识库与公开医学资料做原理解释，但不得虚构患者具体检验值或病历事实。',
      patient_context_qa:
        '当前模式为患者相关问答兜底。若缺少可核验的患者结构化数据，需先说明数据边界，再给通用临床思路与补充信息建议。',
      unsupported_sensitive:
        '当前模式为安全拦截。请不要输出患者结论，先明确缺少可核验患者标识，并指导用户补充患者 ID 或完整姓名后再查询。',
    };
    const systemPrompt =
      '你是血液透析室的数据解读助手，会结合系统统计结果，用自然语言向医护人员解释情况。' +
      (modePromptMap[queryMode] || modePromptMap.medical_qa) +
      kbBlock;
    const safeQueryForPrompt =
      queryMode === 'structured_query'
        ? queryExecution?.summary || '结构化查询解读'
        : queryMode === 'unsupported_sensitive'
          ? '患者相关查询（患者标识不足、未匹配或存在歧义）'
          : query;
    const userPrompt =
      '以下是医护人员的自然语言查询，请结合提供的结构化统计结果，用简洁的简体中文回答，并避免编造未在数据中出现的信息。\n\n查询：' +
      safeQueryForPrompt;
    const result = await callQwen({
      systemPrompt,
      userPrompt,
      context: resolvedContext,
      taskType: 'nlp_query',
    });
    const kb = await persistAiKbIfRequested({
      saveToKb,
      userId,
      scenario: AI_KB_SCENARIO.NLP,
      subcategory: null,
      title: `自然语言查询 · ${kbTitleDateSuffix()}`,
      kbSnippets,
      kbQuery: retrieval.kb_query,
    });
    return {
      ...result,
      retrieval: { ...retrieval, query_mode: queryMode },
      query_execution: queryExecution,
      ...kb,
    };
  }

  /**
   * 用药建议说明（仅医生/Admin 使用）
   */
  async analyzeMedicationPlan(patientId, summary, opts = {}) {
    const saveToKb = Boolean(opts.saveToKb);
    const userId = opts.userId || null;
    const plan = await MedicationRuleService.buildMedicationGuidancePlan(patientId, {
      anticoagulantKey: 'heparin',
    });
    const { rows: citations } = await pool.query(
      `SELECT code, title, source_name, excerpt_text FROM guideline_citations ORDER BY code`,
    );
    const { retrieval, kbSnippets, medicalSites, medicalSiteExcerpts } =
      await retrieveKbAndMedicalSites('medication_advice');
    const kbBlock = formatKbAndSitesForSystem(kbSnippets, medicalSites, medicalSiteExcerpts);
    const systemPrompt =
      '你是血液透析患者药物管理辅助助手，只能根据下方「规则要点」与「指南摘录」给出需关注点，不得给出具体处方或剂量；禁止引用未提供的条文。' +
      kbBlock;
    const userPrompt =
      '请根据规则要点、指南摘录与近期检验摘要，用分点说明需评估方向（避免直接剂量调整方案）。';
    const context = {
      patientId,
      summary,
      rule_plan: plan.plan_points,
      rule_issues: plan.rule_issues,
      recent_labs_summary: plan.recent_labs_summary,
      guideline_citations: citations,
    };
    const result = await callQwen({
      systemPrompt,
      userPrompt,
      context,
      taskType: 'medical_qa_cn',
    });
    const kb = await persistAiKbIfRequested({
      saveToKb,
      userId,
      scenario: AI_KB_SCENARIO.MEDICATION,
      subcategory: null,
      title: `用药建议辅助 · ${kbTitleDateSuffix()}`,
      kbSnippets,
      kbQuery: retrieval.kb_query,
    });
    return { ...result, retrieval, ...kb };
  }

  /**
   * 指南/共识读书笔记生成（供 GuidelineReaderService 调用）
   * @param {string} rawText
   * @param {object} [meta]
   */
  async generateGuidelineReadingNote(rawText, meta = {}) {
    const text = String(rawText || '').trim().slice(0, 65000);
    if (!text) {
      const err = new Error('正文为空，无法生成读书笔记');
      err.statusCode = 400;
      throw err;
    }
    const { retrieval, kbSnippets, medicalSites, medicalSiteExcerpts } =
      await retrieveKbAndMedicalSites('guideline_note');
    const kbBlock = formatKbAndSitesForSystem(kbSnippets, medicalSites, medicalSiteExcerpts);
    const systemPrompt =
      '你是血液净化领域指南解读助手，须按用户要求的固定结构输出读书笔记，不得编造指南条文。' +
      kbBlock;
    const titleHint = meta.title ? `文献标题提示：${meta.title}\n` : '';
    const userPrompt =
      `${titleHint}请阅读以下正文，按以下结构用简体中文输出（使用 Markdown 标题）：\n` +
      '【指南基本信息】【核心推荐意见】【关键数值指标】【与现行规程的差异】【对本科室的实践指导】【关键词标签】\n\n' +
      '正文如下：\n' +
      text;
    const result = await callQwen({
      systemPrompt,
      userPrompt,
      context: null,
      useBaseClinicalPrompt: true,
      taskType: 'guideline_note',
    });
    return { ...result, retrieval };
  }

  /**
   * 异常分析：先检索资料库片段，再调用模型；结果写入库供后续命中
   * @param {object} p
   * @param {string} p.patientId
   * @param {string} p.anomalyType
   * @param {string} [p.contextId]
   * @param {string} [p.userId]
   * @param {boolean} [p.saveToKb] 是否写入本地知识库（须用户显式勾选）
   */
  async analyzeAnomaly({ patientId, anomalyType, contextId = null, userId = null, saveToKb = false }) {
    const built = await buildAnomalyEvidencePayload({
      patientId,
      anomalyType,
      contextId,
    });

    const kbQuery = KnowledgeBaseService.buildSearchQueryForAnomaly(built.anomalyType);
    const chunks = await KnowledgeBaseService.searchChunks(kbQuery, 5);
    let usedWeb = false;
    let webSummary = await KnowledgeBaseService.maybeFetchWebSummary(kbQuery);
    if (!chunks.length && !webSummary && KnowledgeBaseService.isWebSearchEnabled()) {
      usedWeb = true;
    }

    let medicalSites = [];
    if (chunks.length < 2) {
      try {
        medicalSites = await MedicalSiteService.listEnabledSitesForPrompt(8);
      } catch (e) {
        logger.warn('[AiAnalysisService] anomaly medical sites', { message: e.message });
      }
    }

    const chunkIds = chunks.map((c) => c.id);
    await KnowledgeBaseService.logUsage({
      requestKind: 'anomaly_analysis',
      patientId,
      anomalyType: built.anomalyType,
      queryText: kbQuery,
      retrievedChunkIds: chunkIds,
      usedWebFallback: usedWeb,
      userId,
    });

    const kbSnippets = chunks.map((c) => ({
      id: c.id,
      text: c.content_text,
    }));

    const { systemPrompt, userPrompt } = getAnomalyAnalysisPrompts(built.anomalyType);
    let systemAugmented =
      systemPrompt +
      '\n\n以下「资料库检索片段」仅供参考，须与患者结构化数据一致时再引用：';
    if (kbSnippets.length) {
      systemAugmented += '\n' + kbSnippets.map((s, i) => `[KB${i + 1}] ${s.text}`).join('\n');
    } else {
      systemAugmented += '\n（本次未命中资料库片段）';
    }
    if (webSummary) {
      systemAugmented += '\n【外部摘要】' + webSummary;
      usedWeb = true;
    }
    if (medicalSites.length) {
      systemAugmented +=
        '\n\n【🌐 已启用专业网站（仅作查阅指引）】\n' +
        medicalSites
          .map((m) => `- ${m.display_name}：${m.guidelines_url || m.base_url || ''}`)
          .join('\n');
    }
    systemAugmented +=
      '\n\n【语言】全文必须使用简体中文。';

    const contextPayload = {
      evidence: built.evidence,
      ...built.context,
      kbSnippets,
    };

    const result = await callQwen({
      systemPrompt: systemAugmented,
      userPrompt,
      context: contextPayload,
      contextClosingHint:
        '请严格按系统提示的 Markdown 结构输出：数据简要概括 → 分条分析（每条含依据、处理建议、指南/共识与来源，写完整勿中断）→ 指南与来源汇总。' +
        '正文中勿出现 JSON 字段名（如 labs3m、focusLab）；依据与处理建议须用中文可读表述。',
      useBaseClinicalPrompt: false,
      taskType: 'anomaly_reasoning',
    });

    const sanitizedContent = sanitizeAnomalyAnalysisDisplayText(result.content || '');

    const retrieval = {
      kb_chunk_count: chunks.length,
      kb_query: kbQuery,
      medical_site_keys: medicalSites.map((s) => s.site_key),
      medical_site_names: medicalSites.map((s) => s.display_name),
      used_web_fallback: usedWeb,
    };

    const kb = await persistAiKbIfRequested({
      saveToKb,
      userId,
      scenario: AI_KB_SCENARIO.ANOMALY,
      subcategory: built.anomalyType,
      title: `异常分析 · ${built.anomalyType} · ${kbTitleDateSuffix()}`,
      kbSnippets,
      kbQuery,
    });

    return {
      content: truncatePreservingAiFooter(sanitizedContent, MAX_ANOMALY_CHARS),
      ai_disclaimer: result.ai_disclaimer,
      evidence: built.evidence,
      kb_chunks_used: chunkIds,
      used_web_fallback: usedWeb,
      retrieval,
      model: result.model,
      generated_at: result.generated_at,
      ...kb,
    };
  }

  /**
   * 月度质控聚合解读：仅引用 qc_reports 已存字段，不重算 ReportGenerator 公式
   * @param {object} p
   * @param {number} p.year
   * @param {number} p.month
   * @param {number} [p.historyMonths]
   * @param {string} [p.userQuestion]
   * @param {string|null} [p.userId]
   * @param {boolean} [p.saveToKb]
   */
  async analyzeQcMonthlyInsight({
    year,
    month,
    historyMonths = 6,
    userQuestion = '',
    userId = null,
    saveToKb = false,
  }) {
    if (String(process.env.AI_QC_MONTHLY_INSIGHT_ENABLED || 'true').toLowerCase() === 'false') {
      const err = new Error('月度质控 AI 解读功能未启用');
      err.statusCode = 503;
      throw err;
    }
    const yy = parseInt(year, 10);
    const mm = parseInt(month, 10);
    if (!yy || mm < 1 || mm > 12) {
      const err = new Error('year、month 参数无效');
      err.statusCode = 400;
      throw err;
    }
    const hist = Math.min(24, Math.max(1, parseInt(historyMonths, 10) || 6));

    const { rows: targetRows } = await pool.query(
      `SELECT * FROM qc_reports WHERE report_year = $1 AND report_month = $2`,
      [yy, mm],
    );
    if (!targetRows.length) {
      const err = new Error(
        '该月质控月报尚未生成，请先在「质控上报报表」中选择该月份加载数据后再试',
      );
      err.statusCode = 400;
      throw err;
    }

    const { rows: historyRows } = await pool.query(
      `SELECT * FROM qc_reports
       WHERE (report_year < $1 OR (report_year = $1 AND report_month < $2))
       ORDER BY report_year DESC, report_month DESC
       LIMIT $3`,
      [yy, mm, hist],
    );

    const rowToEv = (r) => ({
      report_year: r.report_year,
      report_month: r.report_month,
      status: r.status,
      total_patient_sessions: r.total_patient_sessions,
      total_nurse_sessions: r.total_nurse_sessions,
      nurse_patient_ratio: r.nurse_patient_ratio,
      total_sessions: r.total_sessions,
      circuit_clotting_count: r.circuit_clotting_count,
      circuit_clotting_rate: r.circuit_clotting_rate,
      membrane_rupture_count: r.membrane_rupture_count,
      membrane_rupture_rate: r.membrane_rupture_rate,
      avf_sessions: r.avf_sessions,
      puncture_injury_count: r.puncture_injury_count,
      puncture_injury_rate: r.puncture_injury_rate,
      cvc_catheter_days: r.cvc_catheter_days,
      crbsi_count: r.crbsi_count,
      crbsi_rate: r.crbsi_rate,
      updated_at: r.updated_at,
    });

    const evidence = {
      source: 'qc_reports',
      targetMonth: rowToEv(targetRows[0]),
      history: historyRows.map(rowToEv),
      numericsNote:
        '上述数值均为系统已写入 qc_reports 的字段。输出中不得改写、重算或编造新数值；引用时须与 JSON 完全一致。',
    };

    const { retrieval, kbSnippets, medicalSites, medicalSiteExcerpts } =
      await retrieveKbAndMedicalSites('qc_monthly_insight');

    const kbBlock = formatKbAndSitesForSystem(kbSnippets, medicalSites, medicalSiteExcerpts);
    const chunkIds = kbSnippets.map((c) => c.id);

    await KnowledgeBaseService.logUsage({
      requestKind: 'qc_monthly_insight',
      patientId: null,
      anomalyType: null,
      queryText: `qc ${yy}-${String(mm).padStart(2, '0')}`,
      retrievedChunkIds: chunkIds,
      usedWebFallback: false,
      userId,
    });

    const systemPrompt =
      '你是血液透析室「质量管理」辅助助手。输入为科室月度汇总指标（无患者个人信息）。\n' +
      '硬性要求：\n' +
      '1. 所有数字、比率、次数必须与上下文 JSON 中 evidence 完全一致，禁止重新计算或改写。\n' +
      '2. 输出为科室管理讨论与持续改进方向草稿，非针对单个患者的诊疗建议。\n' +
      '3. 用简体中文 Markdown：概况 → 趋势与关注点 → 可能改进方向（条列）→ 需人工核实或补充的数据点。\n' +
      '4. 若资料库片段与科室数据冲突，以科室数据为准。\n' +
      kbBlock;

    const uq = String(userQuestion || '').trim();
    const userPrompt =
      `请针对 ${yy} 年 ${mm} 月的科室质控月报撰写辅助解读草稿。\n` +
      (uq ? `用户补充说明：${uq}\n` : '');

    const result = await callQwen({
      systemPrompt,
      userPrompt,
      context: { evidence },
      contextClosingHint:
        '先概括本月五项指标在 evidence.targetMonth 中的数值（照抄数字），再分析趋势与改进方向；勿输出 JSON 字段名。',
      useBaseClinicalPrompt: false,
      taskType: 'qc_reasoning',
    });

    const kb = await persistAiKbIfRequested({
      saveToKb,
      userId,
      scenario: AI_KB_SCENARIO.QC_MONTHLY,
      subcategory: `${yy}-${mm}`,
      title: `质控月报解读 · ${yy}年${mm}月 · ${kbTitleDateSuffix()}`,
      kbSnippets,
      kbQuery: retrieval.kb_query,
    });

    return {
      content: result.content,
      ai_disclaimer: result.ai_disclaimer,
      evidence,
      retrieval,
      model: result.model,
      generated_at: result.generated_at,
      ...kb,
    };
  }

  /**
   * 在阅读异常分析正文后，将当前检索到的资料片段写入本地知识库（与 analyzeAnomaly 入库规则一致）
   * @param {object} p
   * @param {string} p.patientId
   * @param {string} p.anomalyType
   * @param {string|null} [p.userId]
   */
  async saveAnomalyAnalysisKb({ patientId, anomalyType, userId = null }) {
    const pid = String(patientId || '').trim();
    if (!pid) {
      const err = new Error('patientId 为必填参数');
      err.statusCode = 400;
      throw err;
    }
    const type = String(anomalyType || '').trim();
    if (!isValidAnomalyType(type)) {
      const err = new Error('anomalyType 无效');
      err.statusCode = 400;
      throw err;
    }
    const { rows } = await pool.query('SELECT id FROM patients WHERE id = $1', [pid]);
    if (!rows.length) {
      const err = new Error('患者不存在');
      err.statusCode = 404;
      throw err;
    }
    const kbQuery = KnowledgeBaseService.buildSearchQueryForAnomaly(type);
    const chunks = await KnowledgeBaseService.searchChunks(kbQuery, 5);
    const kbSnippets = chunks.map((c) => ({
      id: c.id,
      text: c.content_text,
    }));
    return persistAiKbIfRequested({
      saveToKb: true,
      userId,
      scenario: AI_KB_SCENARIO.ANOMALY,
      subcategory: type,
      title: `异常分析 · ${type} · ${kbTitleDateSuffix()}`,
      kbSnippets,
      kbQuery,
    });
  }

  /**
   * 将外站网页纯文本摘录整理为简体中文摘要（抓取入库用，非临床诊断）
   * @param {string} excerpt
   * @param {string} [linkTitleHint]
   */
  async summarizeWebExcerptToChinese(excerpt, linkTitleHint = '') {
    const text = String(excerpt || '').trim().slice(0, 25000);
    if (!text) {
      const err = new Error('摘录为空');
      err.statusCode = 400;
      throw err;
    }
    const systemPrompt =
      '你是医学文献编辑。只根据用户给出的网页文字整理摘要，不得编造具体患者数据或虚构文献。';
    const userPrompt =
      (linkTitleHint ? `链接标题提示：${String(linkTitleHint).slice(0, 200)}\n` : '') +
      '请将下列网页文字整理为「简体中文」医学摘要，结构上分为：内容概述、关键要点（分条）、临床相关提示（若原文无则写「原文未详述」）。' +
      '篇幅约800–2000字；专有名词可保留英文缩写。\n\n网页摘录：\n' +
      text;
    const result = await callQwen({
      systemPrompt,
      userPrompt,
      context: null,
      useBaseClinicalPrompt: false,
      taskType: 'long_summary',
    });
    const out = String(result.content || '').trim();
    if (!out) {
      const err = new Error('模型未返回有效简体中文摘要');
      err.statusCode = 502;
      throw err;
    }
    return out;
  }
}

const aiAnalysisServiceSingleton = new AiAnalysisService();

module.exports = Object.assign(aiAnalysisServiceSingleton, {
  callQwen,
  buildFullDisclaimer,
  retrieveKbAndMedicalSites,
  packageQwenContent,
  formatKbSnippetsForPersist,
  buildKbSaveOverview,
});
