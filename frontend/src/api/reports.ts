/**
 * 质控月报 API 与报表类型
 * 主要作用：对接 /api/reports，供质控报表页拉取、确认或导出月度数据。
 * 主要功能：列表与详情请求；必要时拼接 getApiBaseUrl 用于下载链接（依实现）。
 */
import request, { type ApiResponse } from './request';
import { getApiBaseUrl } from '../config/apiBaseUrl';

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
    const base = getApiBaseUrl().replace(/\/$/, '');
    window.open(`${base}/reports/qc-upload/${year}/${month}/export`);
  },

  getHistory: () =>
    request.get<ApiResponse<QCReport[]>>('/reports/qc-upload/history'),

  getTrend: () =>
    request.get<ApiResponse<QCReport[]>>('/reports/qc-trend'),
};

export default reportsApi;
