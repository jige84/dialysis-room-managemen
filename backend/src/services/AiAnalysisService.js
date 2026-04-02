/**
 * AI 辅助分析服务（通义千问接入层）
 * 主要作用：聚合透析/检验/CVC 等结构化数据，将其与精心设计的 Prompt 一起发送给大模型，
 *          返回经过合规包装的分析结果。
 * 约束要求：
 *  - 不传身份证号、手机号等直接标识符，只使用患者内部ID及必要的医疗指标
 *  - 所有响应统一附带合规免责声明，供前端展示
 */

const { pool } = require('../config/database');
const logger = require('../utils/logger');

const DEFAULT_QWEN_BASE_URL =
  'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

/**
 * 解析 AI 调用配置：优先 QWEN_*，与 backend/.env.example 中 AI_API_KEY 等兼容。
 */
function resolveAiConfig() {
  const apiKey = process.env.QWEN_API_KEY || process.env.AI_API_KEY || '';
  const baseUrl =
    process.env.QWEN_BASE_URL ||
    process.env.AI_BASE_URL ||
    DEFAULT_QWEN_BASE_URL;
  const model =
    process.env.QWEN_MODEL || process.env.AI_MODEL || 'qwen-plus';
  return { apiKey, baseUrl, model };
}

/** 趋势分析月数：1–24 整数，非法则回退为 3 */
function normalizeTrendMonths(months) {
  const m = Number.parseInt(String(months), 10);
  if (!Number.isFinite(m)) return 3;
  return Math.min(24, Math.max(1, m));
}

const AI_DISCLAIMER =
  '本内容由AI生成，仅供医护人员参考，不构成医疗诊断建议。';

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
 * @param {string} options.systemPrompt - 系统提示词（角色/语气/边界）
 * @param {string} options.userPrompt   - 用户提问或任务描述
 * @param {object} [options.context]    - 附带的结构化 JSON 上下文
 */
async function callQwen({ systemPrompt, userPrompt, context }) {
  const { apiKey, baseUrl, model } = resolveAiConfig();
  if (!apiKey) {
    throw new Error(
      'AI 服务未配置：请设置 QWEN_API_KEY 或 AI_API_KEY（见 backend/.env.example）',
    );
  }

  const messages = [
    {
      role: 'system',
      content:
        systemPrompt +
        '\n\n重要：请严格避免给出具体诊断或处方，仅以“建议”“提示”表述，所有结论均需以医生决策为准。',
    },
    {
      role: 'user',
      content: context
        ? `${userPrompt}\n\n以下是与本次任务相关的结构化数据(JSON)：\n\`\`\`json\n${JSON.stringify(
            context,
            null,
            2,
          )}\n\`\`\`\n请先简要概括数据，再分条分析。`
        : userPrompt,
    },
  ];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const res = await fetch(baseUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logger.error('[AiAnalysisService] Qwen API 响应异常', {
        status: res.status,
        body: text?.slice(0, 500),
      });
      throw new Error('AI 服务暂时不可用，请稍后重试');
    }

    const data = await res.json();
    const content =
      data?.choices?.[0]?.message?.content ||
      'AI 分析结果为空，请稍后重试。';

    return {
      content,
      ai_disclaimer: AI_DISCLAIMER,
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      logger.warn('[AiAnalysisService] Qwen 请求超时');
      throw new Error('AI 服务响应超时，请稍后重试');
    }
    logger.error('[AiAnalysisService] 调用 Qwen 失败', {
      message: err.message,
    });
    throw new Error('AI 分析服务调用失败，请稍后重试');
  } finally {
    clearTimeout(timeout);
  }
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
        pre_weight_kg,
        post_weight_kg,
        dry_weight_kg,
        pre_sbp,
        pre_dbp,
        post_sbp,
        post_dbp,
        ultrafiltration_ml,
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
      ORDER BY sample_date DESC
      LIMIT 1;
    `;
    const [latest] = await safeQuery(sql, [patientId]);
    return {
      patientId,
      latestLab: latest || null,
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
        dr.duration_hours,
        dr.blood_flow_ml_min,
        dr.dialysate_flow_ml_min,
        dr.pre_weight_kg,
        dr.post_weight_kg,
        dr.dry_weight_kg,
        dr.ultrafiltration_ml,
        dr.interdialytic_weight_gain_kg,
        dr.complications_summary,
        dr.is_circuit_clotted,
        dr.is_membrane_ruptured
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
        score,
        risk_level,
        diabetes_mellitus,
        immunosuppressed,
        recent_hospitalization,
        catheter_days_over_90,
        previous_crbsi,
        poor_hygiene
      FROM cvc_risk_assessments
      WHERE id = $1;
    `;
    const [row] = await safeQuery(sql, [assessmentId]);
    if (!row) {
      return { assessmentId, assessment: null };
    }

    const factors = [];
    if (row.diabetes_mellitus) factors.push('diabetes_mellitus');
    if (row.immunosuppressed) factors.push('immunosuppressed');
    if (row.recent_hospitalization) factors.push('recent_hospitalization');
    if (row.catheter_days_over_90) factors.push('catheter_days_over_90');
    if (row.previous_crbsi) factors.push('previous_crbsi');
    if (row.poor_hygiene) factors.push('poor_hygiene');

    return {
      assessmentId,
      assessment: {
        id: row.id,
        patient_id: row.patient_id,
        score: row.score,
        risk: row.risk_level,
        factors,
      },
    };
  }

  /**
   * 单患者透析趋势解读
   */
  async analyzePatientTrend(patientId, months) {
    const payload = await this.buildDialysisTrendPayload(patientId, months);
    const systemPrompt =
      '你是血液透析领域的临床质控助手，熟悉《血液净化标准化操作规程（2021版）》等指南。';
    const userPrompt =
      '请根据近几个月的透析记录数据，从 Kt/V、URR、血压、体重和超滤量等角度，总结透析充分性与容量管理趋势，并指出需要关注的问题。';
    return callQwen({
      systemPrompt,
      userPrompt,
      context: payload,
    });
  }

  /**
   * 检验结果综合分析
   */
  async analyzeLabs(patientId) {
    const payload = await this.buildLabPanelPayload(patientId);
    const systemPrompt =
      '你是一名熟悉血液透析患者检验指标的临床决策支持助手，了解 KDIGO 与国内相关指南的目标范围。';
    const userPrompt =
      '请对最近一次生化与血液学检验结果做综合分析，区分达标与异常指标，并给出需关注的方向（仅供医生和护士参考）。';
    return callQwen({
      systemPrompt,
      userPrompt,
      context: payload,
    });
  }

  /**
   * Kt/V 不达标原因辅助分析
   */
  async analyzeKtvRootCause(dialysisRecordId) {
    const payload = await this.buildKtvRootCausePayload(dialysisRecordId);
    const systemPrompt =
      '你是血液透析充分性评估助手，擅长根据透析参数分析 Kt/V 不达标的可能原因。';
    const userPrompt =
      '根据这次透析记录，分析若 Kt/V 或 URR 不达标，最可能的原因有哪些，并按优先级列出可供参考的优化方向（避免给出具体处方）。';
    return callQwen({
      systemPrompt,
      userPrompt,
      context: payload,
    });
  }

  /**
   * CVC 感染高危评分解读
   */
  async analyzeCvcRisk(assessmentId) {
    const payload = await this.buildCvcRiskPayload(assessmentId);
    const systemPrompt =
      '你是血液透析导管感染预防助手，熟悉 CRBSI 相关指南与风险评估方法。';
    const userPrompt =
      '请结合评分结果和各个风险因素，解释当前 CVC 感染风险等级，并给出护理观察要点和建议干预措施（不替代医生决策）。';
    return callQwen({
      systemPrompt,
      userPrompt,
      context: payload,
    });
  }

  /**
   * 自然语言查询：由后续 NlpQueryService 编排后调用
   */
  async answerNlpQuery(query, context) {
    const systemPrompt =
      '你是血液透析室的数据解读助手，会结合系统统计结果，用自然语言向医护人员解释情况。';
    const userPrompt =
      '以下是医护人员的自然语言查询，请结合提供的结构化统计结果，用简洁的中文回答，并避免编造未在数据中出现的信息。\n\n查询：' +
      query;
    return callQwen({
      systemPrompt,
      userPrompt,
      context,
    });
  }

  /**
   * 用药建议说明（仅医生/Admin 使用）
   */
  async analyzeMedicationPlan(patientId, summary) {
    const systemPrompt =
      '你是血液透析患者药物管理辅助助手，只能根据指南与共识给出“需关注点”和“可供参考的思路”，不得给出具体处方或剂量。';
    const userPrompt =
      '请根据当前用药与关键检验指标，说明与指南目标的差异，并给出需要评估和关注的方面，避免直接给出具体剂量调整方案。';
    const context = {
      patientId,
      summary,
    };
    return callQwen({
      systemPrompt,
      userPrompt,
      context,
    });
  }
}

module.exports = new AiAnalysisService();

