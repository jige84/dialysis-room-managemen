import request, { type ApiResponse } from './request';

export interface VascularAccess {
  id: string;
  patient_id: string;
  access_type: 'avf' | 'avg' | 'ncc' | 'tcc';
  location: string;
  side?: string;
  established_date: string;
  is_current: boolean;
  is_buttonhole: boolean;
  surgeon?: string;
  notes?: string;
  abandon_date?: string;
  abandon_reason?: string;
  // CVC专用
  cvc_brand?: string;
  cvc_spec?: string;
  insertion_date?: string;
  cvc_score?: number;
  cvc_risk_grade?: string;
  cvc_assessed_at?: string;
  // 超声随访
  avf_blood_flow?: number;
  avf_diameter?: number;
  avf_ultrasound_date?: string;
}

export interface CVCRiskAssessment {
  id: string;
  access_id: string;
  factors: Record<string, boolean>;
  total_score: number;
  risk_grade: string;
  assessed_at: string;
  assessed_by_name?: string;
}

export interface ThrombolysisRecord {
  id: string;
  access_id: string;
  thrombolysis_date: string;
  drug: string;
  dose: string;
  route?: string;
  operator?: string;
  outcome?: string;
  notes?: string;
}

export const ACCESS_TYPE_LABELS: Record<string, string> = {
  avf: '自体动静脉内瘘',
  avg: '人工血管内瘘',
  ncc: '无隧道导管（临时）',
  tcc: '隧道导管（长期）',
};

const vascularApi = {
  list: (patientId: string) =>
    request.get<ApiResponse<VascularAccess[]>>(`/vascular/${patientId}`),

  getCurrent: (patientId: string) =>
    request.get<ApiResponse<VascularAccess[]>>(`/vascular/${patientId}/current`),

  create: (patientId: string, data: Partial<VascularAccess>) =>
    request.post<ApiResponse<VascularAccess>>(`/vascular/${patientId}`, data),

  update: (id: string, data: Partial<VascularAccess>) =>
    request.put<ApiResponse<VascularAccess>>(`/vascular/${id}`, data),

  abandon: (id: string, reason: string, date?: string) =>
    request.patch<ApiResponse<VascularAccess>>(`/vascular/${id}/abandon`, { reason, abandon_date: date }),

  getCVCRisk: (accessId: string) =>
    request.get<ApiResponse<CVCRiskAssessment[]>>(`/vascular/${accessId}/cvc-risk`),

  addCVCRisk: (accessId: string, factors: Record<string, boolean>) =>
    request.post<ApiResponse<CVCRiskAssessment>>(`/vascular/${accessId}/cvc-risk`, { factors }),

  getThrombolysis: (accessId: string) =>
    request.get<ApiResponse<ThrombolysisRecord[]>>(`/vascular/${accessId}/thrombolysis`),

  addThrombolysis: (accessId: string, data: Partial<ThrombolysisRecord>) =>
    request.post<ApiResponse<ThrombolysisRecord>>(`/vascular/${accessId}/thrombolysis`, data),

  getCVCAll: () =>
    request.get<ApiResponse<(VascularAccess & { patient_name: string })[]>>('/vascular/cvc-all'),
};

export default vascularApi;
