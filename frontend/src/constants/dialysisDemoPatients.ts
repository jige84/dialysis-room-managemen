/**
 * 透析录入 / 处方工作台共用的演示患者数据（保持两页一致）
 */
export type VascularAccessType = 'AVF' | 'AVG' | 'TCC' | 'NCC';

export interface DialysisDemoPatient {
  value: string;
  label: string;
  prescribingDoctorName: string;
  dryWeight: number;
  prescription: {
    bloodFlow: number;
    duration: number;
    dialysateFlow: number;
    anticoagulant: string;
    dialyzer: string;
    na: number;
    k: number;
    ca: number;
  };
  preAssessment: {
    sbp: number;
    dbp: number;
    pulse: number;
    temp: number;
    shift: string;
    machineNo: string;
  };
  vascular: {
    accessType: VascularAccessType;
    catheterLocation: string;
    catheterPlacedDate: string | null;
  };
}

export const DIALYSIS_DEMO_PATIENTS: DialysisDemoPatient[] = [
  {
    value: 'zhang',
    label: '张国华 — 男/56岁/AVF/下午班/5号机',
    prescribingDoctorName: '王建国',
    dryWeight: 62.0,
    prescription: {
      bloodFlow: 260,
      duration: 4.0,
      dialysateFlow: 500,
      anticoagulant: '普通肝素 首剂3000IU',
      dialyzer: 'FX80（高通量）',
      na: 143,
      k: 2.0,
      ca: 1.5,
    },
    preAssessment: { sbp: 140, dbp: 80, pulse: 78, temp: 36.5, shift: '下午班', machineNo: '5号机' },
    vascular: { accessType: 'AVF', catheterLocation: '', catheterPlacedDate: null },
  },
  {
    value: 'zhao',
    label: '赵丽萍 — 女/48岁/AVF/下午班/6号机',
    prescribingDoctorName: '李晓明',
    dryWeight: 52.0,
    prescription: {
      bloodFlow: 230,
      duration: 4.0,
      dialysateFlow: 500,
      anticoagulant: '低分子肝素',
      dialyzer: 'FX60（低通量）',
      na: 143,
      k: 2.0,
      ca: 1.5,
    },
    preAssessment: { sbp: 136, dbp: 76, pulse: 82, temp: 36.6, shift: '下午班', machineNo: '6号机' },
    vascular: { accessType: 'AVG', catheterLocation: '', catheterPlacedDate: null },
  },
  {
    value: 'liu',
    label: '刘明远 — 男/65岁/TCC/下午班/7号机',
    prescribingDoctorName: '陈文静',
    dryWeight: 50.0,
    prescription: {
      bloodFlow: 220,
      duration: 4.0,
      dialysateFlow: 500,
      anticoagulant: '普通肝素 首剂3000IU',
      dialyzer: 'FX80（高通量）',
      na: 143,
      k: 2.0,
      ca: 1.5,
    },
    preAssessment: { sbp: 145, dbp: 82, pulse: 84, temp: 36.7, shift: '下午班', machineNo: '7号机' },
    vascular: { accessType: 'TCC', catheterLocation: 'right_jugular', catheterPlacedDate: '2025-12-01' },
  },
];
