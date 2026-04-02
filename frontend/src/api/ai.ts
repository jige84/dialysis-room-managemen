import request, { type ApiResponse } from './request';

export interface AiTextResult {
  content: string;
  ai_disclaimer: string;
}

export const aiApi = {
  postTrendAnalysis(params: { patientId: string; months?: number }) {
    return request.post<ApiResponse<AiTextResult>>('/ai/patient-trend', params);
  },

  postLabsAnalysis(params: { patientId: string }) {
    return request.post<ApiResponse<AiTextResult>>('/ai/labs-analysis', params);
  },

  postKtvRootCause(params: { dialysisRecordId: string }) {
    return request.post<ApiResponse<AiTextResult>>('/ai/ktv-root-cause', params);
  },

  postCvcExplanation(params: { assessmentId: string }) {
    return request.post<ApiResponse<AiTextResult>>(
      '/ai/cvc-risk-explain',
      params,
    );
  },

  postNlpQuery(params: { query: string; context?: unknown }) {
    return request.post<ApiResponse<AiTextResult>>('/ai/nlp-query', params);
  },

  postMedicationAdvice(params: { patientId: string; summary?: unknown }) {
    return request.post<ApiResponse<AiTextResult>>(
      '/ai/medication-advice',
      params,
    );
  },
};

