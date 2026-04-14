/**
 * 质控报表 API 封装
 * 对接 /api/reports 路由，qc_reports 表字段。
 */
import request, { type ApiResponse } from './request';

function extractFilename(contentDisposition: string | undefined, fallback: string): string {
  if (!contentDisposition) return fallback;
  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }
  const plainMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
  return plainMatch?.[1] || fallback;
}

function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}

async function downloadQcFile(path: string, fallbackFilename: string) {
  const response = await request.get<Blob>(path, { responseType: 'blob' });
  const blob = response.data instanceof Blob ? response.data : new Blob([response.data]);
  const filename = extractFilename(response.headers['content-disposition'], fallbackFilename);
  triggerBrowserDownload(blob, filename);
}

/** GET /reports/qc-trend 单行（与 qc_reports 汇总字段一致） */
export interface QcTrendRow {
  report_year: number;
  report_month: number;
  nurse_patient_ratio: string;
  circuit_clotting_rate: string;
  membrane_rupture_rate: string;
  puncture_injury_rate: string;
  crbsi_rate: string;
}

/** GET /reports/qc-routine/:year/:month — 科室内部质控（实时聚合） */
export interface QcRoutineMetricRow {
  key: string;
  label: string;
  definition: string;
  target: string;
  numerator: number;
  denominator: number;
  rate: number | null;
  rate_percent: number | null;
  compliant: boolean | null;
}

export interface QcRoutinePayload {
  report_year: number;
  report_month: number;
  period_start: string;
  period_end: string;
  metrics: QcRoutineMetricRow[];
}

/** GET /reports/monthly-workload/:year/:month — 需求 3.8.1 工作量 */
export interface MonthlyWorkloadPayload {
  report_year: number;
  report_month: number;
  period_start: string;
  period_end: string;
  total_dialysis_sessions: number;
  avf_sessions: number;
  total_duration_minutes: number;
  avg_duration_minutes: number;
  total_patient_sessions_for_ratio: number;
  total_nurse_sessions_for_ratio: number;
  nurse_patient_ratio: number;
  puncture_difficult_count: number;
  puncture_difficult_rate: number;
  circuit_clot_complete_count: number;
  circuit_clot_complete_rate: number;
  coagulation_grade_2_plus_count: number;
  membrane_rupture_count: number;
  membrane_rupture_rate: number;
}

export interface QCReport {
  id: string;
  report_year: number;
  report_month: number;
  total_patient_sessions: number;
  total_nurse_sessions: number;
  nurse_patient_ratio: string;
  /** 时点调查护患比（护士长手工维护，可选） */
  spot_check_ratio?: string | number | null;
  /** 某周日时点护患比（可选） */
  sunday_ratio?: string | number | null;
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
  notes?: string | null;
}

export interface QcReportPatchPayload {
  notes?: string | null;
  spot_check_ratio?: number | null;
  sunday_ratio?: number | null;
}

const reportsApi = {
  getQcRoutine: (year: number, month: number) =>
    request.get<ApiResponse<QcRoutinePayload>>(`/reports/qc-routine/${year}/${month}`),

  getMonthlyWorkload: (year: number, month: number) =>
    request.get<ApiResponse<MonthlyWorkloadPayload>>(`/reports/monthly-workload/${year}/${month}`),

  getQCUpload: (year: number, month: number) =>
    request.get<ApiResponse<QCReport | null>>(`/reports/qc-upload/${year}/${month}`),

  initQCUpload: (year: number, month: number) =>
    request.post<ApiResponse<QCReport>>(`/reports/qc-upload/${year}/${month}/init`),

  submit: (year: number, month: number) =>
    request.post<ApiResponse<QCReport>>(`/reports/qc-upload/${year}/${month}/submit`),

  confirm: (year: number, month: number) =>
    request.post<ApiResponse<QCReport>>(`/reports/qc-upload/${year}/${month}/confirm`),

  patchQCUpload: (year: number, month: number, payload: QcReportPatchPayload) =>
    request.patch<ApiResponse<QCReport>>(`/reports/qc-upload/${year}/${month}`, payload),

  exportExcel: (year: number, month: number) =>
    downloadQcFile(
      `/reports/qc-upload/${year}/${month}/export`,
      `quality_report_${year}_${String(month).padStart(2, '0')}.xlsx`,
    ),

  exportPdf: (year: number, month: number) =>
    downloadQcFile(
      `/reports/qc-upload/${year}/${month}/export-pdf`,
      `qc_report_${year}_${String(month).padStart(2, '0')}.pdf`,
    ),

  history: () =>
    request.get<ApiResponse<QCReport[]>>('/reports/qc-upload/history'),

  trend: (years = 2) =>
    request.get<ApiResponse<QcTrendRow[]>>('/reports/qc-trend', { params: { years } }),
};

export default reportsApi;
