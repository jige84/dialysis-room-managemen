import request, { type ApiResponse } from './request';

/** AI 接口会串联查库、知识库与通义（后端默认可等通义至多 60s），前端须大于「前置耗时 + 通义」 */
const AI_REQUEST_TIMEOUT_MS = 90000;

const aiRequestConfig = { timeout: AI_REQUEST_TIMEOUT_MS } as const;

/** 服务端返回的入库内容概览（无患者隐私字段） */
export interface AiKbSaveOverview {
  chunk_count: number;
  kb_query?: string;
  scenario?: string;
  subcategory?: string;
  /** 首条片段正文开头，便于确认保存内容 */
  text_preview?: string;
}

/** 本地知识库入库结果（仅当请求携带 saveToKnowledgeBase: true 时有意义） */
export interface AiKbSaveResult {
  skipped: boolean;
  saved?: boolean;
  duplicate?: boolean;
  document_id?: string;
  error?: string;
  /** 本次未命中本地资料片段，未写入（入库保存检索资料的整理总结，不保存 AI 回答） */
  reason?: 'no_kb_chunks';
  overview?: AiKbSaveOverview;
}

/** 后端返回的检索摘要 */
export interface AiRetrievalSummary {
  kb_chunk_count: number;
  kb_query?: string;
  medical_site_keys: string[];
  medical_site_names: string[];
  used_web_fallback: boolean;
}

export interface AiTextResult {
  content: string;
  ai_disclaimer: string;
  kb_save?: AiKbSaveResult;
  retrieval?: AiRetrievalSummary;
  model?: string;
  generated_at?: string;
}

/** 月度质控月报解读（科室聚合，无患者标识） */
export interface QcMonthlyInsightResult extends AiTextResult {
  evidence?: {
    source: string;
    targetMonth: Record<string, unknown>;
    history: Record<string, unknown>[];
    numericsNote: string;
  };
}

export interface AnomalyAnalysisResult extends AiTextResult {
  retrieval?: AiRetrievalSummary;
  evidence?: {
    tables?: string[];
    patientId?: string;
    anomalyType?: string;
    months?: number;
    recordCounts?: { lab_results?: number; dialysis_records?: number };
    focusLabId?: string | null;
    focusDialysisId?: string | null;
    focusAlertId?: string | null;
  };
  kb_chunks_used?: string[];
  used_web_fallback?: boolean;
}

export const aiApi = {
  postTrendAnalysis(params: {
    patientId: string;
    months?: number;
    saveToKnowledgeBase?: boolean;
  }) {
    return request.post<ApiResponse<AiTextResult>>(
      '/ai/patient-trend',
      params,
      aiRequestConfig,
    );
  },

  postLabsAnalysis(params: { patientId: string; saveToKnowledgeBase?: boolean }) {
    return request.post<ApiResponse<AiTextResult>>(
      '/ai/labs-analysis',
      params,
      aiRequestConfig,
    );
  },

  /** 基于 qc_reports 已存数值的科室月度质控辅助解读 */
  postQcMonthlyInsight(params: {
    year: number;
    month: number;
    historyMonths?: number;
    userQuestion?: string;
    saveToKnowledgeBase?: boolean;
  }) {
    return request.post<ApiResponse<QcMonthlyInsightResult>>(
      '/ai/qc-monthly-insight',
      params,
      aiRequestConfig,
    );
  },

  postKtvRootCause(params: {
    dialysisRecordId: string;
    saveToKnowledgeBase?: boolean;
  }) {
    return request.post<ApiResponse<AiTextResult>>(
      '/ai/ktv-root-cause',
      params,
      aiRequestConfig,
    );
  },

  postCvcExplanation(params: {
    assessmentId: string;
    saveToKnowledgeBase?: boolean;
  }) {
    return request.post<ApiResponse<AiTextResult>>(
      '/ai/cvc-risk-explain',
      params,
      aiRequestConfig,
    );
  },

  postNlpQuery(params: { query: string; context?: unknown; saveToKnowledgeBase?: boolean }) {
    return request.post<ApiResponse<AiTextResult>>(
      '/ai/nlp-query',
      params,
      aiRequestConfig,
    );
  },

  postMedicationAdvice(params: {
    patientId: string;
    summary?: unknown;
    saveToKnowledgeBase?: boolean;
  }) {
    return request.post<ApiResponse<AiTextResult>>(
      '/ai/medication-advice',
      params,
      aiRequestConfig,
    );
  },

  postAnomalyAnalysis(params: {
    patientId: string;
    anomalyType: string;
    contextId?: string;
    saveToKnowledgeBase?: boolean;
  }) {
    return request.post<ApiResponse<AnomalyAnalysisResult>>(
      '/ai/anomaly-analysis',
      params,
      aiRequestConfig,
    );
  },

  /** 将本次检索到的资料片段写入本地知识库（服务端按 anomalyType 重新检索，不提交正文） */
  postAnomalyAnalysisSaveKb(params: { patientId: string; anomalyType: string }) {
    return request.post<ApiResponse<{ kb_save: AiKbSaveResult }>>(
      '/ai/anomaly-analysis/save-kb',
      params,
      aiRequestConfig,
    );
  },
};
