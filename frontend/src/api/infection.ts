/**
 * 传染病筛查 API 与最新筛查数据结构
 * 主要作用：对接感染筛查接口，供透析前校验与感染管理页展示。
 * 主要功能：按患者拉取最新筛查；TypeScript 类型与后端别名字段注释对齐。
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

export const infectionApi = {
  getLatestByPatient: (patientId: string) =>
    request.get<ApiResponse<InfectionScreeningLatestRow[]>>(
      `/infection/screenings/${patientId}/latest`,
    ),
};
