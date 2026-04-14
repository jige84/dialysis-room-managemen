/**
 * 感染筛查/监测 API 封装
 * 主要作用：对接 /api/infection，供感染页与患者详情页使用。
 * 主要功能：筛查列表、录入筛查、月度监测查询与保存。
 */
import request, { type ApiResponse } from './request';

/** 与 GET /api/infection/screenings/:patientId/latest 一致（含别名字段） */
export interface InfectionScreeningLatestRow {
  id: string;
  screen_type: string;
  screen_date: string;
  result: string;
  notes?: string | null;
  next_due_date?: string | null;
}

/** 与 POST /api/infection/screenings/latest/batch 一致 */
export interface InfectionScreeningLatestBatchRow extends InfectionScreeningLatestRow {
  patient_id: string;
}

/** 与 GET /api/infection/screenings/:patientId 一致 */
export interface InfectionScreeningHistoryRow {
  id: string;
  patient_id: string;
  test_type: string;
  result: string;
  test_date: string;
  notes?: string | null;
  entered_by?: string | null;
  entered_by_name?: string | null;
}

/** 与 GET /api/infection/screenings/overdue 一致 */
export interface InfectionOverdueRow {
  patient_id: string;
  name: string;
  screen_type: string | null;
  screen_date: string | null;
  result: string | null;
  days_since: number | string | null;
}

export interface InfectionScreeningInput {
  test_type: string;
  result: string;
  test_date?: string;
  notes?: string;
}

/** 与 GET /api/infection/monitoring/:year/:month 一致 */
export interface InfectionMonitoringRow {
  id: string;
  patient_id: string;
  patient_name: string;
  monitor_year: number;
  monitor_month: number;
  catheter_days: number;
  infection_status: string;
  notes?: string | null;
  vascular_access_id?: string | null;
  location?: string | null;
  access_type?: string | null;
}

export interface InfectionMonitoringPayload {
  patient_id: string;
  monitor_year: number;
  monitor_month: number;
  catheter_days: number;
  infection_status?: string;
  notes?: string;
  vascular_access_id?: string;
}

export const infectionApi = {
  getLatestByPatient: (patientId: string) =>
    request.get<ApiResponse<InfectionScreeningLatestRow[]>>(
      `/infection/screenings/${patientId}/latest`,
    ),

  getLatestBatch: (patientIds: string[]) =>
    request.post<ApiResponse<InfectionScreeningLatestBatchRow[]>>(
      '/infection/screenings/latest/batch',
      { patient_ids: patientIds },
    ),

  listByPatient: (patientId: string) =>
    request.get<ApiResponse<InfectionScreeningHistoryRow[]>>(
      `/infection/screenings/${patientId}`,
    ),

  listOverdue: () =>
    request.get<ApiResponse<InfectionOverdueRow[]>>('/infection/screenings/overdue'),

  createScreenings: (patientId: string, payload: InfectionScreeningInput[] | InfectionScreeningInput) =>
    request.post<ApiResponse<InfectionScreeningHistoryRow[]>>(
      `/infection/screenings/${patientId}`,
      payload,
    ),

  getMonitoringByMonth: (year: number, month: number) =>
    request.get<ApiResponse<InfectionMonitoringRow[]>>(`/infection/monitoring/${year}/${month}`),

  saveMonitoring: (payload: InfectionMonitoringPayload) =>
    request.post<ApiResponse<InfectionMonitoringRow>>('/infection/monitoring', payload),
};
