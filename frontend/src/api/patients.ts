import request, { type ApiResponse, type PagedData } from './request';

export interface Patient {
  id: string;
  name: string;
  gender: 'M' | 'F';
  dob: string;
  age?: number;
  primary_diagnosis: string;
  dialysis_start_date: string;
  dialysis_age?: string;
  status: 'active' | 'suspended' | 'transferred' | 'transplanted' | 'deceased';
  isolation_zone: 'normal' | 'hbv' | 'hcv' | 'observation' | 'last_shift';
  comorbidities?: string[];
  phone?: string;
  id_card?: string;
  access_type?: string;
  access_location?: string;
}

export interface PatientStats {
  total_active: number;
  zone_normal: number;
  zone_hbv: number;
  zone_hcv: number;
  zone_obs: number;
  va_avf: number;
  va_avg: number;
  va_tcc: number;
  va_ncc: number;
}

export interface PatientQuery {
  page?: number;
  page_size?: number;
  status?: string;
  isolation_zone?: string;
  keyword?: string;
}

export const patientsApi = {
  list: (params: PatientQuery = {}) =>
    request.get<ApiResponse<PagedData<Patient>>>('/patients', { params }),

  stats: () =>
    request.get<ApiResponse<PatientStats>>('/patients/stats'),

  get: (id: string) =>
    request.get<ApiResponse<Patient>>(`/patients/${id}`),

  create: (data: Partial<Patient> & { phone?: string; id_card?: string }) =>
    request.post<ApiResponse<Patient>>('/patients', data),

  update: (id: string, data: Partial<Patient>) =>
    request.put<ApiResponse<Patient>>(`/patients/${id}`, data),

  updateStatus: (id: string, status: string, note?: string) =>
    request.patch<ApiResponse<Patient>>(`/patients/${id}/status`, { status, status_note: note }),

  updateIsolation: (id: string, isolation_zone: string) =>
    request.patch<ApiResponse<Patient>>(`/patients/${id}/isolation`, { isolation_zone }),
};
