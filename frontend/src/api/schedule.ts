import request, { type ApiResponse } from './request';

export type ShiftKey = 'am' | 'pm' | 'eve';

export interface WeekDay {
  date: string;
  label: string;
}

export interface PatientSlot {
  patientId: string;
  name: string;
  isolationZone: 'normal' | 'hbv' | 'hcv' | null;
  machineNo: string | null;
  isTemp: boolean;
  status: 'planned' | 'cancelled' | 'completed';
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

export const scheduleApi = {
  getWeek: async (startDate: string): Promise<WeekScheduleResponse> => {
    const res = await request.get<ApiResponse<WeekScheduleResponse>>('/schedule/week', {
      params: { start_date: startDate },
    });
    return res.data.data;
  },

  adjustNurses: (payload: { date: string; shift: ShiftKey; nurseIds: string[] }) =>
    request.post<ApiResponse<null>>('/schedule/nurse-adjust', payload),
};

