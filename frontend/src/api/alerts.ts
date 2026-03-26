import request, { type ApiResponse } from './request';

export interface Alert {
  id: string;
  patient_id?: string;
  patient_name?: string;
  alert_type: string;
  alert_subtype?: string;
  priority: 'low' | 'medium' | 'high';
  title: string;
  message: string;
  status: 'pending' | 'acknowledged' | 'resolved';
  due_date?: string;
  ack_by?: string;
  ack_at?: string;
  action_note?: string;
  created_at: string;
}

export interface AlertSummary {
  total: number;
  infection_screening_due?: number;
  low_ktv?: number;
  lab_review_due?: number;
  cvc_high_risk?: number;
  buttonhole_monitor?: number;
}

export const ALERT_TYPE_LABELS: Record<string, string> = {
  infection_screening_due: '感染筛查到期',
  low_ktv:                 'Kt/V未达标',
  lab_review_due:          '化验复查到期',
  cvc_high_risk:           'CVC高风险',
  buttonhole_monitor:      '扣眼监测提醒',
};

const alertsApi = {
  list: (params?: { type?: string; status?: string; page?: number; page_size?: number }) =>
    request.get<ApiResponse<{ data: Alert[]; total: number }>>('/alerts', { params }),

  getSummary: () =>
    request.get<ApiResponse<AlertSummary>>('/alerts/summary'),

  ack: (id: string, note?: string) =>
    request.patch<ApiResponse<Alert>>(`/alerts/${id}/ack`, { action_note: note }),

  runChecks: () =>
    request.post<ApiResponse<{ generated: number }>>('/alerts/run-checks'),
};

export default alertsApi;
