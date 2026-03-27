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
