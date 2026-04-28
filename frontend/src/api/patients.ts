/**
 * 患者档案相关 API 封装与类型定义
 * 主要作用：对接 /api/patients 系列接口，供列表、详情、新建编辑页使用。
 * 主要功能：分页列表、单条详情、创建/更新；TypeScript 实体类型与请求体类型导出。
 */
import request, { type ApiResponse, type PagedData } from './request';

export interface Patient {
  id: string;
  name: string;
  gender?: 'M' | 'F' | null;
  dob?: string | null;
  age?: number | null;
  primary_diagnosis?: string | null;
  dialysis_start_date?: string | null;
  dialysis_age?: string | null;
  status: 'active' | 'suspended' | 'hospitalized' | 'transferred' | 'transplanted' | 'deceased';
  isolation_zone: 'normal' | 'hbv' | 'hcv' | 'observation' | 'last_shift';
  comorbidities?: string[];
  phone?: string;
  id_card?: string;
  patient_identifier?: string | null;
  access_type?: string;
  access_location?: string;
  ckd_stage?: number | null;
  dialysis_mode?: string;
  /** 档案维护的抗凝默认值（保存档案时同步至当前有效处方） */
  profile_anticoagulant?: 'heparin' | 'lmwh' | 'citrate' | 'none';
  profile_heparin_prime_dose?: number | null;
  profile_heparin_maintain?: number | null;
  /** 档案干体重，与当前处方双向同步 */
  profile_dry_weight?: number | string | null;
  profile_dry_weight_date?: string | null;
  profile_dry_weight_reason?: string | null;
  /** 当前有效处方干体重（列表等场景下与 profile_dry_weight 二选一：优先档案） */
  prescription_dry_weight?: number | string | null;
  family_contact?: { name?: string; phone?: string } | null;
  address?: string | null;
  consent_dialysis?: boolean;
  consent_dialysis_date?: string | null;
  present_illness?: string | null;
  past_history?: string | null;
  /** 透析排班预设代码，如 tiw_mwf_morning、biw5_alt、qod、other */
  dialysis_schedule_code?: string | null;
  /** 透析时间补充/调整说明 */
  dialysis_schedule_notes?: string | null;
  /** 隔日透析(qod)排班锚点日期 */
  dialysis_schedule_anchor_date?: string | null;
  /** 约定机位/位置说明（可选）；保存档案时同步至该患者全部排班记录 */
  machine_station?: string | null;
  /** 知情同意书图片相对路径列表（详情返回；列表不返回） */
  consent_dialysis_image_paths?: string[] | null;
  /** 责任护士用户 ID */
  responsible_nurse_id?: string | null;
  /** 责任护士姓名（列表/详情展示） */
  responsible_nurse_name?: string | null;
}

/** 传染病筛查摘要条目 */
export interface InfectionScreeningSummary {
  test_type: string;
  result: string;
  test_date: string;
  next_due_date: string | null;
}

/** 知情同意子对象 */
export interface PatientConsents {
  dialysis: boolean;
  dialysis_date: string | null;
  cvc: boolean;
  cvc_date: string | null;
}

/** 最近透析记录摘要 */
export interface RecentDialysisRow {
  id: string;
  session_date: string;
  shift: string;
  ktv: number | null;
  urr: number | null;
  uf_volume: number | null;
  coagulation_grade: number | null;
}

/** 当前处方（内嵌在患者详情里） */
export interface PatientCurrentPrescription {
  rx_id: string;
  frequency_per_week: number | null;
  duration_hours: number | null;
  dialyzer_model: string | null;
  dry_weight: number | null;
  dry_weight_date: string | null;
  dry_weight_reason?: string | null;
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

/** GET /api/patients/:id 完整档案（含解密联系方式等） */
export interface PatientDetailRecord extends Patient, PatientCurrentPrescription {
  address?: string | null;
  family_contact?: { name?: string; phone?: string } | null;
  dialysis_mode?: string;
  ckd_stage?: number | null;
  consent_dialysis?: boolean;
  consent_dialysis_date?: string | null;
  consent_cvc?: boolean;
  consent_cvc_date?: string | null;
  dialysis_schedule_code?: string | null;
  dialysis_schedule_notes?: string | null;
  consent_dialysis_image_paths?: string[] | null;
  responsible_nurse_id?: string | null;
  responsible_nurse_name?: string | null;
  /** 血管通路列表（当前有效） */
  vascular_accesses?: VascularAccessSummary[];
  /** 最近3条透析记录摘要 */
  recent_dialysis?: RecentDialysisRow[];
  /** 传染病筛查最新结果（每类一条） */
  infection_screenings_summary?: InfectionScreeningSummary[];
  /** 知情同意子对象 */
  consents?: PatientConsents;
}

/** 血管通路摘要（患者详情中内嵌） */
export interface VascularAccessSummary {
  id: string;
  access_type: string;
  location: string | null;
  established_date: string | null;
  first_use_date: string | null;
  puncture_method: string | null;
  is_buttonhole: boolean;
  is_active: boolean;
  last_risk_score: number | null;
  last_risk_grade: string | null;
  last_ultrasound_date: string | null;
  ultrasound_result: string | null;
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
  dialysis_mode?: string;
  ckd_stage?: number;
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
  patient_identifier?: string;
  phone?: string;
  family_contact?: { name?: string; phone?: string };
  address?: string;
  ckd_stage?: number;
  comorbidities?: string[];
  dialysis_mode?: string;
  profile_anticoagulant?: 'heparin' | 'lmwh' | 'citrate' | 'none';
  profile_heparin_prime_dose?: number | null;
  profile_heparin_maintain?: number | null;
  profile_dry_weight?: number;
  profile_dry_weight_date?: string;
  profile_dry_weight_reason?: string | null;
  isolation_zone?: 'normal' | 'hbv' | 'hcv' | 'observation' | 'last_shift';
  status?: 'active' | 'suspended' | 'hospitalized' | 'transferred' | 'transplanted' | 'deceased';
  consent_dialysis?: boolean;
  consent_dialysis_date?: string | null;
  consent_cvc?: boolean;
  consent_cvc_date?: string | null;
  dialysis_schedule_code?: string | null;
  dialysis_schedule_notes?: string | null;
  dialysis_schedule_anchor_date?: string | null;
  machine_station?: string | null;
  /** 责任护士（须为本科室已启用的护士/护士长账号，新建必填） */
  responsible_nurse_id: string;
}

export type UpdatePatientPayload =
  Partial<Omit<CreatePatientPayload, 'dialysis_start_date' | 'primary_diagnosis'>>
  & {
    dialysis_start_date?: string | null;
    primary_diagnosis?: string | null;
  };

/** POST /patients/import 返回结构 */
export interface PatientImportRowError {
  rowIndex: number;
  name?: string;
  errors: string[];
}

export interface PatientImportSkippedDuplicate {
  rowIndex: number;
  name: string;
}

export interface PatientImportResult {
  total_data_rows: number;
  dry_run: boolean;
  imported_count: number;
  skipped_duplicate_count: number;
  imported: { rowIndex: number; id: string; name: string }[];
  skipped_duplicates: PatientImportSkippedDuplicate[];
  row_errors: PatientImportRowError[];
  id: string | null;
}

export interface PatientHistoryImportPatientRow {
  action: 'created' | 'updated';
  draft_id: string;
  id: string;
  name: string;
  matched_by: string;
  sources: string[];
}

export interface PatientHistoryImportLabRow {
  id: string;
  patient_id: string;
  patient_name: string;
  test_type: string;
  value: number;
  unit: string;
  test_date: string;
  source_file: string;
}

export interface PatientHistoryImportOrderRow {
  id: string;
  patient_id: string;
  patient_name: string;
  drug_name: string;
  order_type: string;
  frequency: string;
  valid_from: string;
  source_file: string;
}

export interface PatientHistoryImportDialysisRow {
  id: string;
  patient_id: string;
  patient_name: string;
  session_date: string;
  shift: 'morning' | 'afternoon' | 'evening';
  source_file: string;
  sheet_name?: string | null;
}

export interface PatientHistoryImportIssueRow {
  category: string;
  fileName: string;
  rowIndex: number | null;
  patientName: string | null;
  reason: string;
}

export interface PatientHistoryUnsupportedFile {
  fileName: string;
  reason: string;
}

export interface PatientHistoryImportResult {
  dry_run: boolean;
  files_count: number;
  patients_created: number;
  patients_updated: number;
  labs_created: number;
  orders_created: number;
  dialysis_created: number;
  patients: PatientHistoryImportPatientRow[];
  labs: PatientHistoryImportLabRow[];
  orders: PatientHistoryImportOrderRow[];
  dialysis_records?: PatientHistoryImportDialysisRow[];
  unresolved_items: PatientHistoryImportIssueRow[];
  unsupported_files: PatientHistoryUnsupportedFile[];
}

export interface PatientAutoImportAffectedPatient {
  id: string;
  name: string;
  action: 'created' | 'updated' | 'preview';
}

export interface PatientAutoImportResult {
  mode: 'bulk_template' | 'history_batch';
  dry_run: boolean;
  files_count: number;
  detected_file_types: string[];
  patients_created: number;
  patients_updated: number;
  labs_created: number;
  orders_created: number;
  dialysis_created: number;
  row_errors: PatientImportRowError[];
  unresolved_items: PatientHistoryImportIssueRow[];
  unsupported_files: PatientHistoryUnsupportedFile[];
  affected_patients: PatientAutoImportAffectedPatient[];
  skipped_duplicates: PatientImportSkippedDuplicate[];
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}

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

  remove: (id: string) =>
    request.delete<ApiResponse<{ id: string; name: string }>>(`/patients/${id}`),

  updateStatus: (id: string, status: string, note?: string) =>
    request.patch<ApiResponse<Patient>>(`/patients/${id}/status`, { status, status_note: note }),

  updateIsolation: (id: string, isolation_zone: string) =>
    request.patch<ApiResponse<Patient>>(`/patients/${id}/isolation`, { isolation_zone }),

  /** POST multipart：上传透析知情同意书图片 1～15 张（管理员/医生），覆盖原有存档 */
  uploadConsentDialysisImage: (patientId: string, files: Blob[]) => {
    const fd = new FormData();
    files.forEach(f => {
      fd.append('files', f);
    });
    return request.post<ApiResponse<{ consent_dialysis_image_paths: string[] }>>(
      `/patients/${patientId}/consent-dialysis-image`,
      fd,
      { timeout: 120000 },
    );
  },

  deleteConsentDialysisImage: (patientId: string, index: number) =>
    request.delete<ApiResponse<{ consent_dialysis_image_paths: string[]; removed_index: number }>>(
      `/patients/${patientId}/consent-dialysis-image/${index}`,
    ),

  searchByKeyword: (keyword: string) =>
    request.get<ApiResponse<PagedData<Patient>>>('/patients', {
      params: { page: 1, page_size: 10, keyword },
    }),

  /** GET blob：标准导入表头（含示例行，导入前请删除示例） */
  downloadImportTemplate: async () => {
    const response = await request.get<Blob>('/patients/import/template', { responseType: 'blob' });
    const blob =
      response.data instanceof Blob ? response.data : new Blob([response.data as BlobPart]);
    triggerBlobDownload(blob, 'patient_import_template.xlsx');
  },

  importFromXlsx: (file: File, dryRun: boolean) => {
    const fd = new FormData();
    fd.append('file', file);
    return request.post<ApiResponse<PatientImportResult>>(
      `/patients/import?dry_run=${dryRun ? '1' : '0'}`,
      fd,
      { timeout: 120000 },
    );
  },

  importHistoryFolder: (files: File[], dryRun: boolean) => {
    const fd = new FormData();
    files.forEach((file) => {
      fd.append('files', file);
    });
    return request.post<ApiResponse<PatientHistoryImportResult>>(
      `/patients/import/history-folder?dry_run=${dryRun ? '1' : '0'}`,
      fd,
      { timeout: 180000 },
    );
  },

  importAuto: (files: File[], dryRun: boolean) => {
    const fd = new FormData();
    files.forEach((file) => {
      fd.append('files', file);
    });
    return request.post<ApiResponse<PatientAutoImportResult>>(
      `/patients/import/auto?dry_run=${dryRun ? '1' : '0'}`,
      fd,
      { timeout: 180000 },
    );
  },
};
