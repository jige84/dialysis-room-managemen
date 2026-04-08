/**
 * 透析处方 API
 */
import request, { type ApiResponse } from './request';

export interface PrescriptionRecord {
  id: string;
  patient_id: string;
  frequency_per_week: number;
  duration_hours: number;
  dialyzer_model?: string;
  dialyzer_area?: number;
  dialyzer_flux?: string;
  anticoagulant: string;
  heparin_prime_dose?: number;
  heparin_maintain?: number;
  dry_weight: number;
  dry_weight_date: string;
  dry_weight_reason?: string;
  dialysate_na?: number;
  dialysate_ca?: number;
  dialysate_k?: number;
  dialysate_temp?: number;
  blood_flow_rate?: number;
  dialysate_flow_rate?: number;
  /** 维持性血透治疗方式（与档案腹透/血透无关）：HD / HDF / HD_HP */
  hemodialysis_modality?: string;
  /** 与排班备注同步 */
  hemodialysis_remark?: string | null;
  /** HDF：前置换 pre / 后置换 post / 前后置换 both */
  hdf_replacement_mode?: string | null;
  /** HDF：置换液量（L） */
  hdf_replacement_volume_l?: number | null;
  notes?: string;
  /** 透前评估、钠曲线、班次机位等扩展字段（与 PrescriptionWorkspace 同源） */
  form_extra?: Record<string, unknown> | null;
}

export interface MedicationCheckIssue {
  rule_id: string;
  rule_type: string;
  severity: 'block' | 'warn';
  message: string;
  citation_code?: string;
  citation_excerpt?: string;
  pair?: string[];
}

export interface MedicationCheckResult {
  issues: MedicationCheckIssue[];
  has_block: boolean;
}

const prescriptionsApi = {
  getCurrent: (patientId: string) =>
    request.get<ApiResponse<PrescriptionRecord | null>>(`/prescriptions/${patientId}/current`),

  getHistory: (patientId: string) =>
    request.get<ApiResponse<PrescriptionRecord[]>>(`/prescriptions/${patientId}/history`),

  create: (patientId: string, data: Partial<PrescriptionRecord> & { form_extra?: Record<string, unknown> | null }) =>
    request.post<ApiResponse<PrescriptionRecord>>(`/prescriptions/${patientId}`, data),

  checkMedication: (payload: { patientId: string; anticoagulantKey: string }) =>
    request.post<ApiResponse<MedicationCheckResult>>('/prescriptions/check', payload),
};

export default prescriptionsApi;
