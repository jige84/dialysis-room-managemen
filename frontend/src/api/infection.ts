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
