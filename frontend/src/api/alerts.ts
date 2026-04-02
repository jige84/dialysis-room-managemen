/**
 * 预警中心 API 封装
 * 字段与 021_create_audit_alerts.sql 对齐，severity 使用 emergency/critical/warning/info。
 */
import request, { type ApiResponse } from './request';

export type AlertSeverity = 'emergency' | 'critical' | 'warning' | 'info';
export type AlertStatus = 'active' | 'dismissed' | 'handled' | 'auto_closed';

export interface AlertItem {
  id: string;
  patient_id?: string;
  patient_name?: string;
  alert_rule_id: string;
  alert_type: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  status: AlertStatus;
  handled_by?: string;
  handled_at?: string;
  handle_notes?: string;
  notified_roles?: string[];
  created_at: string;
}

export interface AlertSummary {
  total: number;
  emergency: number;
  critical: number;
  warning: number;
  info: number;
}

const alertsApi = {
  list: (params?: { type?: string; severity?: string; status?: string; page?: number; page_size?: number }) =>
    request.get<ApiResponse<{ data: AlertItem[]; total: number }>>('/alerts', { params }),

  summary: () =>
    request.get<ApiResponse<AlertSummary>>('/alerts/summary'),

  ack: (id: string, data: { handle_notes?: string; new_status?: 'handled' | 'dismissed' }) =>
    request.patch<ApiResponse<AlertItem>>(`/alerts/${id}/ack`, data),

  runChecks: () =>
    request.post<ApiResponse<{ generated: number }>>('/alerts/run-checks'),
};

export default alertsApi;
