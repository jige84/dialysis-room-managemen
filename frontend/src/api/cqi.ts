/**
 * CQI 持续质量改进与缺陷上报 API
 */
import request, { type ApiResponse } from './request';

export type CqiStatus = 'planning' | 'ongoing' | 'completed' | 'overdue';

export interface CqiUserOption {
  id: string;
  real_name: string;
  role: string;
}

export interface CqiRecord {
  id: string;
  project_type: string;
  title: string;
  start_date: string;
  review_date?: string | null;
  problem_found: string;
  root_cause?: string | null;
  target_description?: string | null;
  target_value?: string | number | null;
  target_unit?: string | null;
  measures: string;
  implementation_date?: string | null;
  effect_description?: string | null;
  actual_value?: string | number | null;
  is_goal_achieved?: boolean | null;
  leader_id?: string | null;
  leader_name?: string | null;
  participants?: string[] | null;
  /** 详情接口附带，便于只读角色展示姓名 */
  participant_users?: { id: string; real_name: string }[];
  director_sign_id?: string | null;
  director_sign_name?: string | null;
  director_sign_date?: string | null;
  notes?: string | null;
  status: CqiStatus;
  created_by?: string | null;
  created_by_name?: string | null;
  implementation_notes?: string | null;
  outcome?: string | null;
  actual_end_date?: string | null;
  summary?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface CqiListParams {
  page?: number;
  page_size?: number;
  status?: CqiStatus;
}

export interface CqiListResult {
  data: CqiRecord[];
  total: number;
}

export type DefectEventType =
  | 'operation_error'
  | 'equipment_failure'
  | 'infection_event'
  | 'medication_error'
  | 'other';

export interface DefectReport {
  id: string;
  event_type: DefectEventType;
  event_time: string;
  severity: 'minor' | 'moderate' | 'serious';
  involved_patient_ids?: string[] | null;
  description: string;
  immediate_action?: string | null;
  followup?: string | null;
  is_anonymous: boolean;
  reported_by?: string | null;
  reported_by_name?: string | null;
  created_at?: string;
}

export interface CreateCqiPayload {
  project_type: string;
  title: string;
  problem_found: string;
  measures: string;
  start_date?: string;
  target_description?: string;
  target_value?: number;
  target_unit?: string;
  notes?: string;
  status?: CqiStatus;
  leader_id?: string | null;
  root_cause?: string;
  participants?: string[];
  review_date?: string;
}

export interface UpdateCqiPayload {
  status?: CqiStatus;
  measures?: string;
  implementation_notes?: string;
  outcome?: string;
  actual_end_date?: string;
  summary?: string;
  problem_found?: string;
  target_description?: string;
  target_value?: number | null;
  target_unit?: string;
  notes?: string;
  leader_id?: string | null;
  root_cause?: string;
  participants?: string[];
  review_date?: string | null;
  implementation_date?: string | null;
  effect_description?: string | null;
  actual_value?: number | null;
  is_goal_achieved?: boolean | null;
  director_sign_id?: string | null;
  director_sign_date?: string | null;
}

export interface CreateDefectPayload {
  event_time: string;
  event_type: DefectEventType;
  severity?: 'minor' | 'moderate' | 'serious';
  description?: string;
  involved_patient_ids?: string[] | null;
  immediate_action?: string;
  anonymous?: boolean;
}

export const cqiApi = {
  list: (params?: CqiListParams) =>
    request.get<ApiResponse<CqiListResult>>('/cqi', { params }),

  get: (id: string) => request.get<ApiResponse<CqiRecord>>(`/cqi/${id}`),

  userOptions: () => request.get<ApiResponse<CqiUserOption[]>>('/cqi/user-options'),

  create: (payload: CreateCqiPayload) =>
    request.post<ApiResponse<CqiRecord>>('/cqi', payload),

  update: (id: string, payload: UpdateCqiPayload) =>
    request.put<ApiResponse<CqiRecord>>(`/cqi/${id}`, payload),

  listDefects: () => request.get<ApiResponse<DefectReport[]>>('/cqi/defects/list'),

  createDefect: (payload: CreateDefectPayload) =>
    request.post<ApiResponse<{ id: string; event_type: string; event_time: string }>>(
      '/cqi/defects',
      payload,
    ),
};
