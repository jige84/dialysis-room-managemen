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
  ckd_stage?: number | null;
  dialysis_mode?: string;
  family_contact?: { name?: string; phone?: string } | null;
  address?: string | null;
  consent_dialysis?: boolean;
  consent_dialysis_date?: string | null;
  present_illness?: string | null;
  past_history?: string | null;
}

/** GET /api/patients/:id 完整档案（含解密联系方式等） */
export interface PatientDetailRecord extends Patient {
  address?: string | null;
  family_contact?: { name?: string; phone?: string } | null;
  dialysis_mode?: string;
  ckd_stage?: number | null;
  consent_dialysis?: boolean;
  consent_dialysis_date?: string | null;
  consent_cvc?: boolean;
  consent_cvc_date?: string | null;
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

/** POST /api/patients 请求体（与后端 `routes/patients.js` 一致） */
export interface CreatePatientPayload {
  name: string;
  gender: 'M' | 'F';
  dob: string;
  dialysis_start_date: string;
  primary_diagnosis: string;
  present_illness?: string;
  past_history?: string;
  id_card?: string;
  phone?: string;
  family_contact?: { name?: string; phone?: string };
  address?: string;
  ckd_stage?: number;
  comorbidities?: string[];
  dialysis_mode?: string;
  isolation_zone?: 'normal' | 'hbv' | 'hcv' | 'observation' | 'last_shift';
  consent_dialysis?: boolean;
  consent_dialysis_date?: string | null;
  consent_cvc?: boolean;
  consent_cvc_date?: string | null;
}

export type UpdatePatientPayload = Partial<CreatePatientPayload>;

export const patientsApi = {
  list: (params: PatientQuery = {}) =>
    request.get<ApiResponse<PagedData<Patient>>>('/patients', { params }),

  stats: () =>
    request.get<ApiResponse<PatientStats>>('/patients/stats'),

  get: (id: string) =>
    request.get<ApiResponse<PatientDetailRecord>>(`/patients/${id}`),

  create: (data: CreatePatientPayload) =>
    request.post<ApiResponse<Patient>>('/patients', data),

  update: (id: string, data: UpdatePatientPayload) =>
    request.put<ApiResponse<Patient>>(`/patients/${id}`, data),

  updateStatus: (id: string, status: string, note?: string) =>
    request.patch<ApiResponse<Patient>>(`/patients/${id}/status`, { status, status_note: note }),

  updateIsolation: (id: string, isolation_zone: string) =>
    request.patch<ApiResponse<Patient>>(`/patients/${id}/isolation`, { isolation_zone }),
};
