/**
 * 透析机与耗材 API（/api/devices）
 */
import request, { type ApiResponse } from './request';

export interface MachineRow {
  id: string;
  machine_no: string;
  model: string | null;
  brand: string | null;
  zone: 'normal' | 'hbv' | 'hcv';
  status: 'active' | 'maintenance' | 'retired' | 'fault';
  serial_no?: string | null;
  purchase_date?: string | null;
  notes?: string | null;
  bacterial_filter_installed_at?: string | null;
  bacterial_filter_max_days?: number | null;
  last_dialysate_lab_at?: string | null;
  last_disinfection_at?: string | null;
  total_sessions?: string | number;
  total_runtime_minutes?: string | number;
  today_sessions?: string | number;
  last_maintenance_date?: string | null;
  next_maintenance_due?: string | null;
  active_alert_count?: number;
}

export interface MachineMaintenanceRow {
  id: string;
  machine_id: string;
  maintenance_type: string;
  maintenance_date: string;
  next_due?: string | null;
  content: string;
  result?: string | null;
  notes?: string | null;
  maintained_by_name?: string | null;
}

export interface AlertRow {
  id: string;
  machine_id?: string | null;
  alert_type: string;
  priority?: string;
  title: string;
  message: string;
  status: string;
  created_at: string;
}

export interface ConsumableStockRow {
  id: string;
  item_name: string;
  item_code?: string | null;
  category: string;
  specification?: string | null;
  unit: string;
  current_stock: number;
  alert_threshold: number;
  dialyzer_flux?: 'high' | 'low' | null;
  manufacturer?: string | null;
  registration_no?: string | null;
  storage_location?: string | null;
  batch_remaining_sum?: string | number;
}

export interface LastInboundRow {
  lot_no: string;
  expiry_date?: string | null;
  supplier?: string | null;
  unit_price?: string | number | null;
  inbound_at: string;
  notes?: string | null;
}

export interface OutboundLineRow {
  id: string;
  outbound_date: string;
  quantity: number;
  item_name: string;
  unit: string;
  specification?: string | null;
  patient_name: string;
  operated_by_name?: string | null;
  dialysis_record_id?: string | null;
}

export interface TodaySummary {
  scheduled_patients: number;
  outbound_lines_today: number;
}

export interface WaterMachineRow {
  id: string;
  machine_no: string;
  model: string | null;
  brand: string | null;
  location: string | null;
  status: 'active' | 'maintenance' | 'retired' | 'fault';
  last_disinfection_at?: string | null;
  next_disinfection_due?: string | null;
  last_water_test_date?: string | null;
  last_water_test_result?: string | null;
  notes?: string | null;
}

export interface WaterMaintenanceRow {
  id: string;
  water_machine_id: string;
  maintenance_type: string;
  maintenance_date: string;
  next_due?: string | null;
  content: string;
  result?: string | null;
  notes?: string | null;
  maintained_by_name?: string | null;
}

export interface WaterQualityRecord {
  id: string;
  test_date: string;
  test_type: string | null;
  sample_point: string | null;
  bacteria_count?: number | null;
  endotoxin_value?: number | null;
  conductivity?: number | null;
  hardness?: number | null;
  chlorine?: number | null;
  result?: string | null;
  notes?: string | null;
  tested_by_name?: string | null;
}

export interface CreateMachinePayload {
  machine_no: string;
  model?: string;
  brand?: string;
  zone?: string;
  status?: string;
  serial_no?: string;
  purchase_date?: string;
  notes?: string;
  bacterial_filter_installed_at?: string;
  bacterial_filter_max_days?: number;
  last_dialysate_lab_at?: string;
  last_disinfection_at?: string;
}

export interface InboundPayload {
  stock_item_id: string;
  quantity: number;
  lot_no: string;
  expiry_date?: string;
  notes?: string;
}

export interface CreateConsumableStockPayload {
  item_name: string;
  category: string;
  specification?: string;
  unit: string;
  dialyzer_flux?: 'high' | 'low';
  manufacturer?: string;
  registration_no?: string;
  storage_location?: string;
  alert_threshold?: number;
}

export interface CreateMachineAlertPayload {
  alert_type?: string;
  priority?: string;
  title: string;
  message: string;
}

export const devicesApi = {
  machines: () => request.get<ApiResponse<MachineRow[]>>('/devices/machines'),

  createMachine: (data: CreateMachinePayload) =>
    request.post<ApiResponse<MachineRow>>('/devices/machines', data),

  patchMachine: (id: string, data: Partial<CreateMachinePayload & { status?: string }>) =>
    request.patch<ApiResponse<MachineRow>>(`/devices/machines/${id}`, data),

  machineMaintenance: (machineId: string) =>
    request.get<ApiResponse<MachineMaintenanceRow[]>>(`/devices/machines/${machineId}/maintenance`),

  addMachineMaintenance: (
    machineId: string,
    body: {
      maintenance_type: string;
      maintenance_date: string;
      next_due?: string;
      content: string;
      result?: string;
      notes?: string;
    }
  ) => request.post<ApiResponse<MachineMaintenanceRow>>(`/devices/machines/${machineId}/maintenance`, body),

  machineAlerts: (machineId: string) =>
    request.get<ApiResponse<AlertRow[]>>(`/devices/machines/${machineId}/alerts`),

  createMachineAlert: (machineId: string, body: CreateMachineAlertPayload) =>
    request.post<ApiResponse<AlertRow>>(`/devices/machines/${machineId}/alerts`, body),

  consumables: () => request.get<ApiResponse<ConsumableStockRow[]>>('/devices/consumables'),

  lastInbound: (stockId: string) =>
    request.get<ApiResponse<LastInboundRow | null>>(`/devices/consumables/${stockId}/last-inbound`),

  inbound: (data: InboundPayload) =>
    request.post<ApiResponse<unknown>>('/devices/consumables/inbound', data),

  createConsumableStock: (data: CreateConsumableStockPayload) =>
    request.post<ApiResponse<ConsumableStockRow>>('/devices/consumables', data),

  outboundLines: (params?: { start_date?: string; end_date?: string; stock_item_id?: string; page?: number }) =>
    request.get<ApiResponse<OutboundLineRow[]>>('/devices/consumables/outbound-lines', { params }),

  patientUsage: (patientId: string, stockItemId?: string) =>
    request.get<ApiResponse<OutboundLineRow[]>>('/devices/consumables/patient-usage', {
      params: { patient_id: patientId, stock_item_id: stockItemId },
    }),

  todaySummary: () => request.get<ApiResponse<TodaySummary>>('/devices/consumables/today-summary'),

  waterMachines: () => request.get<ApiResponse<WaterMachineRow[]>>('/devices/water-machines'),

  waterMachineMaintenance: (waterMachineId: string) =>
    request.get<ApiResponse<WaterMaintenanceRow[]>>(`/devices/water-machines/${waterMachineId}/maintenance`),

  addWaterMachineMaintenance: (
    waterMachineId: string,
    body: {
      maintenance_type: string;
      maintenance_date: string;
      next_due?: string;
      content: string;
      result?: string;
      notes?: string;
    },
  ) =>
    request.post<ApiResponse<WaterMaintenanceRow>>(
      `/devices/water-machines/${waterMachineId}/maintenance`,
      body,
    ),

  waterQualityList: (params?: { start_date?: string; end_date?: string; page?: number }) =>
    request.get<ApiResponse<WaterQualityRecord[]>>('/devices/water-quality', { params }),

  createWaterQuality: (data: {
    test_date: string;
    test_type?: string;
    sample_point?: string;
    bacteria_count?: number;
    endotoxin_value?: number;
    conductivity?: number;
    hardness?: number;
    chlorine?: number;
    result?: string;
    notes?: string;
  }) => request.post<ApiResponse<WaterQualityRecord>>('/devices/water-quality', data),
};
