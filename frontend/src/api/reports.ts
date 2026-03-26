import request, { type ApiResponse } from './request';

export interface QCReport {
  id: string;
  report_year: number;
  report_month: number;
  status: 'draft' | 'submitted' | 'confirmed';
  total_patient_sessions: number;
  total_nurse_sessions: number;
  nurse_patient_ratio: number;
  spot_check_ratio?: number;
  total_sessions: number;
  circuit_clotting_count: number;
  circuit_clotting_rate: number;
  membrane_rupture_count: number;
  membrane_rupture_rate: number;
  avf_sessions: number;
  puncture_injury_count: number;
  puncture_injury_rate: number;
  cvc_catheter_days: number;
  crbsi_count: number;
  crbsi_rate: number;
  submitted_by?: string;
  submitted_at?: string;
  confirmed_by?: string;
  confirmed_at?: string;
}

const reportsApi = {
  getQCUpload: (year: number, month: number) =>
    request.get<ApiResponse<QCReport>>(`/reports/qc-upload/${year}/${month}`),

  submitQCUpload: (year: number, month: number) =>
    request.post<ApiResponse<QCReport>>(`/reports/qc-upload/${year}/${month}/submit`),

  confirmQCUpload: (year: number, month: number) =>
    request.post<ApiResponse<QCReport>>(`/reports/qc-upload/${year}/${month}/confirm`),

  exportQCUpload: (year: number, month: number) => {
    window.open(`${import.meta.env.VITE_API_BASE_URL}/reports/qc-upload/${year}/${month}/export`);
  },

  getHistory: () =>
    request.get<ApiResponse<QCReport[]>>('/reports/qc-upload/history'),

  getTrend: () =>
    request.get<ApiResponse<QCReport[]>>('/reports/qc-trend'),
};

export default reportsApi;
