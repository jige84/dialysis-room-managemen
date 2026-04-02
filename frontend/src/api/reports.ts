/**
 * 质控报表 API 封装
 * 对接 /api/reports 路由，qc_reports 表字段。
 */
import request, { type ApiResponse } from './request';

export interface QCReport {
  id: string;
  report_year: number;
  report_month: number;
  total_patient_sessions: number;
  total_nurse_sessions: number;
  nurse_patient_ratio: string;
  total_sessions: number;
  circuit_clotting_count: number;
  circuit_clotting_rate: string;
  membrane_rupture_count: number;
  membrane_rupture_rate: string;
  avf_sessions: number;
  puncture_injury_count: number;
  puncture_injury_rate: string;
  cvc_catheter_days: number;
  crbsi_count: number;
  crbsi_rate: string;
  status: 'draft' | 'submitted' | 'confirmed';
  submitted_by?: string;
  submitted_at?: string;
  confirmed_by?: string;
  confirmed_at?: string;
}

const reportsApi = {
  getQCUpload: (year: number, month: number) =>
    request.get<ApiResponse<QCReport>>(`/reports/qc-upload/${year}/${month}`),

  submit: (year: number, month: number) =>
    request.post<ApiResponse<QCReport>>(`/reports/qc-upload/${year}/${month}/submit`),

  confirm: (year: number, month: number) =>
    request.post<ApiResponse<QCReport>>(`/reports/qc-upload/${year}/${month}/confirm`),

  exportExcel: (year: number, month: number) =>
    `/api/reports/qc-upload/${year}/${month}/export`,

  history: () =>
    request.get<ApiResponse<QCReport[]>>('/reports/qc-upload/history'),

  trend: () =>
    request.get<ApiResponse<QCReport[]>>('/reports/qc-trend'),
};

export default reportsApi;
