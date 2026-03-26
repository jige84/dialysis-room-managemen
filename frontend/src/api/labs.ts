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
};

export default labsApi;
