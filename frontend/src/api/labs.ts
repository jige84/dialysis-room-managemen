/**
 * 检验结果 API 与化验单类型
 * 主要作用：对接 /api/labs，供检验结果列表与患者化验历史展示、录入。
 * 主要功能：分页列表、按患者筛选；LabResult 等类型导出。
 */
import request, { type ApiResponse, type PagedData } from './request';

export interface LabResult {
  id: string;
  patient_id: string;
  test_type: string;
  value: number;
  unit: string;
  test_date: string;
  target_low?: number;
  target_high?: number;
  is_abnormal: boolean;
  is_critical: boolean;
  is_above_target?: boolean;
  critical_confirmed: boolean;
  entered_by_name?: string;
  notes?: string;
}

export interface LabQuery {
  test_type?: string;
  start_date?: string;
  end_date?: string;
  page?: number;
  page_size?: number;
}

/** 全科检验列表查询（GET /api/labs） */
export interface LabGlobalQuery {
  page?: number;
  page_size?: number;
  keyword?: string;
  test_type?: string;
  is_critical?: boolean;
  is_abnormal?: boolean;
  /** 仅正常（非异常且非危急） */
  result_normal?: boolean;
}

/** 列表行：含患者信息 */
export interface LabResultListRow extends LabResult {
  patient_name: string;
  patient_gender: string;
  /** 仅近一周列表/复查计划接口返回：下次复查日期（若医生已设置则以医生设置为准） */
  next_review_date?: string;
  /** 复查计划对应的预警记录 id（用于可选的前端定位/回显） */
  recheck_alert_id?: string;
}

export interface LabReviewDueSoonRow {
  patient_id: string;
  patient_name: string;
  test_type: string;
  test_date: string;
  due_date: string;
}

export interface LabMonthCompletion {
  completion_rate: number; // 0~1
  total_patients: number;
  completed_patients: number;
  uncompleted_patients: { patient_id: string; patient_name: string }[];
}

export const LAB_TYPE_LABELS: Record<string, string> = {
  hb:   '血红蛋白', hct:  '红细胞压积',
  k:    '血钾',     na:   '血钠',
  ca:   '血钙',     p:    '血磷',
  hco3: '碳酸氢根', alb:  '白蛋白',
  sf:   '血清铁蛋白',tsat: '转铁蛋白饱和度',
  ipth: '全段甲状旁腺激素', b2mg: 'β2微球蛋白',
  bun:  '血尿素氮', cr:   '血肌酐',
  hbsag:'乙肝表面抗原', hcv: '丙肝抗体',
  hiv:  'HIV抗体',  tp:   '梅毒',
};

const labsApi = {
  /** 全科检验分页列表 */
  listGlobal: (params: LabGlobalQuery = {}) =>
    request.get<ApiResponse<PagedData<LabResultListRow>>>('/labs', {
      params: {
        ...params,
        is_critical: params.is_critical === true ? 'true' : undefined,
        is_abnormal: params.is_abnormal === true ? 'true' : undefined,
        result_normal: params.result_normal === true ? 'true' : undefined,
      },
    }),

  /** 近一周最新一条/患者/项目 */
  listRecent: (params: { days?: number; page?: number; page_size?: number } = {}) =>
    request.get<ApiResponse<LabResultListRow[]>>('/labs/recent', { params }),

  /** 医生设置某化验项目的下次复查日期（写入 alerts） */
  setRecheckDue: (payload: { patient_id: string; test_type: string; due_date: string }) =>
    request.patch<ApiResponse<{ id: string; due_date?: string; priority?: string }>>('/labs/recheck', payload),

  list: (patientId: string, params: LabQuery) =>
    request.get<ApiResponse<PagedData<LabResult>>>(`/labs/${patientId}`, { params }),

  getLatest: (patientId: string) =>
    request.get<ApiResponse<LabResult[]>>(`/labs/${patientId}/latest`),

  getTrends: (patientId: string, types: string[]) =>
    request.get<ApiResponse<Record<string, LabResult[]>>>(`/labs/${patientId}/trends`, {
      params: { types: types.join(',') }
    }),

  getCriticalUnconfirmed: () =>
    request.get<ApiResponse<(LabResult & { patient_name: string })[]>>('/labs/critical/unconfirmed'),

  add: (patientId: string, items: Partial<LabResult>[]) =>
    request.post<ApiResponse<LabResult[]>>(`/labs/${patientId}`, items),

  confirmCritical: (id: string) =>
    request.patch<ApiResponse<LabResult>>(`/labs/${id}/critical-confirm`),

  /** 复查到期提醒（默认近 days 天内到期/即将到期） */
  getReviewDueSoon: (params: { days?: number } = {}) =>
    request.get<ApiResponse<LabReviewDueSoonRow[]>>('/labs/review-due-soon', {
      params: { days: params.days ?? 7 },
    }),

  /** 当月化验完成率：本月至少有一条检验记录即视为已完成 */
  getMonthCompletion: (params: { year: number; month: number }) =>
    request.get<ApiResponse<LabMonthCompletion>>('/labs/month-completion', {
      params: { year: params.year, month: params.month },
    }),
};

export default labsApi;
