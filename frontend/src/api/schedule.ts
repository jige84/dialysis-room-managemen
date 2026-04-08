/**
 * 排班与机位视图 API
 * 主要作用：按周/班次拉取患者上机计划、护士排班与单元格数据结构。
 * 主要功能：类型定义（班次、患者槽、护士槽等）与排班相关 GET 请求封装。
 */
import request, { type ApiResponse } from './request';

export type ShiftKey = 'am' | 'pm' | 'eve';

export interface WeekDay {
  date: string;
  label: string;
}

export interface PatientSlot {
  /** 排班实例 ID（用于手动调整/删除） */
  scheduleId: string;
  patientId: string;
  name: string;
  isolationZone: 'normal' | 'hbv' | 'hcv' | null;
  machineId: string | null;
  machineNo: string | null;
  isTemp: boolean;
  status: 'planned' | 'cancelled' | 'completed';
  /** 档案：腹透 PD / 血透 HD（与血透方式 HD·HDF·HD+HP 不同概念） */
  patientRenalCategory?: 'PD' | 'HD';
  /** 本条排班选择的血透方式；未选时由前端/接口按 HD 展示 */
  sessionDialysisMode?: string | null;
  /** 本条血透方式展示值（默认 HD） */
  dialysisMode?: string | null;
  /** 本条排班备注（临时调班说明、无肝素等） */
  scheduleRemark?: string | null;
}

export interface NurseSlot {
  nurseId: string;
  name: string;
}

export interface ScheduleCell {
  patients: PatientSlot[];
  nurses: NurseSlot[];
  ratio: string;
  compliant: boolean;
}

export interface WeekScheduleResponse {
  shifts: ShiftKey[];
  days: WeekDay[];
  cells: Record<ShiftKey, Record<string, ScheduleCell>>;
}

export interface GenerateWeekResult {
  weekStart: string;
  weekEnd: string;
  inserted: number;
  skipped: number;
  warnings: string[];
  note?: string;
  /** 参与生成的在透患者数（已排除频次为「其他」且未选编码者） */
  candidatePatients?: number;
  /** 透析频次展开后的时段总数（去重前） */
  expandedSlots?: number;
  /** 隔日透析未设锚点而跳过的人数 */
  skippedQodNoAnchor?: number;
  /** 因无空闲机位未能落位的时段数 */
  blockedNoMachine?: number;
  /** inserted===0 时的说明条目 */
  hints?: string[];
}

export interface ScheduleSlotRow {
  id: string;
  patient_id: string;
  machine_id: string;
  scheduled_date: string;
  shift: string;
  status?: string;
  is_temp?: boolean;
  [key: string]: unknown;
}

/** GET /schedule/today 单行（含 session_dialysis_mode / schedule_remark；工作台可含处方/透析记录扩展字段） */
export interface TodaySchedulePatientRow {
  id: string;
  patient_id: string;
  patient_name?: string;
  gender?: string;
  dob?: string;
  primary_diagnosis?: string;
  isolation_zone?: string | null;
  scheduled_date: string;
  shift: string;
  machine_no?: string | null;
  access_type?: string | null;
  session_dialysis_mode?: string | null;
  schedule_remark?: string | null;
  prescription_dry_weight?: number | string | null;
  dialysis_record_id?: string | null;
  dialysis_pre_weight?: number | string | null;
  dialysis_uf_volume?: number | string | null;
  dialysis_uf_pct_of_dry_weight?: number | string | null;
  dialysis_end_time?: string | null;
  dialysis_start_time?: string | null;
  dialysis_ktv?: number | string | null;
  [key: string]: unknown;
}

export const scheduleApi = {
  getWeek: async (startDate: string): Promise<WeekScheduleResponse> => {
    const res = await request.get<ApiResponse<WeekScheduleResponse>>('/schedule/week', {
      params: { start_date: startDate },
    });
    return res.data.data;
  },

  /** 今日排班实例（用于透析处方：上机日合并当日透析模式） */
  getToday: async (): Promise<TodaySchedulePatientRow[]> => {
    const res = await request.get<ApiResponse<TodaySchedulePatientRow[]>>('/schedule/today');
    const d = res.data.data;
    return Array.isArray(d) ? d : [];
  },

  adjustNurses: (payload: { date: string; shift: ShiftKey; nurseIds: string[] }) =>
    request.post<ApiResponse<null>>('/schedule/nurse-adjust', payload),

  generateWeek: (startDate: string) =>
    request.post<ApiResponse<GenerateWeekResult>>('/schedule/generate-week', { start_date: startDate }),

  createSlot: (payload: {
    patient_id: string;
    scheduled_date: string;
    shift: ShiftKey;
    machine_id: string;
    schedule_remark?: string | null;
    session_dialysis_mode?: string | null;
  }) => request.post<ApiResponse<ScheduleSlotRow>>('/schedule/slots', payload),

  updateSlot: (
    scheduleId: string,
    payload: Partial<{
      scheduled_date: string;
      shift: ShiftKey;
      machine_id: string;
      status: string;
      schedule_remark: string | null;
      session_dialysis_mode: string | null;
    }>,
  ) => request.patch<ApiResponse<ScheduleSlotRow>>(`/schedule/slots/${scheduleId}`, payload),

  deleteSlot: (scheduleId: string) =>
    request.delete<ApiResponse<null>>(`/schedule/slots/${scheduleId}`),
};

