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
  /** 档案约定机位说明（与患者档案同步，可选） */
  machineStation?: string | null;
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
  /** 护患比用护士人数：nurse_schedule 有记录时用其条数；否则用护士空白表解析人数 */
  staffingNurseCount?: number;
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
  /** 与档案同步的约定机位（schedules.machine_station） */
  machine_station?: string | null;
  /** 档案维护的干体重（无处方干体重时工作台展示用） */
  profile_dry_weight?: number | string | null;
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

/** 护士排班空白表一行：姓名 + 周一至周日 + 欠休（共 14 行，末行为「本周二线」） */
export type NurseScheduleWeekdayTexts = [string, string, string, string, string, string, string];

export interface NurseScheduleSheetRow {
  name: string;
  days: NurseScheduleWeekdayTexts;
  owe: string;
}

export interface NurseScheduleSheetPayload {
  week_start_date: string;
  rows: NurseScheduleSheetRow[];
  /** 白班合并分区格内容 */
  white_zone?: string;
  updated_at: string | null;
  updated_by_name: string | null;
}

const NURSE_SHEET_ROW_COUNT = 14;

export function createEmptyNurseSheetRows(): NurseScheduleSheetRow[] {
  const emptyDays = (): NurseScheduleWeekdayTexts => ['', '', '', '', '', '', ''];
  return Array.from({ length: NURSE_SHEET_ROW_COUNT }, () => ({
    name: '',
    days: emptyDays(),
    owe: '',
  }));
}

/** 与后端 normalize 一致，用于加载接口数据 */
export function normalizeNurseSheetRowsClient(input: unknown): NurseScheduleSheetRow[] {
  const emptyDays = (): NurseScheduleWeekdayTexts => ['', '', '', '', '', '', ''];
  const emptyRow = (): NurseScheduleSheetRow => ({ name: '', days: emptyDays(), owe: '' });
  if (!Array.isArray(input)) {
    return createEmptyNurseSheetRows();
  }
  const out: NurseScheduleSheetRow[] = [];
  for (let i = 0; i < NURSE_SHEET_ROW_COUNT; i += 1) {
    const r = input[i] as Record<string, unknown> | undefined;
    if (!r || typeof r !== 'object') {
      out.push(emptyRow());
      continue;
    }
    const name = typeof r.name === 'string' ? r.name : '';
    const owe = typeof r.owe === 'string' ? r.owe : '';
    const rawDays = Array.isArray(r.days) ? r.days : [];
    const daysStr = rawDays.map((x) => {
      if (typeof x !== 'string') return '';
      const t = x.trim();
      /* 占位横线不作为有效内容，便于格子恢复为可编辑空白 */
      if (t === '—' || t === '－' || t === '-') return '';
      return x;
    });
    while (daysStr.length < 7) daysStr.push('');
    const days = daysStr.slice(0, 7) as NurseScheduleWeekdayTexts;
    out.push({ name, days, owe });
  }
  return out;
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
    is_temp?: boolean;
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

  /** 护士长排班空白表（按周） */
  getNurseSheet: async (weekStart: string): Promise<NurseScheduleSheetPayload> => {
    const res = await request.get<ApiResponse<NurseScheduleSheetPayload>>('/schedule/nurse-sheet', {
      params: { week_start: weekStart },
    });
    return res.data.data;
  },

  putNurseSheet: async (payload: {
    week_start_date: string;
    rows: NurseScheduleSheetRow[];
    white_zone?: string;
  }): Promise<NurseScheduleSheetPayload> => {
    const res = await request.put<ApiResponse<NurseScheduleSheetPayload>>('/schedule/nurse-sheet', payload);
    return res.data.data;
  },
};

