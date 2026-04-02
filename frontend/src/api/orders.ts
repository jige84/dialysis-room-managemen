/**
 * 长期医嘱 API 封装与类型定义
 * 对接 /api/orders 全部端点，字段与 migrations 004 对齐。
 */
import request, { type ApiResponse } from './request';

export type OrderType = 'dialysis_drug' | 'interval_drug' | 'treatment' | 'diet' | 'care' | 'observation';
export type OrderFrequency = 'every_session' | 'qd' | 'bid' | 'tiw' | 'biw' | 'qw' | 'q2w' | 'qm' | 'custom';
export type OrderStatus = 'active' | 'stopped' | 'expired';

export interface LongTermOrder {
  id: string;
  patient_id: string;
  prescription_id?: string;
  order_type: OrderType;
  drug_name: string;
  drug_spec?: string;
  dose?: string;
  dose_unit?: string;
  route?: string;
  frequency: OrderFrequency;
  frequency_detail?: string;
  execute_timing?: 'pre_dialysis' | 'during_dialysis' | 'post_dialysis' | 'anytime';
  status: OrderStatus;
  ordered_by: string;
  ordered_by_name?: string;
  ordered_at: string;
  valid_from: string;
  valid_until?: string;
  stopped_by?: string;
  stopped_by_name?: string;
  stopped_at?: string;
  stop_reason?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface OrderExecution {
  id: string;
  long_term_order_id: string;
  patient_id: string;
  dialysis_record_id?: string;
  execution_date: string;
  executed_by: string;
  executed_by_name?: string;
  status: string;
  actual_dose?: string;
  notes?: string;
  drug_name?: string;
  dose?: string;
  route?: string;
  order_type?: string;
  created_at: string;
}

export const FREQ_LABELS: Record<string, string> = {
  every_session: '每透析日',
  qd: 'qd（每日1次）',
  bid: 'bid（每日2次）',
  tid: 'tid（每日3次）',
  tiw: 'tiw（每透析日）',
  biw: 'biw（每周2次）',
  qw: 'qw（每周1次）',
  q2w: 'q2w（每2周1次）',
  qm: 'qm（每月1次）',
  custom: '自定义',
};

export const ORDER_TYPE_LABELS: Record<string, string> = {
  dialysis_drug: '透析用药',
  interval_drug: '间期用药',
  treatment: '治疗',
  diet: '饮食',
  care: '护理',
  observation: '观察',
};

const ordersApi = {
  /** 患者当前有效医嘱 */
  getActive: (patientId: string) =>
    request.get<ApiResponse<LongTermOrder[]>>(`/orders/${patientId}/active`),

  /** 患者医嘱历史（含已停止） */
  getHistory: (patientId: string) =>
    request.get<ApiResponse<LongTermOrder[]>>(`/orders/${patientId}/history`),

  /** 今日应执行医嘱 */
  getTodayTasks: (patientId: string, date?: string) =>
    request.get<ApiResponse<LongTermOrder[]>>(`/orders/${patientId}/today-tasks`, { params: { date } }),

  /** 开具新医嘱 */
  create: (patientId: string, data: Partial<LongTermOrder>) =>
    request.post<ApiResponse<LongTermOrder>>(`/orders/${patientId}`, data),

  /** 修改医嘱（停旧开新） */
  update: (orderId: string, data: Partial<LongTermOrder>) =>
    request.put<ApiResponse<LongTermOrder>>(`/orders/${orderId}`, data),

  /** 停止医嘱 */
  stop: (orderId: string, stop_reason: string) =>
    request.patch<ApiResponse<LongTermOrder>>(`/orders/${orderId}/stop`, { stop_reason }),

  /** 护士执行医嘱确认 */
  execute: (data: { order_id: string; dialysis_id?: string; status?: string; actual_dose?: string; notes?: string; execution_date?: string }) =>
    request.post<ApiResponse<OrderExecution>>('/orders/execute', data),

  /** 执行记录查询 */
  getExecutions: (params: { dialysisId?: string; patientId?: string; page?: number; page_size?: number }) =>
    request.get<ApiResponse<OrderExecution[]>>('/orders/executions', { params }),
};

export default ordersApi;
