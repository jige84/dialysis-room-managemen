/**
 * 血管通路 API 封装与类型定义
 * 对接 /api/vascular 全部端点，字段与后端 migrations 010/011/012/027-030 对齐。
 */
import request, { type ApiResponse } from './request';

// ---------------------------------------------------------------------------
// 实体类型
// ---------------------------------------------------------------------------

export type AccessType = 'avf' | 'avg' | 'ncc' | 'tcc';
export type UltrasoundResult = 'normal' | 'stenosis' | 'thrombosis' | 'aneurysm';
export type PunctureMethod = 'rope_ladder' | 'buttonhole' | 'area';

export interface VascularAccess {
  id: string;
  patient_id: string;
  access_type: AccessType;
  location: string;
  established_date: string;
  first_use_date?: string;
  puncture_method?: PunctureMethod;
  is_buttonhole: boolean;
  last_ultrasound_date?: string;
  ultrasound_result?: UltrasoundResult;
  ultrasound_notes?: string;
  is_active: boolean;
  deactivated_date?: string;
  deactivation_reason?: string;
  catheter_days_total?: number;
  last_risk_score?: number;
  last_risk_grade?: number;
  notes?: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
  // JOIN 字段（来自 LATERAL 子查询）
  latest_cvc_score?: number;
  cvc_risk_grade?: number;
  cvc_assessed_at?: string;
  cvc_score?: number;
  // CVC 风险因素最新值（current 接口附带）
  diabetes_mellitus?: boolean;
  immunosuppressed?: boolean;
  recent_hospitalization?: boolean;
  catheter_days_over90?: boolean;
  previous_crbsi?: boolean;
  poor_hygiene?: boolean;
}

export interface AvfAssessment {
  id: string;
  vascular_access_id: string;
  patient_id: string;
  assessed_at: string;
  blood_flow_rate?: number;
  pulsation?: string;
  thrill?: string;
  bruit?: string;
  inner_diameter_mm?: number;
  skin_depth_mm?: number;
  arm_raise_test?: string;
  pulsation_enhancement_test?: string;
  skin_condition?: string;
  overall_result: string;
  notes?: string;
  assessed_by: string;
  assessed_by_name?: string;
  created_at: string;
}

export interface CvcAssessment {
  id: string;
  vascular_access_id: string;
  patient_id: string;
  assessed_at: string;
  blood_flow_rate?: number;
  blood_return_status?: string;
  arterial_draw_volume_ml?: number;
  venous_draw_volume_ml?: number;
  lock_clot_status?: string;
  skin_condition?: string;
  fixation_status?: string;
  overall_result: string;
  intervention_notes?: string;
  assessed_by: string;
  assessed_by_name?: string;
  created_at: string;
}

export interface PunctureRecord {
  id: string;
  vascular_access_id: string;
  patient_id: string;
  puncture_date: string;
  nurse_id: string;
  nurse_name?: string;
  arterial_site?: string;
  venous_site?: string;
  attempts: number;
  puncture_result: string;
  hematoma_occurred: boolean;
  notes?: string;
  created_at: string;
}

/** 6 因素（与 GET /cvc-risk 返回的 factors 字段一致） */
export interface CvcRiskFactors {
  diabetes_mellitus: boolean;
  immunosuppressed: boolean;
  recent_hospitalization: boolean;
  catheter_days_over90: boolean;
  previous_crbsi: boolean;
  poor_hygiene: boolean;
}

export interface CVCRiskAssessment {
  id: string;
  vascular_access_id: string;
  patient_id: string;
  assessed_at: string;
  diabetes_mellitus: boolean;
  immunosuppressed: boolean;
  recent_hospitalization: boolean;
  catheter_days_over90: boolean;
  previous_crbsi: boolean;
  poor_hygiene: boolean;
  /** 后端组装的 6 因素对象（便于前端与 AI context 使用） */
  factors?: CvcRiskFactors;
  total_score: number;
  risk_grade: 1 | 2 | 3;
  risk_label?: string;
  score_summary?: { factor: string; label: string; score: number }[];
  assessed_by: string;
  assessed_by_name?: string;
  intervention_notes?: string;
  created_at: string;
}

export interface ThrombolysisRecord {
  id: string;
  vascular_access_id: string;
  patient_id: string;
  thrombolysis_date: string;
  drug_name: string;
  drug_dose?: string;
  method: string;
  dwell_hours?: number;
  evaluation: string;
  is_successful: boolean;
  notes?: string;
  performed_by: string;
  performed_by_name?: string;
  created_at: string;
}

export interface FactorDefinition {
  key: string;
  label: string;
  weight: number;
}

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

export const ACCESS_TYPE_LABELS: Record<AccessType, string> = {
  avf: '自体动静脉内瘘（AVF）',
  avg: '人工血管内瘘（AVG）',
  ncc: '无隧道导管（NCC 临时）',
  tcc: '隧道导管（TCC 长期）',
};

export const RISK_GRADE_LABELS: Record<number, string> = {
  1: '低风险',
  2: '中等风险',
  3: '高风险',
};

export const RISK_GRADE_COLORS: Record<number, string> = {
  1: 'green',
  2: 'orange',
  3: 'red',
};

// ---------------------------------------------------------------------------
// API 方法
// ---------------------------------------------------------------------------

const vascularApi = {
  /** 患者所有通路（含最新 CVC 评分） */
  list: (patientId: string) =>
    request.get<ApiResponse<VascularAccess[]>>(`/vascular/${patientId}/list`),

  /** 患者当前活动通路（含 CVC 风险因素最新值） */
  getCurrent: (patientId: string) =>
    request.get<ApiResponse<VascularAccess | null>>(`/vascular/${patientId}/current`),

  /** 新增血管通路 */
  create: (patientId: string, data: Partial<VascularAccess>) =>
    request.post<ApiResponse<VascularAccess>>(`/vascular/${patientId}`, data),

  /** 更新通路基本信息（超声随访等） */
  update: (id: string, data: Partial<Pick<VascularAccess, 'last_ultrasound_date' | 'ultrasound_result' | 'ultrasound_notes' | 'puncture_method' | 'notes'>>) =>
    request.put<ApiResponse<VascularAccess>>(`/vascular/access/${id}`, data),

  /** 废用通路 */
  abandon: (id: string, reason: string, date?: string) =>
    request.patch<ApiResponse<VascularAccess>>(`/vascular/access/${id}/abandon`, { reason, abandon_date: date }),

  // ---------- AVF/AVG 评估 ----------
  /** AVF/AVG 评估历史 */
  getAssessments: (accessId: string) =>
    request.get<ApiResponse<AvfAssessment[]>>(`/vascular/${accessId}/assessments`),

  /** 新增 AVF/AVG 评估 */
  addAssessment: (accessId: string, data: Partial<AvfAssessment>) =>
    request.post<ApiResponse<AvfAssessment>>(`/vascular/${accessId}/assessments`, data),

  // ---------- CVC 日常评估 ----------
  /** CVC 评估历史 */
  getCvcAssessments: (accessId: string) =>
    request.get<ApiResponse<CvcAssessment[]>>(`/vascular/${accessId}/cvc-assessments`),

  /** 新增 CVC 评估 */
  addCvcAssessment: (accessId: string, data: Partial<CvcAssessment>) =>
    request.post<ApiResponse<CvcAssessment>>(`/vascular/${accessId}/cvc-assessments`, data),

  // ---------- 穿刺记录 ----------
  /** 穿刺记录历史 */
  getPunctures: (accessId: string) =>
    request.get<ApiResponse<PunctureRecord[]>>(`/vascular/${accessId}/punctures`),

  /** 新增穿刺记录 */
  addPuncture: (accessId: string, data: Partial<PunctureRecord>) =>
    request.post<ApiResponse<PunctureRecord>>(`/vascular/${accessId}/punctures`, data),

  // ---------- CVC 风险评分（6 因素）----------
  /** CVC 风险评分历史 */
  getCVCRisk: (accessId: string) =>
    request.get<ApiResponse<CVCRiskAssessment[]>>(`/vascular/${accessId}/cvc-risk`),

  /** 新增 CVC 风险评分 */
  addCVCRisk: (accessId: string, data: Partial<CVCRiskAssessment> & { assessed_at: string }) =>
    request.post<ApiResponse<CVCRiskAssessment>>(`/vascular/${accessId}/cvc-risk`, data),

  /** CVC 风险因素定义列表（用于前端渲染勾选项） */
  getFactorDefinitions: () =>
    request.get<ApiResponse<FactorDefinition[]>>('/vascular/factor-definitions'),

  // ---------- 溶栓记录 ----------
  /** 溶栓历史 */
  getThrombolysis: (accessId: string) =>
    request.get<ApiResponse<ThrombolysisRecord[]>>(`/vascular/${accessId}/thrombolysis`),

  /** 新增溶栓记录 */
  addThrombolysis: (accessId: string, data: Partial<ThrombolysisRecord>) =>
    request.post<ApiResponse<ThrombolysisRecord>>(`/vascular/${accessId}/thrombolysis`, data),

  // ---------- 全科视图 ----------
  /** 全科当前 CVC 患者列表（护士长/admin/doctor） */
  getCVCAll: () =>
    request.get<ApiResponse<(VascularAccess & { patient_name: string })[]>>('/vascular/cvc-all'),
};

export default vascularApi;
