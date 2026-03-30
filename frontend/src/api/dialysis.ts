/**
 * 透析记录 API 与列表行类型
 * 主要作用：对接透析场次 CRUD 接口，供透析录入与历史查询使用。
 * 主要功能：列表/详情/保存；导出 DialysisRecordListRow 等与后端字段对齐的类型。
 */
import request, { type ApiResponse, type PagedData } from './request';

export interface DialysisRecordListRow {
  id: string;
  session_date: string;
  shift: string;
  pre_weight: number | null;
  post_weight: number | null;
  uf_volume: number | null;
  actual_duration: number | null;
  ktv: number | null;
  urr: number | null;
  coagulation_grade: number | null;
  is_circuit_clotted: boolean;
  is_membrane_ruptured: boolean;
}

export const dialysisApi = {
  list: (params: { patient_id: string; page_size?: number; page?: number }) =>
    request.get<ApiResponse<PagedData<DialysisRecordListRow>>>('/dialysis', { params }),
};
