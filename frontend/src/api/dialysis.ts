/**
 * 透析记录 API — 类型定义与请求封装
 * 主要作用：对接 /api/dialysis 系列接口，供透析录入、历史查询、统计展示使用。
 * 主要功能：列表/详情/创建/备注；准备数据（处方+医嘱）；每日/月度统计；Kt/V趋势。
 */
import request, { type ApiResponse, type PagedData } from './request';

// ─── 基础枚举 ──────────────────────────────────────────────────────────────

export type DialysisShift = 'morning' | 'afternoon' | 'evening';
export type CoagulationGrade = 0 | 1 | 2 | 3;
export type PunctureResult = 'one_shot' | 'two_shot' | 'difficult';
export type PunctureMethod = 'rope_ladder' | 'buttonhole' | 'area';
export type BloodReturnMethod = 'closed' | 'other';

// ─── 子记录类型 ────────────────────────────────────────────────────────────

/** 生命体征单条记录（POST body 或 GET 响应） */
export interface VitalSign {
  id?: string;
  sequence_no?: number;
  time_label?: string;
  record_time?: string;
  systolic_bp?: number | null;
  diastolic_bp?: number | null;
  heart_rate?: number | null;
  arterial_pressure?: number | null;
  venous_pressure?: number | null;
  tmp?: number | null;
  body_temp?: number | null;
  is_hypotension?: boolean;
  is_hypertension?: boolean;
  notes?: string | null;
}

/** 并发症记录（POST body 或 GET 响应） */
export interface Complication {
  id?: string;
  comp_type: string;
  occurred_at?: string;
  notes?: string | null;
  detail?: Record<string, unknown> | null;
  is_emergency?: boolean;
}

/** 长期医嘱执行记录（POST body 或 GET 响应） */
export interface OrderExecution {
  id?: string;
  long_term_order_id: string;
  status: 'executed' | 'skipped' | 'modified';
  actual_dose?: number | null;
  notes?: string | null;
  drug_name?: string;
  dose?: number | null;
  route?: string | null;
  order_type?: string;
  executed_by_name?: string;
}

// ─── 透析记录列表行（轻量） ────────────────────────────────────────────────

export interface DialysisRecordListRow {
  id: string;
  session_date: string;
  shift: DialysisShift;
  pre_weight: number | null;
  post_weight: number | null;
  uf_volume: number | null;
  uf_pct_of_dry_weight: number | null;
  actual_duration: number | null;
  ktv: number | null;
  urr: number | null;
  coagulation_grade: CoagulationGrade | null;
  is_circuit_clotted: boolean;
  is_membrane_ruptured: boolean;
  is_avf_session: boolean;
  puncture_result: PunctureResult | null;
  puncture_method: PunctureMethod | null;
  patient_name?: string;
  nurse_name?: string;
}

// ─── 透析记录详情（完整） ─────────────────────────────────────────────────

export interface DialysisRecordDetail extends DialysisRecordListRow {
  patient_id: string;
  prescription_id: string | null;
  machine_id: string | null;
  nurse_id: string;
  double_check_nurse_id: string | null;
  start_time: string | null;
  end_time: string | null;
  blood_flow_rate: number | null;
  dialysate_flow_rate: number | null;
  dialysate_temp: number | null;
  dialysate_ca: number | null;
  dialysate_k: number | null;
  dialysate_na: number | null;
  heparin_prime_dose: number | null;
  heparin_maintain: number | null;
  puncture_site: string | null;
  blood_return_method: BloodReturnMethod;
  pre_bun: number | null;
  post_bun: number | null;
  notes: string | null;
  machine_no: string | null;
  double_check_nurse_name: string | null;
  dob?: string;
  /** 生命体征记录（规程要求每50分钟一次） */
  vital_signs: VitalSign[];
  /** 并发症记录 */
  complications: Complication[];
  /** 长期医嘱执行记录 */
  order_executions: OrderExecution[];
}

// ─── POST /api/dialysis 请求体 ────────────────────────────────────────────

export interface CreateDialysisPayload {
  patient_id: string;
  session_date: string;
  shift: DialysisShift;

  prescription_id?: string | null;
  machine_id?: string | null;
  double_check_nurse_id?: string | null;

  pre_weight?: number | null;
  post_weight?: number | null;
  dry_weight?: number | null;

  actual_duration?: number | null;
  start_time?: string | null;
  end_time?: string | null;

  blood_flow_rate?: number | null;
  dialysate_flow_rate?: number | null;
  dialysate_temp?: number | null;
  dialysate_ca?: number | null;
  dialysate_k?: number | null;
  dialysate_na?: number | null;

  heparin_prime_dose?: number | null;
  heparin_maintain?: number | null;

  puncture_result?: PunctureResult | null;
  puncture_site?: string | null;
  puncture_method?: PunctureMethod | null;
  is_avf_session?: boolean;

  coagulation_grade?: CoagulationGrade;
  is_membrane_ruptured?: boolean;

  blood_return_method?: BloodReturnMethod;

  pre_bun?: number | null;
  post_bun?: number | null;
  notes?: string | null;

  /** 生命体征数组（上机即刻 + 中途 + 下机前） */
  vital_signs?: Omit<VitalSign, 'id'>[];
  /** 并发症数组 */
  complications?: Omit<Complication, 'id' | 'is_emergency'>[];
  /** 长期医嘱执行记录数组 */
  order_executions?: Pick<OrderExecution, 'long_term_order_id' | 'status' | 'actual_dose' | 'notes'>[];
}

// ─── 准备数据（处方 + 今日医嘱） ────────────────────────────────────────

/** GET /api/dialysis/prepare 返回的处方摘要 */
export interface PreparedPrescription {
  id: string;
  patient_id: string;
  frequency_per_week: number | null;
  duration_hours: number | null;
  dialyzer_model: string | null;
  dry_weight: number | null;
  dry_weight_date: string | null;
  anticoagulant: string | null;
  heparin_prime_dose: number | null;
  heparin_maintain: number | null;
  dialysate_na: number | null;
  dialysate_ca: number | null;
  dialysate_k: number | null;
  dialysate_temp: number | null;
  blood_flow_rate: number | null;
  dialysate_flow_rate: number | null;
}

/** 今日应执行的长期医嘱（含是否已执行标记） */
export interface OrderForSession {
  id: string;
  order_type: string;
  drug_name: string | null;
  dose: number | null;
  dose_unit: string | null;
  route: string | null;
  frequency: string;
  execute_timing: string;
  notes: string | null;
  ordered_by_name: string | null;
  alreadyExecuted: boolean;
  executionId: string | null;
}

export interface PrepareDialysisData {
  prescription: PreparedPrescription | null;
  ordersToday: OrderForSession[];
}

// ─── 统计类型 ────────────────────────────────────────────────────────────

export interface DailyDialysisStats {
  total_sessions: string;
  avf_sessions: string;
  morning_sessions: string;
  afternoon_sessions: string;
  evening_sessions: string;
  nurse_count: string;
  avg_ktv: string | null;
  clotted_count: string;
  membrane_ruptured_count: string;
}

export interface MonthlyDialysisStats {
  total_sessions: string;
  avf_sessions: string;
  nurse_count: string;
  circuit_clotted_count: string;
  membrane_rupture_count: string;
  high_grade_clot_count: string;
  avg_ktv: string | null;
  ktv_qualified_count: string;
  ktv_measured_count: string;
  puncture_difficult_count: string;
  avf_puncture_injury_count: number;
  complications_by_type: { comp_type: string; count: string }[];
}

/** Kt/V 趋势单点 */
export interface KtvTrendPoint {
  session_date: string;
  ktv: number | null;
  urr: number | null;
  uf_volume: number | null;
  uf_pct_of_dry_weight: number | null;
  actual_duration: number | null;
}

// ─── 查询参数 ─────────────────────────────────────────────────────────────

export interface DialysisListQuery {
  patient_id?: string;
  start_date?: string;
  end_date?: string;
  shift?: DialysisShift;
  page?: number;
  page_size?: number;
}

// ─── API 方法 ────────────────────────────────────────────────────────────

export const dialysisApi = {
  /** 分页列表（支持按患者/日期/班次筛选） */
  list: (params: DialysisListQuery = {}) =>
    request.get<ApiResponse<PagedData<DialysisRecordListRow>>>('/dialysis', { params }),

  /** 单条详情（含生命体征、并发症、医嘱执行） */
  detail: (id: string) =>
    request.get<ApiResponse<DialysisRecordDetail>>(`/dialysis/${id}`),

  /** 创建透析记录（含批量生命体征、并发症、医嘱执行） */
  create: (data: CreateDialysisPayload) =>
    request.post<ApiResponse<Pick<DialysisRecordDetail, 'id' | 'session_date' | 'shift' | 'ktv' | 'urr' | 'uf_volume'>>>('/dialysis', data),

  /** 追加备注（护士限当班日期） */
  appendNote: (id: string, note: string) =>
    request.patch<ApiResponse<{ id: string; notes: string; session_date: string }>>(`/dialysis/${id}/note`, { note }),

  /** 追加单条生命体征（透析中实时录入） */
  addVitalSign: (dialysisRecordId: string, data: Omit<VitalSign, 'id'>) =>
    request.post<ApiResponse<VitalSign>>(`/dialysis/${dialysisRecordId}/vitals`, data),

  /**
   * 获取透析准备数据（当前处方 + 今日应执行医嘱）
   * 打开录入页时调用，避免多次请求
   */
  prepare: (patientId: string, date: string) =>
    request.get<ApiResponse<PrepareDialysisData>>('/dialysis/prepare', {
      params: { patientId, date },
    }),

  /** 每日统计（用于仪表盘和日报） */
  statsDaily: (date?: string) =>
    request.get<ApiResponse<DailyDialysisStats>>('/dialysis/stats/daily', {
      params: date ? { date } : undefined,
    }),

  /** 月度统计（质控5项指标分子/分母来源） */
  statsMonthly: (year: number, month: number) =>
    request.get<ApiResponse<MonthlyDialysisStats>>('/dialysis/stats/monthly', {
      params: { year, month },
    }),

  /** 患者 Kt/V 趋势（最近30次） */
  ktvTrend: (patientId: string) =>
    request.get<ApiResponse<KtvTrendPoint[]>>(`/dialysis/stats/ktv-trend/${patientId}`),
};

export default dialysisApi;
