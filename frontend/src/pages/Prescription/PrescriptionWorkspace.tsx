/**
 * 透析处方管理工作台（医生端）
 * 主要作用：查看与维护患者当前透析处方参数，关联历史处方列表。
 * 主要功能：处方表单编辑；历史版本 Modal；保存时对接 prescriptions API。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, Select, Button, InputNumber, Input, Form, Divider, Table, Modal, message, Tag, Alert, TimePicker, Collapse, Tooltip } from 'antd';
import dayjs from 'dayjs';
import { HistoryOutlined, SaveOutlined, InfoCircleFilled, CheckCircleFilled, LeftOutlined, RightOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';
import PageShell from '../../components/PageShell/PageShell';
import { devicesApi, type ConsumableStockRow } from '../../api/devices';
import { DIALYSIS_DEMO_PATIENTS, type DialysisDemoPatient } from '../../constants/dialysisDemoPatients';
import {
  buildPrescriptionDefaultsFromDemo,
  shiftCodeToChinese,
  frequencyPresetLabel,
  dialysisModeLabel,
  formatSodiumCurveSummary,
  yesNoAssessLabel,
  loadPrescriptionBasicParamsFromStorage,
  savePrescriptionBasicParamsToStorage,
  PRESCRIPTION_NOTES_COMBINED_SEPARATOR,
  splitPrescriptionNotesFromDb,
} from '../../utils/prescriptionFormFromDemo';
import {
  readPostDialysisSync,
  writePostDialysisSync,
  POST_DIALYSIS_SYNC_EVENT,
  type PostDialysisSyncPayload,
} from '../../utils/postDialysisAssessmentSync';
import prescriptionsApi, { type PrescriptionRecord } from '../../api/prescriptions';
import { patientsApi, type Patient, type PatientDetailRecord } from '../../api/patients';
import { scheduleApi, type TodaySchedulePatientRow } from '../../api/schedule';
import { isUuid } from '../../utils/anomalyAnalysis';
import {
  LEGACY_DIALYZER_PREFIX,
  LEGACY_HP_PREFIX,
  buildDialyzerSelectOptions,
  buildHemoperfusionSelectOptions,
  dialyzerDisplayShort,
  dialyzerStringForForm,
  hpCartridgeDisplayShort,
  isDialysisMembraneCatalogRow,
  isHemoperfusionCatalogRow,
  parseDialyzerFormSelection,
  resolveDialyzerFormValue,
  resolveHpCartridgeFormValue,
} from '../../utils/dialyzerCatalog';
import {
  scheduleShiftLabel,
  sessionDialysisModeShort,
  accessTypeCn,
  isolationTagProps,
  ageFromDob,
  groupTodayScheduleRowsByShiftThenZone,
  normalizeScheduleShiftKey,
} from '../../utils/dialysisTodayScheduleDisplay';
import { ANTICOAGULANT_OPTIONS, mapDbAnticoagulantToForm, mapFormAnticoagulantToDb } from '../../constants/prescriptionAnticoagulant';
import { mergeShiftFromPatientProfileIntoFormValues } from '../../constants/dialysisSchedule';
import { HD_PRESCRIPTION_SAVED_EVENT } from '../../constants/prescriptionSyncEvents';
import { useAuthStore } from '../../stores/authStore';
import { defaultSignatureFromUserDisplayName } from '../../utils/patientNamePinyin';

/** 今日排班名单侧栏宽度（与透析工作台同级） */
const PRESCRIPTION_TODAY_SIDER_WIDTH = 192;



const FREQUENCY_PRESET_OPTIONS = [
  { value: 'weekly_2', label: '每周2次' },
  { value: 'weekly_3', label: '每周3次' },
  { value: 'biweekly_5', label: '2周5次' },
  { value: 'weekly_1', label: '每周1次' },
  { value: 'other', label: '其他（手动填写）' },
] as const;

const MODE_OPTIONS = [
  { value: 'HD', label: 'HD（血液透析）' },
  { value: 'HDF', label: 'HDF（血液透析滤过）' },
  { value: 'HD_HP', label: 'HD+HP（血液透析+灌流）' },
  { value: 'other', label: '其他' },
] as const;

const HD_HP_HEPARIN_EXTRA_OPTIONS = [
  { value: 500, label: '+500 IU' },
  { value: 800, label: '+800 IU' },
] as const;

/** HDF 置换方式（与 prescriptions.hdf_replacement_mode 一致） */
const HDF_REPLACEMENT_MODE_OPTIONS = [
  { value: 'pre', label: '前置换' },
  { value: 'post', label: '后置换' },
  { value: 'both', label: '前后置换' },
] as const;

const HDF_REPLACEMENT_MODE_LABEL: Record<string, string> = {
  pre: '前置换',
  post: '后置换',
  both: '前后置换',
};

/** 血流速 / 透析液流速：界面默认值（HDF 常规更高透析液流量） */
const DEFAULT_BLOOD_FLOW_ML_MIN = 260;
const DEFAULT_DIALYSATE_FLOW_HD_ML_MIN = 500;
const DEFAULT_DIALYSATE_FLOW_HDF_ML_MIN = 800;

/** 透析液离子与温度：新开方/表单缺省（均可修改）；钠曲线缺省为 fixed（固定钠） */
const DEFAULT_DIALYSATE_NA_MMOL = 143;
const DEFAULT_DIALYSATE_K_MMOL = 2.0;
const DEFAULT_DIALYSATE_CA_MMOL = 1.5;
const DEFAULT_DIALYSATE_TEMP_C = 36.5;

function defaultDialysateFlowForMode(mode: string | undefined): number {
  return mode === 'HDF' ? DEFAULT_DIALYSATE_FLOW_HDF_ML_MIN : DEFAULT_DIALYSATE_FLOW_HD_ML_MIN;
}

const YES_NO_ASSESS_OPTIONS = [
  { value: 'no', label: '无' },
  { value: 'yes', label: '有' },
] as const;

function defaultYesNoAssessField(v: unknown): 'yes' | 'no' {
  return v === 'yes' || v === 'no' ? v : 'no';
}

const CITRATE_ANTICOAGULATION_MODE_OPTIONS = [
  { value: 'single_stage', label: '单段式（动脉端）' },
  { value: 'two_stage', label: '两段式（动脉端 + 静脉壶前）' },
] as const;

const CITRATE_DIALYSATE_CALCIUM_OPTIONS = [
  { value: 1.25, label: '1.25 mmol/L' },
  { value: 1.5, label: '1.50 mmol/L（普通含钙透析液常用）' },
  { value: 1.75, label: '1.75 mmol/L' },
] as const;

const CITRATE_CALCIUM_SUPPLEMENT_OPTIONS = [
  { value: 'no', label: '否' },
  { value: 'yes', label: '是' },
  { value: 'individualized', label: '个体化' },
] as const;

const CITRATE_TARGET_ICA_OPTIONS = [
  { value: '0.25-0.35', label: '0.25-0.35 mmol/L' },
  { value: '0.20-0.40', label: '0.20-0.40 mmol/L' },
  { value: 'custom', label: '自定义' },
] as const;

const CITRATE_MONITOR_POINT_OPTIONS = [
  { value: 'pre', label: '透前' },
  { value: '2h', label: '透析2h' },
  { value: 'end', label: '透析结束' },
] as const;

const CITRATE_COAGULATION_SITE_OPTIONS = [
  { value: 'dialyzer', label: '透析器' },
  { value: 'venous_chamber', label: '静脉壶' },
] as const;

const TIME_HM_FORMAT = 'HH:mm';

function timePickerStringBinding() {
  return {
    getValueProps: (value: unknown) => ({
      value:
        typeof value === 'string' && /^\d{1,2}:\d{2}$/.test(value.trim())
          ? dayjs(value.trim(), TIME_HM_FORMAT)
          : undefined,
    }),
    normalize: (value: unknown) =>
      dayjs.isDayjs(value) && value.isValid() ? value.format(TIME_HM_FORMAT) : '',
  };
}

/** 可调钠曲线（含单超相关模式，供处方与上机参数联动） */
const SODIUM_CURVE_OPTIONS = [
  { value: 'fixed', label: '固定钠（无钠曲线）' },
  { value: 'linear_up', label: '线性升钠曲线' },
  { value: 'linear_down', label: '线性降钠曲线' },
  { value: 'step', label: '阶梯式钠曲线' },
  { value: 'programmable', label: '可编程钠曲线（按机型档案）' },
  { value: 'iuf', label: '单超（单纯超滤）' },
  { value: 'iuf_sequential_hd', label: '单超序贯透析（先单超后常规 HD）' },
  { value: 'other', label: '其他（手动说明）' },
] as const;

/** 低分子肝素类：首剂按透析模式叠加 IU（规程演示用） */
const LMWH_FAMILY = new Set(['lmwh', 'enoxaparin', 'bemiparin']);

/** 超滤量：HD/HDF 额外 +200mL，HD+HP 额外 +500mL（预冲/置换等协议量） */
const UF_MODE_EXTRA_ML: Record<string, number> = {
  HD: 200,
  HDF: 200,
  HD_HP: 500,
};

/**
 * 超滤量是否超过干体重 5%（与质控警示一致：ufMl / (dryKg×1000) > 5%）
 */
function isUltrafiltrationExceedsDryWeightRatio(ufMl: number, dryWeightKg: number): boolean {
  if (!(dryWeightKg > 0) || !Number.isFinite(ufMl)) return false;
  const ratio = ufMl / (dryWeightKg * 1000);
  return ratio > 0.05;
}

function computeUltrafiltrationMl(
  preMachineWeightKg: number | undefined | null,
  dryWeightKg: number | undefined | null,
  mode: string | undefined
): number | null {
  if (preMachineWeightKg == null || dryWeightKg == null) return null;
  if (!Number.isFinite(preMachineWeightKg) || !Number.isFinite(dryWeightKg)) return null;
  const diffMl = (preMachineWeightKg - dryWeightKg) * 1000;
  const extra = UF_MODE_EXTRA_ML[mode ?? ''] ?? 0;
  return Math.round(diffMl + extra);
}

function computeLmwhFamilyFirstDoseIU(
  coreIU: number,
  mode: string | undefined,
  anticoagulant: string | undefined,
  hdHpHeparinExtraIU: number | undefined,
): number {
  if (!LMWH_FAMILY.has(anticoagulant ?? '')) return coreIU;
  if (mode === 'HDF') return coreIU + 200;
  if (mode === 'HD_HP') return coreIU + (hdHpHeparinExtraIU ?? 500);
  return coreIU;
}

type BasicParamsStored = Partial<{
  frequencyPreset: string;
  frequencyCustom: string;
  duration: number;
  mode: string;
  modeOther: string;
  hpHeparinExtraIU: number;
  dialyzer: string;
  /** HD+HP：灌流器（耗材目录 UUID 或 legacy_hp|||型号） */
  hpCartridge: string;
  bloodFlow: number;
  dialysateFlow: number;
  anticoagulant: string;
  heparinFirst: number;
  heparinMaint: number;
  dryWeightChangeReason: string;
  preMachineWeight: number;
  ultrafiltrationMl: number;
  sodiumCurve: string;
  sodiumCurveCustom: string;
  naCurveStart: number;
  naCurveEnd: number;
  /** 钠曲线生效时段 HH:mm */
  naCurveTimeStart: string;
  naCurveTimeEnd: string;
  preAssessSbp: number;
  preAssessDbp: number;
  preAssessPulse: number;
  /** 透前其他补充 */
  preAssessOther: string;
  preAssessEdema: string;
  preAssessEdemaSite: string;
  preAssessBleeding: string;
  preAssessBleedingDesc: string;
  citrateDetail: string;
  citrateMode: string;
  citrateConcentration: number;
  citrateArterialPumpRate: number;
  citrateVenousPumpRate: number;
  citrateBloodFlowRate: number;
  citrateDialysateFlowRate: number;
  citrateDialysateCalcium: number;
  citrateCalciumSupplement: string;
  citratePostFilterICa: number;
  citrateTargetPostFilterICa: string;
  citrateTargetPostFilterICaCustom: string;
  citrateMonitorPoints: string[];
  citrateCoagulationSites: string[];
  /** HDF：pre / post / both */
  hdfReplacementMode: string;
  hdfReplacementVolumeL: number;
  /** 处方备注卡片（与 preAssessOther 合并入库 prescriptions.notes） */
  notes: string;
  /** 血透方式备注 → prescriptions.hemodialysis_remark */
  hemodialysisRemark: string;
  doctorSignature: string;
}>;

const BASIC_PARAM_KEYS = [
  'frequencyPreset',
  'frequencyCustom',
  'duration',
  'mode',
  'modeOther',
  'hpHeparinExtraIU',
  'dialyzer',
  'hpCartridge',
  'bloodFlow',
  'dialysateFlow',
  'anticoagulant',
  'heparinFirst',
  'heparinMaint',
  'dryWeightChangeReason',
  'preMachineWeight',
  'ultrafiltrationMl',
  'sodiumCurve',
  'sodiumCurveCustom',
  'naCurveStart',
  'naCurveEnd',
  'naCurveTimeStart',
  'naCurveTimeEnd',
  'preAssessSbp',
  'preAssessDbp',
  'preAssessPulse',
  'preAssessOther',
  'preAssessEdema',
  'preAssessEdemaSite',
  'preAssessBleeding',
  'preAssessBleedingDesc',
  'citrateDetail',
  'citrateMode',
  'citrateConcentration',
  'citrateArterialPumpRate',
  'citrateVenousPumpRate',
  'citrateBloodFlowRate',
  'citrateDialysateFlowRate',
  'citrateDialysateCalcium',
  'citrateCalciumSupplement',
  'citratePostFilterICa',
  'citrateTargetPostFilterICa',
  'citrateTargetPostFilterICaCustom',
  'citrateMonitorPoints',
  'citrateCoagulationSites',
  'hdfReplacementMode',
  'hdfReplacementVolumeL',
  'notes',
  'hemodialysisRemark',
  'doctorSignature',
] as const satisfies readonly (keyof BasicParamsStored)[];

function loadStoredBasicParams(patientId?: string): BasicParamsStored {
  const stored = loadPrescriptionBasicParamsFromStorage(patientId) as BasicParamsStored;
  if (stored.mode === 'HD_HP_800') {
    return { ...stored, mode: 'HD_HP', hpHeparinExtraIU: 800 };
  }
  return stored;
}

function pickBasicParams(values: Record<string, unknown>): BasicParamsStored {
  const out: BasicParamsStored = {};
  for (const key of BASIC_PARAM_KEYS) {
    if (key in values && values[key] !== undefined) {
      (out as Record<string, unknown>)[key] = values[key];
    }
  }
  return out;
}

function coerceNumberField(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * DB 未带 form_extra 时，用同浏览器 localStorage 补齐 BASIC_PARAM_KEYS；
 * 干体重与上机前体重齐全时补算超滤量；若已存超滤与公式差异较大则视为曾手动修改，避免被自动公式覆盖。
 */
function enrichMappedPrescriptionForm(
  mapped: Record<string, unknown>,
  patientId: string,
): { form: Record<string, unknown>; ultrafiltrationManualFromLoad: boolean } {
  const stored = loadStoredBasicParams(patientId);
  const form: Record<string, unknown> = { ...mapped };
  for (const key of BASIC_PARAM_KEYS) {
    if (
      (form[key] === undefined || form[key] === null) &&
      stored[key] !== undefined &&
      stored[key] !== null
    ) {
      (form as Record<string, unknown>)[key] = stored[key];
    }
  }
  form.preAssessEdema = defaultYesNoAssessField(form.preAssessEdema);
  form.preAssessBleeding = defaultYesNoAssessField(form.preAssessBleeding);
  const mode = typeof form.mode === 'string' ? form.mode : undefined;
  const pre = coerceNumberField(form.preMachineWeight);
  const dry = coerceNumberField(form.dryWeight);
  const computedUf = computeUltrafiltrationMl(pre, dry, mode);
  const existingUf = coerceNumberField(form.ultrafiltrationMl);
  let ultrafiltrationManualFromLoad = false;
  if (computedUf != null) {
    if (existingUf == null) {
      form.ultrafiltrationMl = computedUf;
    } else if (Math.abs(existingUf - computedUf) > 1) {
      ultrafiltrationManualFromLoad = true;
    }
  }
  return { form, ultrafiltrationManualFromLoad };
}

/** 与「录入透析记录」患者列表、数值同源 */
type PrescriptionPatientRow = {
  value: string;
  label: string;
  info: string;
  demo: DialysisDemoPatient;
  defaults: Record<string, unknown>;
};

const PATIENTS: PrescriptionPatientRow[] = DIALYSIS_DEMO_PATIENTS.map((demo) => ({
  value: demo.value,
  label: demo.label,
  info: `${demo.prescribingDoctorName} · 血管通路 ${demo.vascular.accessType}`,
  demo,
  defaults: buildPrescriptionDefaultsFromDemo(demo),
}));

/** 与透析录入页 ReadonlyValue / Grid 视觉一致 */
function RxReadonlyValue({
  label,
  value,
  color = '#0369A1',
  bg = '#F0F9FF',
  border = '#BAE6FD',
  mono = false,
}: {
  label: string;
  value: ReactNode;
  color?: string;
  bg?: string;
  border?: string;
  mono?: boolean;
}) {
  return (
    <div className="hd-readonly-field">
      <div className="hd-readonly-field__label">{label}</div>
      <div
        className={`hd-readonly-field__value${mono ? ' num' : ''}`}
        style={{ background: bg, borderColor: border, color }}
      >
        {value}
      </div>
    </div>
  );
}

function RxGrid({
  cols = 4,
  gap = 14,
  children,
  style,
}: {
  cols?: number;
  gap?: number;
  children: ReactNode;
  style?: React.CSSProperties;
}) {
  const minWidth = cols >= 4 ? 168 : cols === 3 ? 220 : 260;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${minWidth}px), 1fr))`,
        gap,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

const PRESCRIPTION_HISTORY = [
  { key: '1', date: '2026-01-10', doctor: '任计阁', summary: 'HD · 4h · FX80 · 血流250 · 普通肝素', status: '当前有效' },
  { key: '2', date: '2025-08-20', doctor: '任计阁', summary: 'HD · 4h · FX80 · 血流240 · 普通肝素', status: '历史' },
  { key: '3', date: '2025-03-10', doctor: '任计阁', summary: 'HD · 3.5h · FX60 · 血流220 · 低分子肝素', status: '历史' },
];

function frequencyPresetToPerWeek(preset: string | undefined): number {
  switch (preset) {
    case 'weekly_2':
      return 2;
    case 'weekly_3':
      return 3;
    case 'weekly_1':
      return 1;
    case 'biweekly_5':
      return 2;
    default:
      return 3;
  }
}

function perWeekToFrequencyFields(week: number): { frequencyPreset: string; frequencyCustom: string } {
  if (week === 1) return { frequencyPreset: 'weekly_1', frequencyCustom: '' };
  if (week === 2) return { frequencyPreset: 'weekly_2', frequencyCustom: '' };
  if (week === 3) return { frequencyPreset: 'weekly_3', frequencyCustom: '' };
  return { frequencyPreset: 'other', frequencyCustom: `每周约 ${week} 次` };
}

/** 与排班 / 服务端 HD·HDF·HD_HP 一致 */
function hemoModalityFromApi(raw: string | null | undefined): { mode: string; modeOther: string } {
  if (!raw || !String(raw).trim()) return { mode: 'HD', modeOther: '' };
  const s = String(raw).trim();
  const u = s.toUpperCase().replace(/\+/g, '_');
  if (u === 'HD') return { mode: 'HD', modeOther: '' };
  if (u === 'HDF') return { mode: 'HDF', modeOther: '' };
  if (u === 'HD_HP' || u === 'HDHP' || u === 'HD_HP_800') return { mode: 'HD_HP', modeOther: '' };
  return { mode: 'other', modeOther: s };
}

function mapFormModeToHemodialysisModality(mode: string | undefined, modeOther: string | undefined): string {
  if (mode === 'other') {
    const t = String(modeOther ?? '').trim();
    return t || 'HD';
  }
  if (mode === 'HDF' || mode === 'HD_HP' || mode === 'HD') return mode;
  return 'HD';
}

function mergePrescriptionNotesForDb(
  preAssessOther: string | undefined,
  prescriptionNotes: string | undefined,
): string | undefined {
  const a = typeof preAssessOther === 'string' ? preAssessOther.trim() : '';
  const b = typeof prescriptionNotes === 'string' ? prescriptionNotes.trim() : '';
  if (a && b) return `${a}${PRESCRIPTION_NOTES_COMBINED_SEPARATOR}${b}`;
  return a || b || undefined;
}

function mapCurrentPrescriptionToFormValues(
  rx: PrescriptionRecord,
  dialyzerStocks: ConsumableStockRow[],
): Record<string, unknown> {
  const rawExtra = rx.form_extra;
  const formExtra =
    rawExtra != null && typeof rawExtra === 'object' && !Array.isArray(rawExtra)
      ? (rawExtra as Record<string, unknown>)
      : {};
  const freq = perWeekToFrequencyFields(Number(rx.frequency_per_week) || 3);
  const hemo = hemoModalityFromApi(rx.hemodialysis_modality);
  const notesForSplit =
    rx.notes == null ? null : typeof rx.notes === 'string' ? rx.notes : String(rx.notes);
  const splitNotes = splitPrescriptionNotesFromDb(notesForSplit);
  const coreModeForFlows = hemo.mode === 'other' ? 'HD' : hemo.mode;
  const defaultDialysateForRx =
    coreModeForFlows === 'HDF' ? DEFAULT_DIALYSATE_FLOW_HDF_ML_MIN : DEFAULT_DIALYSATE_FLOW_HD_ML_MIN;
  const hpStored =
    typeof formExtra.hpCartridge === 'string'
      ? formExtra.hpCartridge.trim()
      : typeof formExtra.hp_cartridge === 'string'
        ? formExtra.hp_cartridge.trim()
        : '';
  const fromColumns: Record<string, unknown> = {
    ...freq,
    duration: Number(rx.duration_hours) || 4,
    mode: hemo.mode,
    modeOther: hemo.modeOther,
    dialyzer: resolveDialyzerFormValue(
      { dialyzer_model: rx.dialyzer_model ?? null, dialyzer_flux: rx.dialyzer_flux ?? null },
      dialyzerStocks,
    ),
    hpCartridge:
      hpStored ||
      (hemo.mode === 'HD_HP'
        ? resolveHpCartridgeFormValue(
            typeof formExtra.hemoperfusion_model === 'string' ? formExtra.hemoperfusion_model : '',
            dialyzerStocks,
          )
        : ''),
    bloodFlow:
      rx.blood_flow_rate != null && Number.isFinite(Number(rx.blood_flow_rate))
        ? Number(rx.blood_flow_rate)
        : DEFAULT_BLOOD_FLOW_ML_MIN,
    dialysateFlow:
      rx.dialysate_flow_rate != null && Number.isFinite(Number(rx.dialysate_flow_rate))
        ? Number(rx.dialysate_flow_rate)
        : defaultDialysateForRx,
    anticoagulant: mapDbAnticoagulantToForm(rx.anticoagulant),
    heparinFirst: rx.heparin_prime_dose ?? undefined,
    heparinMaint: rx.heparin_maintain != null ? Number(rx.heparin_maintain) : undefined,
    na: rx.dialysate_na != null ? Number(rx.dialysate_na) : DEFAULT_DIALYSATE_NA_MMOL,
    k: rx.dialysate_k != null ? Number(rx.dialysate_k) : DEFAULT_DIALYSATE_K_MMOL,
    ca: rx.dialysate_ca != null ? Number(rx.dialysate_ca) : DEFAULT_DIALYSATE_CA_MMOL,
    temp: rx.dialysate_temp != null ? Number(rx.dialysate_temp) : DEFAULT_DIALYSATE_TEMP_C,
    dryWeight: rx.dry_weight != null ? Number(rx.dry_weight) : undefined,
    dryWeightChangeReason: rx.dry_weight_reason ?? '',
    hdfReplacementMode: rx.hdf_replacement_mode ?? undefined,
    hdfReplacementVolumeL:
      rx.hdf_replacement_volume_l != null && Number.isFinite(Number(rx.hdf_replacement_volume_l))
        ? Number(rx.hdf_replacement_volume_l)
        : undefined,
    preAssessOther: splitNotes.preAssessOther,
    notes: splitNotes.notes,
    hemodialysisRemark: rx.hemodialysis_remark != null ? String(rx.hemodialysis_remark) : '',
  };
  const m: Record<string, unknown> = { ...formExtra, ...fromColumns };
  const dialysateNa = rx.dialysate_na != null ? Number(rx.dialysate_na) : DEFAULT_DIALYSATE_NA_MMOL;
  return {
    ...m,
    hpHeparinExtraIU:
      m.mode === 'HD_HP' && (m.hpHeparinExtraIU === 800 || m.hpHeparinExtraIU === 500)
        ? m.hpHeparinExtraIU
        : formExtra.mode === 'HD_HP_800'
          ? 800
        : 500,
    sodiumCurve: typeof m.sodiumCurve === 'string' && m.sodiumCurve ? m.sodiumCurve : 'fixed',
    sodiumCurveCustom: typeof m.sodiumCurveCustom === 'string' ? m.sodiumCurveCustom : '',
    naCurveStart:
      typeof m.naCurveStart === 'number' && Number.isFinite(m.naCurveStart) ? m.naCurveStart : dialysateNa,
    naCurveEnd:
      typeof m.naCurveEnd === 'number' && Number.isFinite(m.naCurveEnd) ? m.naCurveEnd : dialysateNa,
    naCurveTimeStart: typeof m.naCurveTimeStart === 'string' ? m.naCurveTimeStart : '',
    naCurveTimeEnd: typeof m.naCurveTimeEnd === 'string' ? m.naCurveTimeEnd : '',
    preAssessEdema: defaultYesNoAssessField(m.preAssessEdema),
    preAssessBleeding: defaultYesNoAssessField(m.preAssessBleeding),
    preAssessEdemaSite: typeof m.preAssessEdemaSite === 'string' ? m.preAssessEdemaSite : '',
    preAssessBleedingDesc: typeof m.preAssessBleedingDesc === 'string' ? m.preAssessBleedingDesc : '',
  };
}

function applyHeparinCoreFromLoadedRx(
  hemoMode: string,
  anticoagulant: string | undefined,
  heparinFirst: number | undefined,
  hdHpHeparinExtraIU?: number,
): number {
  const first = heparinFirst ?? 0;
  if (!LMWH_FAMILY.has(anticoagulant ?? '')) return first;
  let core = first;
  if (hemoMode === 'HDF') core -= 200;
  if (hemoMode === 'HD_HP') core -= hdHpHeparinExtraIU ?? 500;
  return Math.max(0, core);
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function optionLabel<T extends { value: string | number; label: string }>(
  options: readonly T[],
  value: unknown,
): string {
  const found = options.find((o) => o.value === value);
  return found?.label ?? (value == null || value === '' ? '—' : String(value));
}

function optionLabels<T extends { value: string | number; label: string }>(
  options: readonly T[],
  value: unknown,
): string {
  if (!Array.isArray(value) || value.length === 0) return '—';
  return value.map((item) => optionLabel(options, item)).join('、');
}

function buildCitrateDetailSummary(values: Record<string, unknown>): string {
  if (values.anticoagulant !== 'citrate') return '';
  const target =
    values.citrateTargetPostFilterICa === 'custom'
      ? String(values.citrateTargetPostFilterICaCustom ?? '').trim() || '自定义'
      : optionLabel(CITRATE_TARGET_ICA_OPTIONS, values.citrateTargetPostFilterICa);
  const lines = [
    `抗凝方式：${optionLabel(CITRATE_ANTICOAGULATION_MODE_OPTIONS, values.citrateMode)}`,
    `枸橼酸浓度：${values.citrateConcentration ?? '—'}%`,
    `动脉端泵速：${values.citrateArterialPumpRate ?? '—'} mL/h`,
  ];
  if (values.citrateMode === 'two_stage') {
    lines.push(`静脉壶前泵速：${values.citrateVenousPumpRate ?? '—'} mL/h`);
  }
  lines.push(
    `血流速：${values.citrateBloodFlowRate ?? '—'} mL/min`,
    `透析液流速：${values.citrateDialysateFlowRate ?? '—'} mL/min`,
    `透析液钙浓度：${optionLabel(CITRATE_DIALYSATE_CALCIUM_OPTIONS, values.citrateDialysateCalcium)}`,
    `是否额外补钙：${optionLabel(CITRATE_CALCIUM_SUPPLEMENT_OPTIONS, values.citrateCalciumSupplement)}`,
    `滤器后游离钙监测：${values.citratePostFilterICa ?? '—'} mmol/L`,
    `目标滤器后 iCa：${target}`,
    `监测时间点：${optionLabels(CITRATE_MONITOR_POINT_OPTIONS, values.citrateMonitorPoints)}`,
    `凝血观察部位：${optionLabels(CITRATE_COAGULATION_SITE_OPTIONS, values.citrateCoagulationSites)}`,
  );
  return lines.join('；');
}

/** 医生签名为空时填入当前用户默认签名（中文姓名→拼音首字母，如「杨晨」→ yc；可手改为全名） */
function ensureDoctorSignatureFromCurrentUser(form: {
  getFieldValue: (name: string) => unknown;
  setFieldValue: (name: string, value: string) => void;
}) {
  const u = useAuthStore.getState().user;
  const raw = u ? (u.real_name?.trim() || u.username?.trim() || '') : '';
  if (!raw) return;
  const name = defaultSignatureFromUserDisplayName(raw);
  if (!name) return;
  const cur = form.getFieldValue('doctorSignature');
  if (cur == null || String(cur).trim() === '') {
    form.setFieldValue('doctorSignature', name);
  }
}

function scheduleDateKeyLocal(raw: unknown): string {
  if (raw == null || raw === '') return '';
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    const dj = dayjs(t);
    return dj.isValid() ? dj.format('YYYY-MM-DD') : '';
  }
  if (raw instanceof Date) {
    return dayjs(raw).format('YYYY-MM-DD');
  }
  return scheduleDateKeyLocal(String(raw));
}

export default function PrescriptionWorkspacePage() {
  const [form] = Form.useForm();
  const [selectedPatient, setSelectedPatient] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [realPatients, setRealPatients] = useState<Patient[]>([]);
  const [saveSubmitting, setSaveSubmitting] = useState(false);
  const [postSyncMeta, setPostSyncMeta] = useState<PostDialysisSyncPayload | null>(null);
  const [baselineDryWeight, setBaselineDryWeight] = useState<number | null>(null);
  const [siderCollapsed, setSiderCollapsed] = useState(false);
  /** 今日排班侧栏：时段筛选（全部 / 上午 / 下午 / 晚上） */
  const [sidebarScheduleShiftFilter, setSidebarScheduleShiftFilter] = useState<
    'all' | 'morning' | 'afternoon' | 'evening'
  >('all');
  const skipPersistRef = useRef(false);
  const baselineDryWeightRef = useRef<number | null>(null);
  const heparinCoreIURef = useRef(0);
  const ufUserEditedRef = useRef(false);
  const heparinUserEditedRef = useRef(false);
  const ufProgrammaticRef = useRef(false);
  const heparinProgrammaticRef = useRef(false);
  /** 与排班同步的备注，新开方时回传避免被清空 */
  const hemodialysisRemarkRef = useRef<string | null>(null);
  /** 避免快速切换患者或 StrictMode 下异步回填覆盖当前选中患者表单 */
  const prescriptionLoadSeqRef = useRef(0);
  /** 今日排班实例（与 /schedule/today 一致，用于快捷选患者与合并当日透析模式） */
  const [scheduleTodayRows, setScheduleTodayRows] = useState<TodaySchedulePatientRow[]>([]);
  /** 选中患者时 GET /patients/:id 拉取的档案快照（机位等以服务端为准，避免列表缓存滞后） */
  const [patientDetailFromApi, setPatientDetailFromApi] = useState<Patient | null>(null);
  const [dialyzerStocks, setDialyzerStocks] = useState<ConsumableStockRow[]>([]);
  /** 已成功拉取 /devices/consumables：透析器下拉严格跟仓库，不再混入内置 FX 等预设 */
  const [consumablesCatalogSynced, setConsumablesCatalogSynced] = useState(false);
  const lastConsumablesPullMsRef = useRef(0);
  const dialyzerStocksRef = useRef<ConsumableStockRow[]>([]);
  dialyzerStocksRef.current = dialyzerStocks;

  const refreshConsumablesCatalog = useCallback(async () => {
    try {
      const res = await devicesApi.consumables();
      const rows = res.data.data;
      if (Array.isArray(rows)) {
        setDialyzerStocks(rows);
        setConsumablesCatalogSynced(true);
      }
    } catch {
      /* 离线：保留已有缓存；从未同步成功时仍为未同步状态（可走内置预设兜底） */
    }
  }, []);

  const pullConsumablesCatalogOnInteract = useCallback(() => {
    const now = Date.now();
    if (now - lastConsumablesPullMsRef.current < 10_000) return;
    lastConsumablesPullMsRef.current = now;
    void refreshConsumablesCatalog();
  }, [refreshConsumablesCatalog]);

  const frequencyPreset = Form.useWatch('frequencyPreset', form);
  const modeWatched = Form.useWatch('mode', form);
  /** 用于仅在用户切换 HDF/非 HDF 时联动透析液流速，避免首帧覆盖服务端回填 */
  const prevHemoModeRef = useRef<string | undefined>(undefined);
  const hpHeparinExtraIUWatched = Form.useWatch('hpHeparinExtraIU', form);
  const dryWeightWatched = Form.useWatch('dryWeight', form);
  const preMachineWeightWatched = Form.useWatch('preMachineWeight', form);
  const anticoagulantWatched = Form.useWatch('anticoagulant', form);
  const ultrafiltrationWatched = Form.useWatch('ultrafiltrationMl', form);
  const sodiumCurveWatched = Form.useWatch('sodiumCurve', form);
  const preAssessEdemaWatched = Form.useWatch('preAssessEdema', form);
  const preAssessBleedingWatched = Form.useWatch('preAssessBleeding', form);
  const postDialysisSbpW = Form.useWatch('postDialysisSbp', form);
  const postDialysisDbpW = Form.useWatch('postDialysisDbp', form);
  const postDialysisPulseW = Form.useWatch('postDialysisPulse', form);
  const postDialysisWeightW = Form.useWatch('postDialysisWeightKg', form);
  const durationWatched = Form.useWatch('duration', form);
  const shiftWatched = Form.useWatch('shift', form);
  const machineNoWatched = Form.useWatch('machineNo', form);

  const selectedRealPatient = useMemo(
    () => realPatients.find((p) => p.id === selectedPatient),
    [realPatients, selectedPatient],
  );

  const archiveMachineStationDisplay = useMemo(() => {
    const fromApi = patientDetailFromApi?.machine_station?.trim();
    if (fromApi) return fromApi;
    return selectedRealPatient?.machine_station?.trim() ?? '';
  }, [patientDetailFromApi, selectedRealPatient]);

  useEffect(() => {
    if (!isUuid(selectedPatient)) {
      setPatientDetailFromApi(null);
      return;
    }
    setPatientDetailFromApi(null);
    let cancelled = false;
    patientsApi
      .get(selectedPatient)
      .then((res) => {
        const p = res.data.data;
        if (cancelled || !p || typeof p !== 'object') return;
        setPatientDetailFromApi(p);
        setRealPatients((prev) => {
          const idx = prev.findIndex((x) => x.id === p.id);
          if (idx < 0) return prev;
          const next = [...prev];
          next[idx] = { ...next[idx], ...p };
          return next;
        });
      })
      .catch(() => {
        if (!cancelled) setPatientDetailFromApi(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPatient]);

  useEffect(() => {
    prevHemoModeRef.current = undefined;
  }, [selectedPatient]);

  useEffect(() => {
    if (modeWatched === undefined || modeWatched === null) return;
    const cur = String(modeWatched);
    const prev = prevHemoModeRef.current;
    prevHemoModeRef.current = cur;
    if (prev === undefined) return;
    if (cur === 'HDF' && prev !== 'HDF') {
      form.setFieldsValue({ dialysateFlow: DEFAULT_DIALYSATE_FLOW_HDF_ML_MIN });
    } else if (cur !== 'HDF' && prev === 'HDF') {
      form.setFieldsValue({ dialysateFlow: DEFAULT_DIALYSATE_FLOW_HD_ML_MIN });
    }
  }, [modeWatched, form]);

  const naWatched = Form.useWatch('na', form);
  const kWatched = Form.useWatch('k', form);
  const caWatched = Form.useWatch('ca', form);
  const dialyzerWatched = Form.useWatch('dialyzer', form);
  const hpCartridgeWatched = Form.useWatch('hpCartridge', form);
  const preAssessSbpLive = Form.useWatch('preAssessSbp', form);
  const preAssessDbpLive = Form.useWatch('preAssessDbp', form);
  const preAssessPulseLive = Form.useWatch('preAssessPulse', form);
  const preAssessOtherLive = Form.useWatch('preAssessOther', form);
  const bloodFlowWatched = Form.useWatch('bloodFlow', form);
  const dialysateFlowWatched = Form.useWatch('dialysateFlow', form);
  const frequencyCustomWatched = Form.useWatch('frequencyCustom', form);
  const modeOtherWatched = Form.useWatch('modeOther', form);
  const hdfReplacementModeWatched = Form.useWatch('hdfReplacementMode', form);
  const hdfReplacementVolumeLWatched = Form.useWatch('hdfReplacementVolumeL', form);
  const heparinFirstWatched = Form.useWatch('heparinFirst', form);
  const heparinMaintWatched = Form.useWatch('heparinMaint', form);
  const tempWatched = Form.useWatch('temp', form);
  const sodiumCurveCustomWatched = Form.useWatch('sodiumCurveCustom', form);
  const naCurveStartWatched = Form.useWatch('naCurveStart', form);
  const naCurveEndWatched = Form.useWatch('naCurveEnd', form);
  const preAssessEdemaSiteWatched = Form.useWatch('preAssessEdemaSite', form);
  const preAssessBleedingDescWatched = Form.useWatch('preAssessBleedingDesc', form);
  const citrateDetailWatched = Form.useWatch('citrateDetail', form);
  const citrateModeWatched = Form.useWatch('citrateMode', form);
  const citrateTargetPostFilterICaWatched = Form.useWatch('citrateTargetPostFilterICa', form);
  const citrateConcentrationWatched = Form.useWatch('citrateConcentration', form);
  const citrateArterialPumpRateWatched = Form.useWatch('citrateArterialPumpRate', form);
  const citrateVenousPumpRateWatched = Form.useWatch('citrateVenousPumpRate', form);
  const citrateBloodFlowRateWatched = Form.useWatch('citrateBloodFlowRate', form);
  const citrateDialysateFlowRateWatched = Form.useWatch('citrateDialysateFlowRate', form);
  const citrateDialysateCalciumWatched = Form.useWatch('citrateDialysateCalcium', form);
  const citrateCalciumSupplementWatched = Form.useWatch('citrateCalciumSupplement', form);
  const citratePostFilterICaWatched = Form.useWatch('citratePostFilterICa', form);
  const citrateTargetPostFilterICaCustomWatched = Form.useWatch('citrateTargetPostFilterICaCustom', form);
  const citrateMonitorPointsWatched = Form.useWatch('citrateMonitorPoints', form);
  const citrateCoagulationSitesWatched = Form.useWatch('citrateCoagulationSites', form);

  const dialyzerStockById = useMemo(() => {
    const m = new Map<string, ConsumableStockRow>();
    for (const r of dialyzerStocks) {
      m.set(r.id, r);
    }
    return m;
  }, [dialyzerStocks]);

  const membraneStockCount = useMemo(
    () => dialyzerStocks.filter(isDialysisMembraneCatalogRow).length,
    [dialyzerStocks],
  );
  const hemoperfusionStockCount = useMemo(
    () => dialyzerStocks.filter(isHemoperfusionCatalogRow).length,
    [dialyzerStocks],
  );

  const dialyzerOptions = useMemo(() => {
    const base = buildDialyzerSelectOptions(dialyzerStocks, consumablesCatalogSynced);
    const cur = dialyzerWatched;
    if (typeof cur === 'string' && cur.startsWith(LEGACY_DIALYZER_PREFIX)) {
      const exists = base.some((o) => o.value === cur);
      if (!exists) {
        const label = `${cur.slice(LEGACY_DIALYZER_PREFIX.length)}（未关联目录）`;
        return [...base, { value: cur, label }];
      }
    }
    return base;
  }, [dialyzerStocks, dialyzerWatched, consumablesCatalogSynced]);

  const dialyzerSelectPlaceholder = useMemo(() => {
    if (consumablesCatalogSynced && membraneStockCount === 0) {
      return '仓库暂无透析器目录，请在「设备与耗材」维护（透析器/血滤器）';
    }
    return '从耗材目录选择';
  }, [consumablesCatalogSynced, membraneStockCount]);

  const hpCartridgeSelectPlaceholder = useMemo(() => {
    if (consumablesCatalogSynced && hemoperfusionStockCount === 0) {
      return '仓库暂无灌流器目录，请在「设备与耗材」新建并选择品类「灌流器」';
    }
    return '从耗材目录选择灌流器';
  }, [consumablesCatalogSynced, hemoperfusionStockCount]);

  const hpCartridgeOptions = useMemo(() => {
    const base = buildHemoperfusionSelectOptions(dialyzerStocks);
    const cur = hpCartridgeWatched;
    if (typeof cur === 'string' && cur.startsWith(LEGACY_HP_PREFIX)) {
      const exists = base.some((o) => o.value === cur);
      if (!exists) {
        const label = `${cur.slice(LEGACY_HP_PREFIX.length)}（未关联目录）`;
        return [...base, { value: cur, label }];
      }
    }
    return base;
  }, [dialyzerStocks, hpCartridgeWatched]);

  useEffect(() => {
    const cur = form.getFieldValue('dialyzer');
    if (cur == null || cur === '') return;
    const s = String(cur);
    if (isUuid(s)) return;

    if (dialyzerStocks.length === 0) {
      if (!s.startsWith(LEGACY_DIALYZER_PREFIX)) {
        form.setFieldsValue({ dialyzer: `${LEGACY_DIALYZER_PREFIX}${dialyzerStringForForm(s)}` });
      }
      return;
    }

    const modelForResolve = s.startsWith(LEGACY_DIALYZER_PREFIX)
      ? s.slice(LEGACY_DIALYZER_PREFIX.length)
      : s;
    const resolved = resolveDialyzerFormValue(
      { dialyzer_model: modelForResolve, dialyzer_flux: null },
      dialyzerStocks,
    );
    if (resolved !== s) {
      form.setFieldsValue({ dialyzer: resolved });
    }
  }, [dialyzerStocks, form]);

  useEffect(() => {
    const cur = form.getFieldValue('hpCartridge');
    if (cur == null || cur === '') return;
    const s = String(cur);
    if (isUuid(s)) return;

    if (dialyzerStocks.length === 0) {
      if (!s.startsWith(LEGACY_HP_PREFIX)) {
        form.setFieldsValue({ hpCartridge: `${LEGACY_HP_PREFIX}${s.trim()}` });
      }
      return;
    }

    const modelForResolve = s.startsWith(LEGACY_HP_PREFIX) ? s.slice(LEGACY_HP_PREFIX.length) : s;
    const resolved = resolveHpCartridgeFormValue(modelForResolve, dialyzerStocks);
    if (resolved !== s) {
      form.setFieldsValue({ hpCartridge: resolved });
    }
  }, [dialyzerStocks, form]);

  useEffect(() => {
    if (modeWatched !== 'HD_HP' || !isUuid(selectedPatient)) return;
    const cur = form.getFieldValue('hpCartridge');
    if (cur != null && String(cur).trim() !== '') return;
    const pref =
      patientDetailFromApi?.id === selectedPatient
        ? patientDetailFromApi.profile_hemoperfusion_selection
        : undefined;
    if (typeof pref === 'string' && pref.trim()) {
      form.setFieldsValue({ hpCartridge: pref.trim() });
    }
  }, [modeWatched, selectedPatient, patientDetailFromApi, form]);

  const patientInfo = PATIENTS.find((p) => p.value === selectedPatient);

  useEffect(() => {
    patientsApi
      .list({ page: 1, page_size: 300, status: 'active' })
      .then((res) => {
        const list = res.data.data?.list;
        if (Array.isArray(list)) setRealPatients(list);
      })
      .catch(() => {
        /* 演示环境可离线 */
      });
  }, []);

  useEffect(() => {
    void refreshConsumablesCatalog();
  }, [refreshConsumablesCatalog]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshConsumablesCatalog();
    }, 60_000);
    return () => window.clearInterval(id);
  }, [refreshConsumablesCatalog]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') void refreshConsumablesCatalog();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [refreshConsumablesCatalog]);

  useEffect(() => {
    const onCatalogHint = () => {
      void refreshConsumablesCatalog();
    };
    window.addEventListener('hd-consumables-catalog-changed', onCatalogHint);
    return () => window.removeEventListener('hd-consumables-catalog-changed', onCatalogHint);
  }, [refreshConsumablesCatalog]);

  useEffect(() => {
    if (!isUuid(selectedPatient)) return;
    void refreshConsumablesCatalog();
  }, [selectedPatient, refreshConsumablesCatalog]);

  useEffect(() => {
    const load = () => {
      scheduleApi
        .getToday()
        .then((rows) => setScheduleTodayRows(rows))
        .catch(() => setScheduleTodayRows([]));
    };
    load();
    const timer = window.setInterval(load, 120000);
    return () => window.clearInterval(timer);
  }, []);

  const patientSelectOptions = useMemo(() => {
    const real = realPatients.map((p) => ({
      value: p.id,
      label: `${p.name} — ${p.primary_diagnosis ?? ''}（档案）`,
    }));
    const demo = PATIENTS.map((p) => ({
      value: p.value,
      label: `${p.label}（演示）`,
    }));
    return [...real, ...demo];
  }, [realPatients]);

  const prescriptionFormInitialValues = useMemo(() => {
    const demoDefaults = PATIENTS.find((p) => p.value === selectedPatient)?.defaults;
    const dialysisBaseline = {
      sodiumCurve: 'fixed' as const,
      sodiumCurveCustom: '',
      na: DEFAULT_DIALYSATE_NA_MMOL,
      k: DEFAULT_DIALYSATE_K_MMOL,
      ca: DEFAULT_DIALYSATE_CA_MMOL,
      temp: DEFAULT_DIALYSATE_TEMP_C,
      naCurveStart: DEFAULT_DIALYSATE_NA_MMOL,
      naCurveEnd: DEFAULT_DIALYSATE_NA_MMOL,
      naCurveTimeStart: '',
      naCurveTimeEnd: '',
      hpCartridge: '',
    };
    return {
      preAssessEdema: 'no' as const,
      preAssessBleeding: 'no' as const,
      ...dialysisBaseline,
      ...(demoDefaults ?? {}),
    };
  }, [selectedPatient]);

  const sidebarShiftTabCounts = useMemo(() => {
    let morning = 0;
    let afternoon = 0;
    let evening = 0;
    for (const r of scheduleTodayRows) {
      const k = normalizeScheduleShiftKey(r.shift);
      if (k === 'morning') morning += 1;
      else if (k === 'afternoon') afternoon += 1;
      else if (k === 'evening') evening += 1;
    }
    return { morning, afternoon, evening };
  }, [scheduleTodayRows]);

  const scheduleTodayRowsForSidebar = useMemo(() => {
    if (sidebarScheduleShiftFilter === 'all') return scheduleTodayRows;
    return scheduleTodayRows.filter(
      (r) => normalizeScheduleShiftKey(r.shift) === sidebarScheduleShiftFilter,
    );
  }, [scheduleTodayRows, sidebarScheduleShiftFilter]);

  /** 与透析工作台侧栏「今日上机名单」相同：先班次、再分区（受时段筛选影响） */
  const scheduleTodayGroupedForSidebar = useMemo(
    () => groupTodayScheduleRowsByShiftThenZone(scheduleTodayRowsForSidebar),
    [scheduleTodayRowsForSidebar],
  );

  /** 保存确认弹窗展示用（演示患者 / 档案列表 / 今日排班） */
  const confirmPatientDisplayName = useMemo(() => {
    const demo = PATIENTS.find((p) => p.value === selectedPatient);
    if (demo) return demo.label.split(' — ')[0]?.trim() || '演示患者';
    const rp = realPatients.find((p) => p.id === selectedPatient);
    if (rp?.name) return rp.name.trim();
    const sched = scheduleTodayRows.find((r) => r.patient_id === selectedPatient);
    if (sched?.patient_name != null && String(sched.patient_name).trim()) {
      return String(sched.patient_name).trim();
    }
    return '当前患者';
  }, [selectedPatient, realPatients, scheduleTodayRows]);

  const frequencyLabel = frequencyPresetLabel(frequencyPreset, frequencyCustomWatched as string | undefined);
  const modeDisplay = dialysisModeLabel(modeWatched, modeOtherWatched as string | undefined);
  const sodiumCurveLine = useMemo(
    () =>
      formatSodiumCurveSummary({
        sodiumCurve: sodiumCurveWatched,
        sodiumCurveCustom: sodiumCurveCustomWatched,
        naCurveStart: naCurveStartWatched,
        naCurveEnd: naCurveEndWatched,
      }),
    [sodiumCurveWatched, sodiumCurveCustomWatched, naCurveStartWatched, naCurveEndWatched],
  );
  const edemaSummaryDisplay = useMemo(() => {
    if (preAssessEdemaWatched === 'yes') {
      const site = String(preAssessEdemaSiteWatched ?? '').trim();
      return site ? `有 · ${site}` : '有';
    }
    return yesNoAssessLabel(preAssessEdemaWatched);
  }, [preAssessEdemaWatched, preAssessEdemaSiteWatched]);
  const bleedingSummaryDisplay = useMemo(() => {
    if (preAssessBleedingWatched === 'yes') {
      const desc = String(preAssessBleedingDescWatched ?? '').trim();
      return desc ? `有 · ${desc}` : '有';
    }
    return yesNoAssessLabel(preAssessBleedingWatched);
  }, [preAssessBleedingWatched, preAssessBleedingDescWatched]);
  const preAssessOtherDisplay = useMemo(() => {
    const t = String(preAssessOtherLive ?? '').trim();
    return t || '—';
  }, [preAssessOtherLive]);
  const postDialysisLockedByNurse = postSyncMeta?.filledBy === 'nurse';

  /** 与下方「处方编辑」超滤量 (mL) 同源：优先表单值，缺省用与自动计算一致的公式 */
  const rxUfDialysisPreview =
    typeof ultrafiltrationWatched === 'number' && Number.isFinite(ultrafiltrationWatched)
      ? Math.round(ultrafiltrationWatched)
      : computeUltrafiltrationMl(preMachineWeightWatched, dryWeightWatched, modeWatched);
  const ufRateDialysisPreview =
    rxUfDialysisPreview !== null && typeof durationWatched === 'number' && durationWatched > 0
      ? (rxUfDialysisPreview / durationWatched).toFixed(0)
      : null;
  const ufPercentDialysis =
    rxUfDialysisPreview !== null && typeof dryWeightWatched === 'number' && dryWeightWatched > 0
      ? ((rxUfDialysisPreview / (dryWeightWatched * 1000)) * 100).toFixed(1)
      : null;
  const ufAlertDialysis = ufPercentDialysis ? parseFloat(ufPercentDialysis) > 5 : false;

  /** 处方超滤率按干体重折算：mL·h⁻¹·kg⁻¹ */
  const ufPerHrPerDryKgPreview =
    rxUfDialysisPreview !== null &&
    typeof durationWatched === 'number' &&
    durationWatched > 0 &&
    typeof dryWeightWatched === 'number' &&
    dryWeightWatched > 0
      ? ((rxUfDialysisPreview / durationWatched) / dryWeightWatched).toFixed(2)
      : null;

  const anticoagulantLabel =
    ANTICOAGULANT_OPTIONS.find((o) => o.value === anticoagulantWatched)?.label ?? '—';
  const citrateDetailDisplay = useMemo(() => {
    if (anticoagulantWatched !== 'citrate') return '—';
    const summary = buildCitrateDetailSummary({
      anticoagulant: anticoagulantWatched,
      citrateMode: citrateModeWatched,
      citrateConcentration: citrateConcentrationWatched,
      citrateArterialPumpRate: citrateArterialPumpRateWatched,
      citrateVenousPumpRate: citrateVenousPumpRateWatched,
      citrateBloodFlowRate: citrateBloodFlowRateWatched,
      citrateDialysateFlowRate: citrateDialysateFlowRateWatched,
      citrateDialysateCalcium: citrateDialysateCalciumWatched,
      citrateCalciumSupplement: citrateCalciumSupplementWatched,
      citratePostFilterICa: citratePostFilterICaWatched,
      citrateTargetPostFilterICa: citrateTargetPostFilterICaWatched,
      citrateTargetPostFilterICaCustom: citrateTargetPostFilterICaCustomWatched,
      citrateMonitorPoints: citrateMonitorPointsWatched,
      citrateCoagulationSites: citrateCoagulationSitesWatched,
    });
    return summary || String(citrateDetailWatched || '—');
  }, [
    anticoagulantWatched,
    citrateDetailWatched,
    citrateModeWatched,
    citrateTargetPostFilterICaWatched,
    citrateConcentrationWatched,
    citrateArterialPumpRateWatched,
    citrateVenousPumpRateWatched,
    citrateBloodFlowRateWatched,
    citrateDialysateFlowRateWatched,
    citrateDialysateCalciumWatched,
    citrateCalciumSupplementWatched,
    citratePostFilterICaWatched,
    citrateTargetPostFilterICaCustomWatched,
    citrateMonitorPointsWatched,
    citrateCoagulationSitesWatched,
  ]);
  const dialyzerShort = dialyzerDisplayShort(
    typeof dialyzerWatched === 'string' ? dialyzerWatched : undefined,
    dialyzerStockById,
  );
  const hpCartridgeShort = hpCartridgeDisplayShort(
    typeof hpCartridgeWatched === 'string' ? hpCartridgeWatched : undefined,
    dialyzerStockById,
  );

  const applyPatientFormValues = useCallback(
    (patientValue: string) => {
      const base = PATIENTS.find((p) => p.value === patientValue)?.defaults;
      if (!base) return;
      hemodialysisRemarkRef.current = null;
      const stored = loadStoredBasicParams(patientValue);
      const nextBaseline =
        typeof base.dryWeight === 'number' ? base.dryWeight : null;
      baselineDryWeightRef.current = nextBaseline;
      setBaselineDryWeight(nextBaseline);
      heparinCoreIURef.current = typeof base.heparinFirst === 'number' ? base.heparinFirst : 0;
      ufUserEditedRef.current = false;
      heparinUserEditedRef.current = false;
      skipPersistRef.current = true;
      form.resetFields();
      form.setFieldsValue({
        ...base,
        ...stored,
      });
      const postSync = readPostDialysisSync(patientValue);
      if (postSync) {
        form.setFieldsValue({
          postDialysisSbp: postSync.postSbp ?? undefined,
          postDialysisDbp: postSync.postDbp ?? undefined,
          postDialysisPulse: postSync.postPulse ?? undefined,
          postDialysisWeightKg: postSync.postWeightKg ?? undefined,
        });
      }
      ensureDoctorSignatureFromCurrentUser(form);
      window.setTimeout(() => {
        skipPersistRef.current = false;
      }, 0);
    },
    [form]
  );

  useEffect(() => {
    if (!selectedPatient) return;
    if (!isUuid(selectedPatient)) {
      queueMicrotask(() => {
        applyPatientFormValues(selectedPatient);
      });
      return;
    }

    skipPersistRef.current = true;
    const loadSeq = ++prescriptionLoadSeqRef.current;
    (async () => {
      try {
        const todayList = await scheduleApi.getToday();
        if (loadSeq !== prescriptionLoadSeqRef.current) return;
        setScheduleTodayRows(todayList);

        let profilePat: PatientDetailRecord | null = null;
        try {
          const pr = await patientsApi.get(selectedPatient);
          if (pr.data.code === 200 && pr.data.data) profilePat = pr.data.data;
        } catch {
          /* 档案失败仍可加载处方 */
        }

        const res = await prescriptionsApi.getCurrent(selectedPatient);
        if (loadSeq !== prescriptionLoadSeqRef.current) return;
        const rx = res.data.data;
        form.resetFields();
        const todayStr = dayjs().format('YYYY-MM-DD');
        const todayRowForPatient = todayList.find((r) => {
          const d = scheduleDateKeyLocal(r.scheduled_date);
          return r.patient_id === selectedPatient && d === todayStr;
        });

        if (rx) {
          const mappedRaw = mapCurrentPrescriptionToFormValues(rx, dialyzerStocksRef.current);
          if (profilePat) {
            const hmRx = hemoModalityFromApi(rx.hemodialysis_modality);
            const dEmpty =
              !mappedRaw.dialyzer ||
              (typeof mappedRaw.dialyzer === 'string' && mappedRaw.dialyzer.trim() === '');
            if (dEmpty && profilePat.profile_dialyzer_selection) {
              mappedRaw.dialyzer = profilePat.profile_dialyzer_selection;
            }
            const hpEmpty =
              !mappedRaw.hpCartridge ||
              (typeof mappedRaw.hpCartridge === 'string' && mappedRaw.hpCartridge.trim() === '');
            if (hmRx.mode === 'HD_HP' && hpEmpty && profilePat.profile_hemoperfusion_selection) {
              mappedRaw.hpCartridge = profilePat.profile_hemoperfusion_selection;
            }
          }
          const { form: mapped, ultrafiltrationManualFromLoad } = enrichMappedPrescriptionForm(
            mappedRaw,
            selectedPatient,
          );
          const hemo = hemoModalityFromApi(rx.hemodialysis_modality);
          const coreMode = hemo.mode === 'other' ? 'HD' : hemo.mode;
          hemodialysisRemarkRef.current =
            typeof mapped.hemodialysisRemark === 'string' && mapped.hemodialysisRemark.trim()
              ? mapped.hemodialysisRemark.trim()
              : null;
          baselineDryWeightRef.current =
            rx.dry_weight != null && Number.isFinite(Number(rx.dry_weight)) ? Number(rx.dry_weight) : null;
          setBaselineDryWeight(baselineDryWeightRef.current);
          ufUserEditedRef.current = ultrafiltrationManualFromLoad;
          heparinUserEditedRef.current = false;
          heparinCoreIURef.current = applyHeparinCoreFromLoadedRx(
            coreMode,
            mapped.anticoagulant as string | undefined,
            mapped.heparinFirst as number | undefined,
            mapped.hpHeparinExtraIU as number | undefined,
          );
          mergeShiftFromPatientProfileIntoFormValues(mapped, profilePat);
          form.setFieldsValue(mapped);
        } else {
          hemodialysisRemarkRef.current = null;
          const stored = loadStoredBasicParams(selectedPatient);
          baselineDryWeightRef.current = null;
          setBaselineDryWeight(null);
          let fromProfile: {
            anticoagulant?: string;
            heparinFirst?: number;
            heparinMaint?: number;
            dryWeight?: number;
            dryWeightChangeReason?: string;
          } = {};
          if (profilePat) {
            const pat = profilePat;
            fromProfile = {
              anticoagulant: mapDbAnticoagulantToForm(pat.profile_anticoagulant ?? undefined),
              heparinFirst: pat.profile_heparin_prime_dose ?? undefined,
              heparinMaint:
                pat.profile_heparin_maintain != null ? Number(pat.profile_heparin_maintain) : undefined,
              dryWeight: pat.profile_dry_weight != null ? Number(pat.profile_dry_weight) : undefined,
              dryWeightChangeReason: pat.profile_dry_weight_reason ?? '',
            };
            if (pat.profile_dry_weight != null && Number.isFinite(Number(pat.profile_dry_weight))) {
              const b = Number(pat.profile_dry_weight);
              baselineDryWeightRef.current = b;
              setBaselineDryWeight(b);
            }
          }
          const coreMode = 'HD';
          heparinUserEditedRef.current = false;
          heparinCoreIURef.current = applyHeparinCoreFromLoadedRx(
            coreMode,
            fromProfile.anticoagulant,
            fromProfile.heparinFirst,
            500,
          );
          const freshValues: Record<string, unknown> = {
            frequencyPreset: 'weekly_3',
            frequencyCustom: '',
            duration: 4,
            mode: 'HD',
            modeOther: '',
            sodiumCurve: 'fixed',
            sodiumCurveCustom: '',
            na: DEFAULT_DIALYSATE_NA_MMOL,
            k: DEFAULT_DIALYSATE_K_MMOL,
            ca: DEFAULT_DIALYSATE_CA_MMOL,
            temp: DEFAULT_DIALYSATE_TEMP_C,
            naCurveStart: DEFAULT_DIALYSATE_NA_MMOL,
            naCurveEnd: DEFAULT_DIALYSATE_NA_MMOL,
            naCurveTimeStart: '',
            naCurveTimeEnd: '',
            bloodFlow: DEFAULT_BLOOD_FLOW_ML_MIN,
            dialysateFlow: DEFAULT_DIALYSATE_FLOW_HD_ML_MIN,
            preAssessEdema: 'no',
            preAssessBleeding: 'no',
            preAssessEdemaSite: '',
            preAssessBleedingDesc: '',
            hpCartridge: '',
            ...stored,
            ...fromProfile,
            ...(profilePat?.profile_dialyzer_selection
              ? { dialyzer: profilePat.profile_dialyzer_selection }
              : {}),
            ...(profilePat?.profile_hemoperfusion_selection
              ? { hpCartridge: profilePat.profile_hemoperfusion_selection }
              : {}),
          };
          mergeShiftFromPatientProfileIntoFormValues(freshValues, profilePat);
          form.setFieldsValue(freshValues);
        }

        if (todayRowForPatient) {
          const hm = hemoModalityFromApi(todayRowForPatient.session_dialysis_mode as string | undefined);
          form.setFieldsValue({ mode: hm.mode, modeOther: hm.modeOther });
          if (hm.mode === 'HDF') {
            form.setFieldsValue({ dialysateFlow: DEFAULT_DIALYSATE_FLOW_HDF_ML_MIN });
          }
          if (todayRowForPatient.schedule_remark != null && String(todayRowForPatient.schedule_remark).trim()) {
            const t = String(todayRowForPatient.schedule_remark).trim();
            hemodialysisRemarkRef.current = t;
            form.setFieldsValue({ hemodialysisRemark: t });
          }
        }

        const postSync = readPostDialysisSync(selectedPatient);
        if (postSync) {
          form.setFieldsValue({
            postDialysisSbp: postSync.postSbp ?? undefined,
            postDialysisDbp: postSync.postDbp ?? undefined,
            postDialysisPulse: postSync.postPulse ?? undefined,
            postDialysisWeightKg: postSync.postWeightKg ?? undefined,
          });
        }
      } catch {
        hemodialysisRemarkRef.current = null;
      } finally {
        ensureDoctorSignatureFromCurrentUser(form);
        window.setTimeout(() => {
          skipPersistRef.current = false;
        }, 0);
      }
    })();
    return () => {
      prescriptionLoadSeqRef.current += 1;
    };
  }, [selectedPatient, applyPatientFormValues, form]);

  useEffect(() => {
    const onScheduleSynced = (ev: Event) => {
      const detail = (ev as CustomEvent<{ patientId?: string; scheduledDate?: string | null }>).detail;
      const pid = detail?.patientId;
      const scheduledDate = detail?.scheduledDate;
      const todayStr = dayjs().format('YYYY-MM-DD');
      if (
        scheduledDate != null &&
        scheduledDate !== '' &&
        scheduleDateKeyLocal(scheduledDate) !== todayStr
      ) {
        return;
      }
      if (!pid || pid !== selectedPatient || !isUuid(selectedPatient)) return;
      skipPersistRef.current = true;
      Promise.all([prescriptionsApi.getCurrent(pid), scheduleApi.getToday()])
        .then(([rxRes, todayRows]) => {
          setScheduleTodayRows(todayRows);
          const rx = rxRes.data.data;
          const row = todayRows.find((r) => {
            const d = scheduleDateKeyLocal(r.scheduled_date);
            return r.patient_id === pid && d === todayStr;
          });
          if (row) {
            const hm = hemoModalityFromApi(row.session_dialysis_mode as string | undefined);
            form.setFieldsValue({
              mode: hm.mode,
              modeOther: hm.modeOther,
            });
            if (row.schedule_remark != null && String(row.schedule_remark).trim()) {
              const t = String(row.schedule_remark).trim();
              hemodialysisRemarkRef.current = t;
              form.setFieldsValue({ hemodialysisRemark: t });
            }
            return;
          }
          if (!rx) return;
          const remarkFromRx =
            rx.hemodialysis_remark != null && String(rx.hemodialysis_remark).trim()
              ? String(rx.hemodialysis_remark).trim()
              : '';
          hemodialysisRemarkRef.current = remarkFromRx || null;
          const hemo = hemoModalityFromApi(rx.hemodialysis_modality);
          form.setFieldsValue({
            mode: hemo.mode,
            modeOther: hemo.modeOther,
            hemodialysisRemark: remarkFromRx,
          });
        })
        .finally(() => {
          ensureDoctorSignatureFromCurrentUser(form);
          window.setTimeout(() => {
            skipPersistRef.current = false;
          }, 0);
        });
    };
    window.addEventListener('hd-hemodialysis-modality-synced', onScheduleSynced);
    return () => window.removeEventListener('hd-hemodialysis-modality-synced', onScheduleSynced);
  }, [selectedPatient, form]);

  useEffect(() => {
    const refresh = () => {
      if (!selectedPatient) {
        setPostSyncMeta(null);
        return;
      }
      setPostSyncMeta(readPostDialysisSync(selectedPatient));
    };
    refresh();
    window.addEventListener('storage', refresh);
    window.addEventListener(POST_DIALYSIS_SYNC_EVENT, refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener(POST_DIALYSIS_SYNC_EVENT, refresh);
    };
  }, [selectedPatient]);

  useEffect(() => {
    if (!selectedPatient || skipPersistRef.current) return;
    const existing = readPostDialysisSync(selectedPatient);
    if (existing?.filledBy === 'nurse') return;
    const hasAny =
      postDialysisSbpW != null ||
      postDialysisDbpW != null ||
      postDialysisPulseW != null ||
      postDialysisWeightW != null;
    if (!hasAny) return;
    const t = window.setTimeout(() => {
      if (readPostDialysisSync(selectedPatient)?.filledBy === 'nurse') return;
      writePostDialysisSync({
        patientId: selectedPatient,
        postSbp: postDialysisSbpW ?? null,
        postDbp: postDialysisDbpW ?? null,
        postPulse: postDialysisPulseW ?? null,
        postWeightKg: postDialysisWeightW ?? null,
        filledBy: 'doctor',
        updatedAt: new Date().toISOString(),
      });
      setPostSyncMeta(readPostDialysisSync(selectedPatient));
    }, 450);
    return () => window.clearTimeout(t);
  }, [
    selectedPatient,
    postDialysisSbpW,
    postDialysisDbpW,
    postDialysisPulseW,
    postDialysisWeightW,
  ]);

  useEffect(() => {
    if (skipPersistRef.current) return;
    ufUserEditedRef.current = false;
  }, [dryWeightWatched, preMachineWeightWatched, modeWatched]);

  useEffect(() => {
    if (skipPersistRef.current) return;
    if (ufUserEditedRef.current) return;
    const u = computeUltrafiltrationMl(preMachineWeightWatched, dryWeightWatched, modeWatched);
    if (u == null) return;
    ufProgrammaticRef.current = true;
    form.setFieldValue('ultrafiltrationMl', u);
    window.setTimeout(() => {
      ufProgrammaticRef.current = false;
    }, 0);
  }, [dryWeightWatched, preMachineWeightWatched, modeWatched, form]);

  useEffect(() => {
    heparinUserEditedRef.current = false;
  }, [modeWatched, anticoagulantWatched, hpHeparinExtraIUWatched]);

  useEffect(() => {
    if (skipPersistRef.current) return;
    if (modeWatched === 'HD_HP' && hpHeparinExtraIUWatched == null) {
      form.setFieldValue('hpHeparinExtraIU', 500);
    }
  }, [modeWatched, hpHeparinExtraIUWatched, form]);

  useEffect(() => {
    if (skipPersistRef.current) return;
    if (modeWatched === 'HDF') return;
    form.setFieldsValue({ hdfReplacementMode: undefined, hdfReplacementVolumeL: undefined });
  }, [modeWatched, form]);

  useEffect(() => {
    if (anticoagulantWatched !== 'citrate') return;
    const current = form.getFieldsValue([
      'citrateMode',
      'citrateConcentration',
      'citrateBloodFlowRate',
      'citrateDialysateFlowRate',
      'citrateDialysateCalcium',
      'citrateCalciumSupplement',
      'citrateTargetPostFilterICa',
      'citrateMonitorPoints',
      'citrateCoagulationSites',
    ]);
    const defaults: Record<string, unknown> = {};
    if (!current.citrateMode) defaults.citrateMode = 'two_stage';
    if (current.citrateConcentration == null) defaults.citrateConcentration = 4;
    if (current.citrateBloodFlowRate == null && bloodFlowWatched != null) defaults.citrateBloodFlowRate = bloodFlowWatched;
    if (current.citrateDialysateFlowRate == null && dialysateFlowWatched != null) defaults.citrateDialysateFlowRate = dialysateFlowWatched;
    if (current.citrateDialysateCalcium == null) defaults.citrateDialysateCalcium = 1.5;
    if (!current.citrateCalciumSupplement) defaults.citrateCalciumSupplement = 'no';
    if (!current.citrateTargetPostFilterICa) defaults.citrateTargetPostFilterICa = '0.25-0.35';
    if (!Array.isArray(current.citrateMonitorPoints) || current.citrateMonitorPoints.length === 0) {
      defaults.citrateMonitorPoints = ['pre', '2h', 'end'];
    }
    if (!Array.isArray(current.citrateCoagulationSites) || current.citrateCoagulationSites.length === 0) {
      defaults.citrateCoagulationSites = ['dialyzer', 'venous_chamber'];
    }
    if (Object.keys(defaults).length > 0) form.setFieldsValue(defaults);
  }, [anticoagulantWatched, bloodFlowWatched, dialysateFlowWatched, form]);

  useEffect(() => {
    if (heparinUserEditedRef.current) return;
    const v = computeLmwhFamilyFirstDoseIU(
      heparinCoreIURef.current,
      modeWatched,
      anticoagulantWatched,
      hpHeparinExtraIUWatched,
    );
    heparinProgrammaticRef.current = true;
    form.setFieldValue('heparinFirst', v);
    window.setTimeout(() => {
      heparinProgrammaticRef.current = false;
    }, 0);
  }, [modeWatched, anticoagulantWatched, hpHeparinExtraIUWatched, form]);

  const persistBasicParamsFromForm = useCallback(() => {
    if (skipPersistRef.current) return;
    const all = form.getFieldsValue() as Record<string, unknown>;
    const subset = pickBasicParams(all);
    savePrescriptionBasicParamsToStorage(selectedPatient, subset);
  }, [form, selectedPatient]);

  const handleSave = async () => {
    if (!selectedPatient) {
      message.warning('请先选择患者');
      return;
    }
    try {
      await form.validateFields();
      setShowConfirm(true);
    } catch {
      /* 表单校验未通过 */
    }
  };

  const handleConfirm = async () => {
    persistBasicParamsFromForm();
    if (!isUuid(selectedPatient)) {
      setShowConfirm(false);
      message.success('透析处方已保存（演示数据），护士下次录入时将自动带入');
      return;
    }

    setSaveSubmitting(true);
    try {
      const v = await form.validateFields();
      const antKey = String(v.anticoagulant ?? 'heparin');
      const checkRes = await prescriptionsApi.checkMedication({
        patientId: selectedPatient,
        anticoagulantKey: antKey,
      });
      const issues = checkRes.data.data?.issues ?? [];
      const blocks = issues.filter((i) => i.severity === 'block');
      const warns = issues.filter((i) => i.severity === 'warn');

      if (blocks.length > 0) {
        Modal.error({
          title: '用药规则阻断',
          content: (
            <div>
              {blocks.map((b) => (
                <p key={b.rule_id}>{b.message}</p>
              ))}
              <p style={{ marginTop: 8, color: '#64748B', fontSize: 12 }}>请调整处方或医嘱后重试。</p>
            </div>
          ),
        });
        setShowConfirm(false);
        return;
      }

      const runSave = async () => {
        const dryW = Number(v.dryWeight);
        const dateStr = dayjs().format('YYYY-MM-DD');
        const dryReason =
          typeof v.dryWeightChangeReason === 'string' && v.dryWeightChangeReason.trim()
            ? v.dryWeightChangeReason.trim()
            : undefined;
        const rawFormValues = v as Record<string, unknown>;
        const citrateDetail = buildCitrateDetailSummary(rawFormValues);
        const formExtraPayload = pickBasicParams({
          ...rawFormValues,
          citrateDetail,
        });
        const dialyzerParsed = parseDialyzerFormSelection(
          typeof v.dialyzer === 'string' ? v.dialyzer : undefined,
          dialyzerStockById,
        );
        const saveResp = await prescriptionsApi.create(selectedPatient, {
          frequency_per_week: frequencyPresetToPerWeek(v.frequencyPreset as string | undefined),
          duration_hours: Number(v.duration) || 4,
          dialyzer_model: dialyzerParsed.dialyzer_model,
          ...(dialyzerParsed.dialyzer_flux ? { dialyzer_flux: dialyzerParsed.dialyzer_flux } : {}),
          blood_flow_rate: Number(v.bloodFlow) || DEFAULT_BLOOD_FLOW_ML_MIN,
          dialysate_flow_rate:
            Number(v.dialysateFlow) || defaultDialysateFlowForMode(v.mode as string | undefined),
          anticoagulant: mapFormAnticoagulantToDb(antKey),
          heparin_prime_dose: v.heparinFirst != null ? Number(v.heparinFirst) : undefined,
          heparin_maintain: v.heparinMaint != null ? Number(v.heparinMaint) : undefined,
          dry_weight: dryW,
          dry_weight_date: dateStr,
          dry_weight_reason: dryReason,
          dialysate_na: v.na != null ? Number(v.na) : DEFAULT_DIALYSATE_NA_MMOL,
          dialysate_ca: v.ca != null ? Number(v.ca) : DEFAULT_DIALYSATE_CA_MMOL,
          dialysate_k: v.k != null ? Number(v.k) : DEFAULT_DIALYSATE_K_MMOL,
          dialysate_temp: v.temp != null ? Number(v.temp) : DEFAULT_DIALYSATE_TEMP_C,
          notes: mergePrescriptionNotesForDb(
            typeof v.preAssessOther === 'string' ? v.preAssessOther : undefined,
            typeof v.notes === 'string' ? v.notes : undefined,
          ),
          hemodialysis_modality: mapFormModeToHemodialysisModality(
            v.mode as string | undefined,
            v.modeOther as string | undefined,
          ),
          hemodialysis_remark: (() => {
            const fromForm =
              typeof v.hemodialysisRemark === 'string' ? v.hemodialysisRemark.trim() : '';
            if (fromForm) return fromForm;
            const fromRef = hemodialysisRemarkRef.current?.trim();
            return fromRef || null;
          })(),
          hdf_replacement_mode:
            v.mode === 'HDF' && typeof v.hdfReplacementMode === 'string' ? v.hdfReplacementMode : undefined,
          hdf_replacement_volume_l:
            v.mode === 'HDF' && v.hdfReplacementVolumeL != null ? Number(v.hdfReplacementVolumeL) : undefined,
          form_extra: formExtraPayload,
          dialyzer_form_selection: typeof v.dialyzer === 'string' ? v.dialyzer : undefined,
          hp_cartridge_form_selection:
            v.mode === 'HD_HP' && typeof v.hpCartridge === 'string' ? v.hpCartridge : undefined,
        });
        const newRx = saveResp.data.data;
        savePrescriptionBasicParamsToStorage(selectedPatient, formExtraPayload);
        setShowConfirm(false);

        if (newRx) {
          try {
            skipPersistRef.current = true;
            const mappedRaw = mapCurrentPrescriptionToFormValues(newRx as PrescriptionRecord, dialyzerStocksRef.current);
            const { form: mapped, ultrafiltrationManualFromLoad } = enrichMappedPrescriptionForm(
              mappedRaw,
              selectedPatient,
            );
            const hemoLoaded = hemoModalityFromApi(newRx.hemodialysis_modality);
            const coreModeLoaded = hemoLoaded.mode === 'other' ? 'HD' : hemoLoaded.mode;
            hemodialysisRemarkRef.current =
              typeof mapped.hemodialysisRemark === 'string' && mapped.hemodialysisRemark.trim()
                ? mapped.hemodialysisRemark.trim()
                : null;
            baselineDryWeightRef.current =
              newRx.dry_weight != null && Number.isFinite(Number(newRx.dry_weight))
                ? Number(newRx.dry_weight)
                : null;
            setBaselineDryWeight(baselineDryWeightRef.current);
            ufUserEditedRef.current = ultrafiltrationManualFromLoad;
            heparinUserEditedRef.current = false;
            heparinCoreIURef.current = applyHeparinCoreFromLoadedRx(
              coreModeLoaded,
              mapped.anticoagulant as string | undefined,
              mapped.heparinFirst as number | undefined,
              mapped.hpHeparinExtraIU as number | undefined,
            );
            mergeShiftFromPatientProfileIntoFormValues(
              mapped,
              patientDetailFromApi?.id === selectedPatient ? patientDetailFromApi : null,
            );
            form.setFieldsValue(mapped);
            const todayStr = dayjs().format('YYYY-MM-DD');
            const todayRowForPatient = scheduleTodayRows.find((r) => {
              const d = scheduleDateKeyLocal(r.scheduled_date);
              return r.patient_id === selectedPatient && d === todayStr;
            });
            if (todayRowForPatient) {
              const hm = hemoModalityFromApi(todayRowForPatient.session_dialysis_mode as string | undefined);
              form.setFieldsValue({ mode: hm.mode, modeOther: hm.modeOther });
              if (hm.mode === 'HDF') {
                form.setFieldsValue({ dialysateFlow: DEFAULT_DIALYSATE_FLOW_HDF_ML_MIN });
              }
              if (todayRowForPatient.schedule_remark != null && String(todayRowForPatient.schedule_remark).trim()) {
                const t = String(todayRowForPatient.schedule_remark).trim();
                hemodialysisRemarkRef.current = t;
                form.setFieldsValue({ hemodialysisRemark: t });
              }
            }
            const postSync = readPostDialysisSync(selectedPatient);
            if (postSync) {
              form.setFieldsValue({
                postDialysisSbp: postSync.postSbp ?? undefined,
                postDialysisDbp: postSync.postDbp ?? undefined,
                postDialysisPulse: postSync.postPulse ?? undefined,
                postDialysisWeightKg: postSync.postWeightKg ?? undefined,
              });
            }
            ensureDoctorSignatureFromCurrentUser(form);
            window.setTimeout(() => {
              skipPersistRef.current = false;
            }, 0);
          } catch (syncErr) {
            console.error(syncErr);
            message.warning('处方已保存，本地表单回填异常，请重新选择患者或刷新页面');
            skipPersistRef.current = false;
          }
        }

        message.success('透析处方已保存，护士下次录入时将自动带入');
        window.dispatchEvent(
          new CustomEvent(HD_PRESCRIPTION_SAVED_EVENT, {
            detail: { patientId: selectedPatient, savedAt: new Date().toISOString() },
          }),
        );
      };

      if (warns.length > 0) {
        setShowConfirm(false);
        Modal.confirm({
          title: '用药风险提示',
          content: (
            <div>
              {warns.map((w) => (
                <p key={w.rule_id}>{w.message}</p>
              ))}
            </div>
          ),
          okText: '仍要保存',
          cancelText: '返回修改',
          onOk: async () => {
            try {
              await runSave();
            } catch (we) {
              const wm =
                we && typeof we === 'object' && 'message' in we
                  ? String((we as { message?: string }).message)
                  : '保存失败';
              message.error(wm);
              throw we;
            }
          },
        });
        return;
      }

      await runSave();
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message?: string }).message) : '保存失败';
      message.error(msg);
    } finally {
      setSaveSubmitting(false);
    }
  };

  const handlePrintPrescription = () => {
    const values = form.getFieldsValue();
    const patientName = confirmPatientDisplayName;
    const gender = selectedRealPatient?.gender === 'F' ? '女' : selectedRealPatient?.gender === 'M' ? '男' : '—';
    const mode = dialysisModeLabel(values.mode as string, values.modeOther as string | undefined);
    const uf = values.ultrafiltrationMl != null ? `${values.ultrafiltrationMl} mL` : '—';
    const anticoagulant = ANTICOAGULANT_OPTIONS.find((o) => o.value === values.anticoagulant)?.label || '—';
    const anticoagulantDose =
      values.anticoagulant === 'citrate'
        ? buildCitrateDetailSummary(values)
        : `首剂 ${values.heparinFirst ?? '—'} IU；追加 ${values.heparinMaint ?? '—'} IU/h`;
    const sodiumCurve = formatSodiumCurveSummary({
      sodiumCurve: values.sodiumCurve,
      sodiumCurveCustom: values.sodiumCurveCustom,
      naCurveStart: values.naCurveStart,
      naCurveEnd: values.naCurveEnd,
    });
    const notes = typeof values.notes === 'string' && values.notes.trim() ? values.notes.trim() : '—';
    const html = `<html><head><meta charset="utf-8"><title>透析处方打印</title></head><body style="font-family:Arial,'Microsoft YaHei',sans-serif;padding:16px;"><h3>透析处方摘要</h3><p>姓名：${escapeHtml(patientName)}</p><p>性别：${escapeHtml(gender)}</p><p>透析模式：${escapeHtml(mode)}</p><p>超滤量：${escapeHtml(uf)}</p><p>抗凝方案及用量：${escapeHtml(anticoagulant)}；${escapeHtml(anticoagulantDose)}</p><p>可调钠曲线：${escapeHtml(sodiumCurve || '—')}</p><p>处方备注：${escapeHtml(notes)}</p></body></html>`;
    const w = window.open('', '_blank', 'width=840,height=700');
    if (!w) {
      message.error('无法打开打印窗口，请检查浏览器弹窗拦截');
      return;
    }
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
  };

  return (
    <PageShell fullWidth>
      <div className="hd-page-intro">
        <div>
          <div className="hd-page-intro__eyebrow">Prescription Workspace</div>
          <div className="hd-page-intro__title">透析处方工作台</div>
        </div>
        <div className="hd-page-intro__chips">
          <span className="hd-page-intro__chip">{dayjs().format('YYYY年MM月DD日 dddd')}</span>
          <span className="hd-page-intro__chip">{selectedPatient ? '已选患者' : '待选择患者'}</span>
          <span className="hd-page-intro__chip">今日排班 {scheduleTodayRows.length} 人</span>
        </div>
      </div>

      <div className="hd-filter-bar">
        <div className="hd-filter-bar__left">
          <span className="hd-toolbar-label">患者</span>
        <Select
          placeholder="选择患者…"
          value={selectedPatient || undefined}
          onChange={(v) => setSelectedPatient(v)}
          options={patientSelectOptions}
          style={{ width: 'min(380px, 100%)' }}
          showSearch
          optionFilterProp="label"
        />
        </div>
        <div className="hd-filter-bar__right">
          <Button icon={<HistoryOutlined />} onClick={() => setShowHistory(true)} disabled={!selectedPatient}>
            处方历史
          </Button>
          <Button onClick={handlePrintPrescription} disabled={!selectedPatient}>
            打印摘要
          </Button>
          <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} disabled={!selectedPatient}>
            保存处方
          </Button>
        </div>
      </div>

      <div className="hd-workspace-frame hd-workspace-frame--scroll-split">
        {scheduleTodayRows.length > 0 ? (
          siderCollapsed ? (
            /* ── 折叠态 ── */
            <div
              style={{
                width: 32,
                flexShrink: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                paddingTop: 14,
                gap: 12,
                background: 'rgba(255,255,255,0.96)',
                borderRadius: 12,
                border: '1px solid var(--border)',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              <Tooltip title="展开排班名单" placement="right">
                <button type="button" onClick={() => setSiderCollapsed(false)} className="hd-workspace-collapse-toggle">
                  <RightOutlined />
                </button>
              </Tooltip>
              <div style={{ writingMode: 'vertical-rl', fontSize: 11, color: '#94a3b8', letterSpacing: 3, userSelect: 'none' }}>
                今日排班
              </div>
            </div>
          ) : (
            /* ── 展开态 ── */
            <aside className="hd-workspace-sidebar" style={{ flexBasis: PRESCRIPTION_TODAY_SIDER_WIDTH, width: PRESCRIPTION_TODAY_SIDER_WIDTH, maxWidth: PRESCRIPTION_TODAY_SIDER_WIDTH }}>
              <div className="hd-workspace-sidebar__head" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="hd-workspace-sidebar__title">今日排班 · 上机日</div>
                  <div className="hd-workspace-sidebar__desc">
                    与排班同步，点击患者卡片后直接进入处方编辑。
                  </div>
                </div>
                <Tooltip title="收起名单" placement="right">
                  <button type="button" onClick={() => setSiderCollapsed(true)} className="hd-workspace-collapse-toggle" style={{ marginTop: 2 }}>
                    <LeftOutlined />
                  </button>
                </Tooltip>
              </div>
            <div className="hd-workspace-sidebar__meta">
              <span style={{ fontWeight: 700, color: '#0f172a' }}>{scheduleTodayRows.length} 人</span>
              <span style={{ marginLeft: 8 }}>{dayjs().format('YYYY-MM-DD')}</span>
            </div>
            <div
              role="tablist"
              aria-label="按班次筛选今日排班"
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 6,
                marginBottom: 10,
                paddingLeft: 2,
              }}
            >
              {(
                [
                  { filterKey: 'all' as const, label: '全部' },
                  { filterKey: 'morning' as const, label: '上午' },
                  { filterKey: 'afternoon' as const, label: '下午' },
                  { filterKey: 'evening' as const, label: '晚上' },
                ] as const
              ).map(({ filterKey, label }) => {
                const count =
                  filterKey === 'all' ? scheduleTodayRows.length : sidebarShiftTabCounts[filterKey];
                const selected = sidebarScheduleShiftFilter === filterKey;
                return (
                  <button
                    key={filterKey}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setSidebarScheduleShiftFilter(filterKey)}
                    style={{
                      border: `1px solid ${selected ? '#2563eb' : '#e2e8f0'}`,
                      background: selected ? '#eff6ff' : '#fff',
                      borderRadius: 8,
                      padding: '4px 8px',
                      fontSize: 11,
                      fontWeight: selected ? 700 : 600,
                      color: selected ? '#1d4ed8' : '#475569',
                      cursor: 'pointer',
                      lineHeight: 1.3,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <span>{label}</span>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        color: selected ? '#1d4ed8' : '#64748b',
                        background: selected ? '#dbeafe' : '#f1f5f9',
                        borderRadius: 6,
                        padding: '0 5px',
                      }}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="hd-workspace-sidebar__body">
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 0,
                }}
              >
                {scheduleTodayGroupedForSidebar.length === 0 ? (
                  <div
                    style={{
                      fontSize: 12,
                      color: '#94a3b8',
                      padding: '12px 4px',
                      textAlign: 'center',
                      lineHeight: 1.5,
                    }}
                  >
                    {sidebarScheduleShiftFilter === 'all' ? '暂无排班数据' : '该时段暂无排班患者'}
                  </div>
                ) : (
                  scheduleTodayGroupedForSidebar.map((shiftBlock, shiftIdx) => {
                    const showShiftSectionTitle =
                      sidebarScheduleShiftFilter === 'all' || scheduleTodayGroupedForSidebar.length > 1;
                    return (
                  <section
                    key={shiftBlock.shiftKey}
                    style={{
                      marginTop: shiftIdx > 0 ? 12 : 0,
                      paddingTop: shiftIdx > 0 ? 10 : 0,
                      borderTop: shiftIdx > 0 ? '1px solid #EEF2F7' : 'none',
                    }}
                  >
                    {showShiftSectionTitle ? (
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: '#334155',
                        marginBottom: 8,
                        letterSpacing: '0.02em',
                      }}
                    >
                      {shiftBlock.shiftLabel}
                      <Tag color="blue" style={{ marginLeft: 6, fontSize: 11 }}>
                        {shiftBlock.zones.reduce((n, z) => n + z.rows.length, 0)} 人
                      </Tag>
                    </div>
                    ) : null}
                    {shiftBlock.zones.map((zoneBlock) => (
                      <div key={`${shiftBlock.shiftKey}-${zoneBlock.zoneKey}`} style={{ marginBottom: 10 }}>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            marginBottom: 6,
                          }}
                        >
                          <span
                            style={{
                              width: 3,
                              height: 12,
                              borderRadius: 2,
                              flexShrink: 0,
                              background:
                                zoneBlock.zoneColor === 'orange'
                                  ? '#ea580c'
                                  : zoneBlock.zoneColor === 'magenta'
                                    ? '#c026d3'
                                    : '#2563eb',
                            }}
                            aria-hidden
                          />
                          <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b' }}>
                            {zoneBlock.zoneLabel}
                          </span>
                          <span style={{ fontSize: 11, color: '#94a3b8' }}>{zoneBlock.rows.length} 人</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                          {zoneBlock.rows.map((row) => {
                            const zone = isolationTagProps(row.isolation_zone);
                            const hasRecord = Boolean(row.dialysis_record_id);
                            const remark = row.schedule_remark?.trim();
                            const age = ageFromDob(row.dob);
                            const gender = row.gender?.trim();
                            const meta = [gender, age].filter(Boolean).join(' · ');
                            const active = selectedPatient === row.patient_id;
                            const tagCompact = {
                              margin: 0,
                              fontSize: 10,
                              lineHeight: '15px' as const,
                              padding: '0 3px',
                            };
                            return (
                              <div
                                key={row.id}
                                role="button"
                                tabIndex={0}
                                className={`hd-schedule-patient-card${active ? ' hd-schedule-patient-card--active' : ''}`}
                                onClick={() => setSelectedPatient(row.patient_id)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    setSelectedPatient(row.patient_id);
                                  }
                                }}
                              >
                                <div
                                  style={{
                                    fontSize: 13,
                                    fontWeight: 700,
                                    color: '#0f172a',
                                    marginBottom: 5,
                                    lineHeight: 1.3,
                                    letterSpacing: '0.01em',
                                  }}
                                >
                                  {row.patient_name || '患者'}
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 3 }}>
                                  <Tag color={zone.color} style={tagCompact}>
                                    {zone.label}
                                  </Tag>
                                  <Tag style={tagCompact}>{scheduleShiftLabel(row.shift)}</Tag>
                                  {typeof row.machine_station === 'string' && row.machine_station.trim() ? (
                                    <Tag color="geekblue" style={tagCompact} title="档案约定机位">
                                      机位 {row.machine_station.trim()}
                                    </Tag>
                                  ) : (
                                    <Tag style={tagCompact}>机位未填写</Tag>
                                  )}
                                  <Tag color="cyan" style={tagCompact}>
                                    {sessionDialysisModeShort(row.session_dialysis_mode)}
                                  </Tag>
                                  <Tag style={tagCompact}>{accessTypeCn(row.access_type)}</Tag>
                                </div>
                                <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.4 }}>
                                  {hasRecord ? (
                                    <Tag color="success" icon={<CheckCircleFilled />} style={{ margin: 0, fontSize: 10 }}>
                                      已有记录
                                    </Tag>
                                  ) : (
                                    <span style={{ color: '#ca8a04' }}>待录入</span>
                                  )}
                                  {meta ? <span style={{ marginLeft: 6 }}>{meta}</span> : null}
                                </div>
                                {remark ? (
                                  <Tooltip title={remark}>
                                    <div
                                      style={{
                                        marginTop: 4,
                                        fontSize: 10,
                                        color: '#0369a1',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                      }}
                                    >
                                      <InfoCircleFilled style={{ marginRight: 4 }} />
                                      {remark}
                                    </div>
                                  </Tooltip>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </section>
                    );
                  })
                )}
              </div>
            </div>
            </aside>
          )
        ) : null}

        <div className="hd-workspace-content">
          {!selectedPatient && (
            <div className="hd-empty-state">
              {scheduleTodayRows.length > 0
                ? '请先在左侧今日排班名单中点击患者，或使用上方下拉框选择。处方宜在上机当日书写。'
                : '请先在上方选择患者。下方摘要与「录入透析记录」第①段「患者信息 · 处方参数 · 体重超滤」使用同一套演示数据。'}
            </div>
          )}

          {selectedPatient && (
        <Form
          form={form}
          layout="vertical"
          size="middle"
          onValuesChange={(changed) => {
            if ('ultrafiltrationMl' in changed && !ufProgrammaticRef.current) {
              ufUserEditedRef.current = true;
            }
            if ('heparinFirst' in changed && !heparinProgrammaticRef.current) {
              heparinUserEditedRef.current = true;
            }
            const keys = Object.keys(changed);
            if (!keys.some((k) => (BASIC_PARAM_KEYS as readonly string[]).includes(k))) return;
            if (skipPersistRef.current) return;
            persistBasicParamsFromForm();
          }}
          initialValues={prescriptionFormInitialValues}
        >
          {patientInfo && (
            <div className="hd-record-section">
              <div className="hd-record-section__header">
                <div className="hd-record-section__step" style={{ background: '#1D4ED8' }}>
                  1
                </div>
                <span className="hd-record-section__title">
                  患者信息 · 处方参数 · 体重超滤（与「录入透析记录」同步）
                </span>
              </div>
              <div className="hd-record-section__body">
                <div className="hd-clinical-banner">
                  <span className="hd-clinical-banner__name">
                    {patientInfo.label.split(' — ')[0]}
                  </span>
                  <Tag color="blue">{shiftCodeToChinese(shiftWatched)}</Tag>
                  <Tag color="geekblue">{machineNoWatched ?? patientInfo.demo.preAssessment.machineNo}</Tag>
                  <Tag color={patientInfo.demo.vascular.accessType === 'AVF' || patientInfo.demo.vascular.accessType === 'AVG' ? 'green' : 'orange'}>
                    {patientInfo.demo.vascular.accessType}
                  </Tag>
                  <span className="hd-clinical-banner__copy">
                    开立医师：<strong style={{ color: '#0D1B3E' }}>{patientInfo.demo.prescribingDoctorName}</strong>
                  </span>
                  <span className="hd-clinical-banner__hint">
                    下方编辑后此处实时更新
                  </span>
                </div>

                <div className="hd-summary-stack" style={{ marginBottom: 16 }}>
                  <div className="hd-summary-block">
                    <div className="hd-summary-block__title">
                      基本参数 · 透析处方
                    </div>
                    <div className="hd-summary-block__meta">方案与体外循环</div>
                    <RxGrid cols={3} gap={10}>
                      <RxReadonlyValue label="透析频次" value={frequencyLabel} />
                      <RxReadonlyValue label="透析模式" value={modeDisplay} />
                      {modeWatched === 'HD_HP' && (
                        <RxReadonlyValue label="HD+HP 附加剂量" value={`+${hpHeparinExtraIUWatched ?? 500} IU`} />
                      )}
                      {modeWatched === 'HDF' && (
                        <>
                          <RxReadonlyValue
                            label="置换方式"
                            value={
                              HDF_REPLACEMENT_MODE_LABEL[String(hdfReplacementModeWatched ?? '')] ?? '—'
                            }
                          />
                          <RxReadonlyValue
                            label="置换液量"
                            value={
                              hdfReplacementVolumeLWatched != null &&
                              Number.isFinite(Number(hdfReplacementVolumeLWatched))
                                ? `${hdfReplacementVolumeLWatched} L`
                                : '—'
                            }
                          />
                        </>
                      )}
                      <RxReadonlyValue label="标准时长" value={`${durationWatched ?? '—'} h`} />
                      <RxReadonlyValue label="血流速" value={`${bloodFlowWatched ?? '—'} mL/min`} />
                      <RxReadonlyValue label="透析液流速" value={`${dialysateFlowWatched ?? '—'} mL/min`} />
                      <RxReadonlyValue label="透析器" value={dialyzerShort} />
                      {modeWatched === 'HD_HP' && (
                        <RxReadonlyValue label="灌流器" value={hpCartridgeShort} />
                      )}
                      <RxReadonlyValue
                        label="Na / K / Ca"
                        value={`${naWatched ?? '—'} / ${kWatched ?? '—'} / ${caWatched ?? '—'}`}
                      />
                      <RxReadonlyValue
                        label="透析液温度 (℃)"
                        value={tempWatched != null ? `${tempWatched} ℃` : '—'}
                      />
                      <RxReadonlyValue label="钠曲线" value={sodiumCurveLine} />
                      <RxReadonlyValue label="抗凝方案" value={anticoagulantLabel} />
                      {anticoagulantWatched === 'citrate' ? (
                        <RxReadonlyValue label="枸橼酸细则" value={citrateDetailDisplay} />
                      ) : null}
                      <RxReadonlyValue
                        label="首剂"
                        value={heparinFirstWatched != null ? `${heparinFirstWatched} IU` : '—'}
                      />
                      <RxReadonlyValue
                        label="追加"
                        value={heparinMaintWatched != null ? `${heparinMaintWatched} IU/h` : '—'}
                      />
                    </RxGrid>
                  </div>
                  <div className="hd-summary-block">
                    <div className="hd-summary-block__title">
                      基本参数 · 透前评估
                    </div>
                    <div className="hd-summary-block__meta">生命体征与临床</div>
                    <RxGrid cols={3} gap={10}>
                      <RxReadonlyValue label="收缩压" value={`${preAssessSbpLive ?? '—'} mmHg`} />
                      <RxReadonlyValue label="舒张压" value={`${preAssessDbpLive ?? '—'} mmHg`} />
                      <RxReadonlyValue label="脉搏" value={`${preAssessPulseLive ?? '—'} 次/分`} />
                      <RxReadonlyValue label="水肿" value={edemaSummaryDisplay} />
                      <RxReadonlyValue label="活动性出血" value={bleedingSummaryDisplay} />
                      <RxReadonlyValue
                        label="班次 / 机器"
                        value={`${shiftCodeToChinese(shiftWatched)} · ${machineNoWatched ?? patientInfo.demo.preAssessment.machineNo ?? '—'}`}
                      />
                    </RxGrid>
                    <div style={{ marginTop: 10 }}>
                      <RxReadonlyValue
                        label="其他（透前补充）"
                        value={
                          preAssessOtherDisplay !== '—' ? (
                            <span style={{ whiteSpace: 'pre-wrap', fontWeight: 600, fontSize: 13 }}>
                              {String(preAssessOtherLive ?? '').trim()}
                            </span>
                          ) : (
                            '—'
                          )
                        }
                      />
                    </div>
                  </div>
                </div>

                <div className="hd-summary-block hd-summary-block--warm">
                  <div className="hd-summary-block__title">
                    体重与超滤（与下方「超滤量 (mL)」一致：(上机前体重−干体重)×1000 + 附加（HD/HDF +200mL，HD+HP +500mL），可手动修改）
                  </div>
                  <RxGrid cols={4} gap={14}>
                    <RxReadonlyValue
                      label="干体重（处方）"
                      value={`${dryWeightWatched ?? '—'} kg`}
                      color="#1D4ED8"
                      bg="#EFF6FF"
                      border="#BFDBFE"
                    />
                    <RxReadonlyValue label="上机前体重（处方）" value={`${preMachineWeightWatched ?? '—'} kg`} />
                    <RxReadonlyValue
                      label="处方超滤量"
                      value={
                        rxUfDialysisPreview !== null
                          ? `${rxUfDialysisPreview} mL${ufAlertDialysis ? ' ⚠️' : ''}`
                          : '—'
                      }
                      color={ufAlertDialysis ? '#BE123C' : '#15803D'}
                      bg={ufAlertDialysis ? '#FFF1F2' : '#F0FDF4'}
                      border={ufAlertDialysis ? '#FECDD3' : '#BBF7D0'}
                    />
                    <RxReadonlyValue
                      label="超滤率 = 超滤量 ÷ 时长"
                      value={ufRateDialysisPreview !== null ? `${ufRateDialysisPreview} mL/h` : '—'}
                      color="#0369A1"
                      bg="#F0F9FF"
                      border="#BAE6FD"
                    />
                    <RxReadonlyValue
                      label="每公斤体重每小时超滤率（干体重）"
                      value={
                        ufPerHrPerDryKgPreview !== null
                          ? `${ufPerHrPerDryKgPreview} mL·h⁻¹·kg⁻¹`
                          : '—'
                      }
                      color="#0369A1"
                      bg="#F0F9FF"
                      border="#BAE6FD"
                    />
                  </RxGrid>
                </div>
              </div>
            </div>
          )}

          <Collapse
            className="hd-prescription-collapse"
            bordered={false}
            defaultActiveKey={['rx']}
            items={[
              {
                key: 'rx',
                label: (
                  <span style={{ fontWeight: 600, fontSize: 14 }}>
                    ② 处方与透前评估（频次 · 透析模式 · 抗凝 · 干体重 · 透前）
                  </span>
                ),
                children: (
                  <div>
          {/* 基本透析参数 */}
          <Card
            className="hd-panel-card hd-prescription-card"
            title={<span className="hd-card-title">基本透析参数</span>}
          >
            <div className="hd-card-subtitle">透析方案与频次</div>
            <div className="grid-4" style={{ gap: 16, marginBottom: 16 }}>
              <Form.Item label="透析频次" name="frequencyPreset" rules={[{ required: true, message: '请选择透析频次' }]}>
                <Select options={[...FREQUENCY_PRESET_OPTIONS]} />
              </Form.Item>
              {frequencyPreset === 'other' && (
                <Form.Item
                  label="频次说明（手动填写）"
                  name="frequencyCustom"
                  rules={[{ required: true, message: '请填写透析频次' }]}
                >
                  <Input placeholder="如：隔日一次、每周2次+隔周1次…" />
                </Form.Item>
              )}
              <Form.Item label="标准时长（小时）" name="duration">
                <InputNumber min={2} max={8} step={0.5} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item label="透析模式" name="mode" rules={[{ required: true, message: '请选择透析模式' }]}>
                <Select options={[...MODE_OPTIONS]} />
              </Form.Item>
              {modeWatched === 'HD_HP' && (
                <Form.Item
                  label="HD+HP 附加剂量"
                  name="hpHeparinExtraIU"
                  rules={[{ required: true, message: '请选择 HD+HP 附加剂量' }]}
                  extra="用于低分子肝素类首剂自动计算"
                >
                  <Select options={[...HD_HP_HEPARIN_EXTRA_OPTIONS]} />
                </Form.Item>
              )}
              {modeWatched === 'other' && (
                <Form.Item label="透析模式说明" name="modeOther" rules={[{ required: true, message: '请填写透析模式' }]}>
                  <Input placeholder="请描述具体透析模式" />
                </Form.Item>
              )}
              {modeWatched === 'HDF' && (
                <>
                  <Form.Item
                    label="置换方式"
                    name="hdfReplacementMode"
                    rules={[{ required: true, message: '请选择置换方式' }]}
                  >
                    <Select options={[...HDF_REPLACEMENT_MODE_OPTIONS]} placeholder="前置换 / 后置换 / 前后置换" />
                  </Form.Item>
                  <Form.Item
                    label="置换液量"
                    name="hdfReplacementVolumeL"
                    rules={[
                      { required: true, message: '请填写置换液量' },
                      {
                        type: 'number',
                        min: 0.1,
                        max: 100,
                        message: '置换液量须在 0.1～100 L',
                      },
                    ]}
                  >
                    <InputNumber min={0.1} max={100} step={0.1} precision={2} style={{ width: '100%' }} addonAfter="L" />
                  </Form.Item>
                </>
              )}
              <Form.Item label="透析器" name="dialyzer" rules={[{ required: true, message: '请选择透析器' }]}>
                <Select
                  options={dialyzerOptions}
                  showSearch
                  optionFilterProp="label"
                  placeholder={dialyzerSelectPlaceholder}
                  onDropdownVisibleChange={(open) => {
                    if (open) pullConsumablesCatalogOnInteract();
                  }}
                />
              </Form.Item>
              {modeWatched === 'HD_HP' && (
                <Form.Item
                  label="灌流器"
                  name="hpCartridge"
                  rules={[{ required: true, message: '请选择灌流器（HD+HP）' }]}
                  extra="选项来自设备耗材仓库中有库存的目录项。新建耗材目录时请选择品类「灌流器」，系统将同步至 HD+HP 灌流器可选列表。"
                >
                  <Select
                    options={hpCartridgeOptions}
                    showSearch
                    optionFilterProp="label"
                    placeholder={hpCartridgeSelectPlaceholder}
                    onDropdownVisibleChange={(open) => {
                      if (open) pullConsumablesCatalogOnInteract();
                    }}
                  />
                </Form.Item>
              )}
            </div>
            <Divider style={{ margin: '8px 0 16px', borderColor: '#DBEAFE' }} />
            <div style={{ fontSize: 13, fontWeight: 600, color: '#0369A1', marginBottom: 12 }}>血流与抗凝</div>
            <div className="grid-4" style={{ gap: 16, marginBottom: 16 }}>
              <Form.Item label="血流速 (mL/min)" name="bloodFlow">
                <InputNumber min={100} max={450} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item label="透析液流速 (mL/min)" name="dialysateFlow">
                <Select options={[{ value: 500, label: '500 mL/min' }, { value: 600, label: '600 mL/min' }, { value: 800, label: '800 mL/min' }]} />
              </Form.Item>
              <Form.Item label="抗凝方案" name="anticoagulant">
                <Select options={[...ANTICOAGULANT_OPTIONS]} />
              </Form.Item>
            </div>
            {anticoagulantWatched === 'citrate' && (
              <Card
                size="small"
                title="枸橼酸抗凝细则（普通透析含钙透析液）"
                style={{ marginBottom: 16, borderColor: '#BFDBFE' }}
              >
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 12 }}
                  message="默认按简化 RCA-HD：4% 枸橼酸钠、含钙透析液、通常不额外补钙；根据滤器后游离钙和凝血情况调整。"
                />
                <div className="grid-4" style={{ gap: 16 }}>
                  <Form.Item
                    label="抗凝方式"
                    name="citrateMode"
                    rules={[{ required: true, message: '请选择枸橼酸抗凝方式' }]}
                  >
                    <Select options={[...CITRATE_ANTICOAGULATION_MODE_OPTIONS]} />
                  </Form.Item>
                  <Form.Item
                    label="枸橼酸浓度"
                    name="citrateConcentration"
                    rules={[{ required: true, message: '请填写枸橼酸浓度' }]}
                  >
                    <InputNumber min={0.1} max={50} step={0.1} precision={1} style={{ width: '100%' }} addonAfter="%" />
                  </Form.Item>
                  <Form.Item
                    label="动脉端泵速"
                    name="citrateArterialPumpRate"
                    extra="4% 枸橼酸钠常按血流速 1.2-2.0 倍 mL/h 个体化调整"
                    rules={[{ required: true, message: '请填写动脉端泵速' }]}
                  >
                    <InputNumber min={0} max={1000} step={10} style={{ width: '100%' }} addonAfter="mL/h" />
                  </Form.Item>
                  {citrateModeWatched === 'two_stage' && (
                    <Form.Item
                      label="静脉壶前泵速"
                      name="citrateVenousPumpRate"
                      extra="仅两段式显示"
                      rules={[{ required: true, message: '请填写静脉壶前泵速' }]}
                    >
                      <InputNumber min={0} max={500} step={5} style={{ width: '100%' }} addonAfter="mL/h" />
                    </Form.Item>
                  )}
                  <Form.Item
                    label="血流速"
                    name="citrateBloodFlowRate"
                    rules={[{ required: true, message: '请填写血流速' }]}
                  >
                    <InputNumber min={100} max={450} step={10} style={{ width: '100%' }} addonAfter="mL/min" />
                  </Form.Item>
                  <Form.Item
                    label="透析液流速"
                    name="citrateDialysateFlowRate"
                    rules={[{ required: true, message: '请填写透析液流速' }]}
                  >
                    <InputNumber min={300} max={800} step={50} style={{ width: '100%' }} addonAfter="mL/min" />
                  </Form.Item>
                  <Form.Item
                    label="透析液钙浓度"
                    name="citrateDialysateCalcium"
                    rules={[{ required: true, message: '请选择透析液钙浓度' }]}
                  >
                    <Select options={[...CITRATE_DIALYSATE_CALCIUM_OPTIONS]} />
                  </Form.Item>
                  <Form.Item
                    label="是否额外补钙"
                    name="citrateCalciumSupplement"
                    rules={[{ required: true, message: '请选择是否补钙' }]}
                  >
                    <Select options={[...CITRATE_CALCIUM_SUPPLEMENT_OPTIONS]} />
                  </Form.Item>
                  <Form.Item label="滤器后游离钙监测" name="citratePostFilterICa">
                    <InputNumber min={0} max={3} step={0.01} precision={2} style={{ width: '100%' }} addonAfter="mmol/L" />
                  </Form.Item>
                  <Form.Item
                    label="目标滤器后 iCa"
                    name="citrateTargetPostFilterICa"
                    rules={[{ required: true, message: '请选择目标滤器后 iCa' }]}
                  >
                    <Select options={[...CITRATE_TARGET_ICA_OPTIONS]} />
                  </Form.Item>
                  {citrateTargetPostFilterICaWatched === 'custom' && (
                    <Form.Item
                      label="自定义目标 iCa"
                      name="citrateTargetPostFilterICaCustom"
                      rules={[{ required: true, message: '请填写自定义目标 iCa' }]}
                    >
                      <Input placeholder="如：0.30-0.45 mmol/L" />
                    </Form.Item>
                  )}
                  <Form.Item
                    label="监测时间点"
                    name="citrateMonitorPoints"
                    rules={[{ required: true, message: '请选择监测时间点' }]}
                  >
                    <Select mode="multiple" options={[...CITRATE_MONITOR_POINT_OPTIONS]} />
                  </Form.Item>
                  <Form.Item
                    label="凝血观察部位"
                    name="citrateCoagulationSites"
                    rules={[{ required: true, message: '请选择凝血观察部位' }]}
                  >
                    <Select mode="multiple" options={[...CITRATE_COAGULATION_SITE_OPTIONS]} />
                  </Form.Item>
                </div>
                <Form.Item name="citrateDetail" hidden>
                  <Input />
                </Form.Item>
              </Card>
            )}
            <div className="grid-4" style={{ gap: 16, marginBottom: 16 }}>
              <Form.Item
                label="首剂"
                name="heparinFirst"
                extra={
                  LMWH_FAMILY.has(anticoagulantWatched ?? '')
                    ? '低分子肝素类：HDF 在基础首剂上 +200 IU；HD+HP 按上方 +500 / +800 IU 选项自动叠加（可改）'
                    : undefined
                }
              >
                <InputNumber min={0} max={10000} step={500} style={{ width: '100%' }} addonAfter="IU" />
              </Form.Item>
              <Form.Item label="追加量" name="heparinMaint">
                <InputNumber min={0} max={2000} step={100} style={{ width: '100%' }} addonAfter="IU/h" />
              </Form.Item>
            </div>
            <Divider style={{ margin: '8px 0 16px', borderColor: '#DBEAFE' }} />
            <div style={{ fontSize: 13, fontWeight: 600, color: '#0369A1', marginBottom: 12 }}>干体重与超滤</div>
            {baselineDryWeight != null &&
            dryWeightWatched !== undefined &&
            Number(dryWeightWatched) !== baselineDryWeight ? (
              <>
                <div className="grid-4" style={{ gap: 16, marginBottom: 8 }}>
                  <Form.Item label={<>干体重目标 (kg) <span style={{ color: '#F43F5E' }}>*</span></>} name="dryWeight">
                    <InputNumber min={20} max={200} step={0.5} style={{ width: '100%', fontWeight: 600 }} />
                  </Form.Item>
                </div>
                <Form.Item
                  label="干体重调整原因"
                  name="dryWeightChangeReason"
                  style={{ marginBottom: 16 }}
                  rules={[
                    {
                      validator: (_, value) => {
                        const dw = form.getFieldValue('dryWeight');
                        const b = baselineDryWeightRef.current;
                        if (b != null && dw !== undefined && Number(dw) !== b) {
                          if (!value || !String(value).trim()) {
                            return Promise.reject(new Error('干体重与档案不一致时请填写调整原因'));
                          }
                        }
                        return Promise.resolve();
                      },
                    },
                  ]}
                >
                  <Input placeholder="如：容量负荷、营养变化、临床评估等" />
                </Form.Item>
                <div className="grid-4" style={{ gap: 16, marginBottom: 8 }}>
                  <Form.Item label="上机前体重 (kg)" name="preMachineWeight">
                    <InputNumber min={20} max={200} step={0.1} style={{ width: '100%' }} />
                  </Form.Item>
                  <Form.Item
                    label="超滤量 (mL)"
                    name="ultrafiltrationMl"
                    extra={
                      <span style={{ fontSize: 12, color: '#64748B' }}>
                        自动：(上机前体重−干体重)×1000 + 附加（HD/HDF +200mL，HD+HP +500mL），可手动修改
                      </span>
                    }
                  >
                    <InputNumber min={0} max={20000} step={50} style={{ width: '100%' }} />
                  </Form.Item>
                </div>
              </>
            ) : (
              <div className="grid-4" style={{ gap: 16, marginBottom: 8 }}>
                <Form.Item label={<>干体重目标 (kg) <span style={{ color: '#F43F5E' }}>*</span></>} name="dryWeight">
                  <InputNumber min={20} max={200} step={0.5} style={{ width: '100%', fontWeight: 600 }} />
                </Form.Item>
                <Form.Item label="上机前体重 (kg)" name="preMachineWeight">
                  <InputNumber min={20} max={200} step={0.1} style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item
                  label="超滤量 (mL)"
                  name="ultrafiltrationMl"
                  extra={
                    <span style={{ fontSize: 12, color: '#64748B' }}>
                      自动：(上机前体重−干体重)×1000 + 附加（HD/HDF +200mL，HD+HP +500mL），可手动修改
                    </span>
                  }
                >
                  <InputNumber min={0} max={20000} step={50} style={{ width: '100%' }} />
                </Form.Item>
              </div>
            )}
            {typeof dryWeightWatched === 'number' &&
              dryWeightWatched > 0 &&
              typeof ultrafiltrationWatched === 'number' &&
              isUltrafiltrationExceedsDryWeightRatio(ultrafiltrationWatched, dryWeightWatched) && (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginBottom: 16 }}
                  message="超滤量超过干体重 5%"
                  description="当前超滤量相对干体重占比偏高，请结合临床复核（质控警示阈值：超滤量大于干体重×5%）。"
                />
              )}
          </Card>

          <Card
            className="hd-panel-card hd-prescription-card"
            title={<span className="hd-card-title">透前评估</span>}
          >
            <div className="hd-card-subtitle">生命体征</div>
            <div className="grid-4" style={{ gap: 16, marginBottom: 16 }}>
              <Form.Item label="透前收缩压 (mmHg)" name="preAssessSbp">
                <InputNumber min={60} max={250} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item label="透前舒张压 (mmHg)" name="preAssessDbp">
                <InputNumber min={40} max={160} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item label="透前脉搏 (次/分)" name="preAssessPulse">
                <InputNumber min={40} max={200} style={{ width: '100%' }} />
              </Form.Item>
            </div>
            <Divider style={{ margin: '8px 0 16px', borderColor: '#DBEAFE' }} />
            <div className="hd-card-subtitle">临床与症状</div>
            <Form.Item label="其他（透前补充）" name="preAssessOther" style={{ marginBottom: 16 }}>
              <Input.TextArea rows={2} placeholder="呼吸道、全身情况等补充说明（手填）" />
            </Form.Item>
            <div className="grid-4" style={{ gap: 16, marginBottom: 12 }}>
              <Form.Item label="水肿" name="preAssessEdema" rules={[{ required: true, message: '请选择有无水肿' }]}>
                <Select options={[...YES_NO_ASSESS_OPTIONS]} placeholder="请选择" />
              </Form.Item>
              <Form.Item label="活动性出血" name="preAssessBleeding" rules={[{ required: true, message: '请选择有无活动性出血' }]}>
                <Select options={[...YES_NO_ASSESS_OPTIONS]} placeholder="请选择" />
              </Form.Item>
            </div>
            {preAssessEdemaWatched === 'yes' && (
              <Form.Item
                label="水肿部位"
                name="preAssessEdemaSite"
                style={{ marginBottom: 12 }}
                rules={[{ required: true, message: '请填写水肿部位' }]}
              >
                <Input placeholder="如：双下肢、颜面、骶尾部等" />
              </Form.Item>
            )}
            {preAssessBleedingWatched === 'yes' && (
              <Form.Item
                label="出血部位及说明"
                name="preAssessBleedingDesc"
                style={{ marginBottom: 16 }}
                rules={[{ required: true, message: '请填写出血部位及说明' }]}
              >
                <Input.TextArea rows={2} placeholder="部位、性状、大致出血量等" />
              </Form.Item>
            )}
            <Divider style={{ margin: '8px 0 16px', borderColor: '#DBEAFE' }} />
            <div className="hd-card-subtitle">上机安排</div>
            <div className="grid-4" style={{ gap: 16 }}>
              <Form.Item label="班次" name="shift">
                <Select
                  options={[
                    { value: 'am', label: '上午班' },
                    { value: 'pm', label: '下午班' },
                    { value: 'eve', label: '晚班' },
                  ]}
                />
              </Form.Item>
              {isUuid(selectedPatient) ? (
                <Form.Item
                  label="档案约定机位"
                  tooltip="与患者档案「机位」一致；请在患者档案中维护，保存后同步至排班。"
                >
                  <Input
                    readOnly
                    placeholder="未在档案中填写"
                    value={archiveMachineStationDisplay}
                  />
                </Form.Item>
              ) : (
                <Form.Item label="机位（演示）" name="machineNo">
                  <Input placeholder="如：5号机" />
                </Form.Item>
              )}
            </div>
          </Card>
                  </div>
                ),
              },
              {
                key: 'fluid',
                label: <span style={{ fontWeight: 600, fontSize: 14 }}>③ 透析液与钠曲线</span>,
                children: (
                  <div>
          {/* 透析液参数 */}
          <Card
            className="hd-panel-card hd-prescription-card"
            title={<span className="hd-card-title">透析液参数</span>}
          >
            <div className="grid-4" style={{ gap: 16 }}>
              <Form.Item label="钠浓度 (mmol/L)" name="na">
                <InputNumber min={130} max={148} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item label="钾浓度 (mmol/L)" name="k">
                <InputNumber min={0} max={4} step={0.5} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item label="钙浓度 (mmol/L)" name="ca">
                <InputNumber min={1.0} max={2.0} step={0.25} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item label="温度 (℃)" name="temp">
                <InputNumber min={35} max={38} step={0.5} style={{ width: '100%' }} />
              </Form.Item>
            </div>
            <Divider style={{ margin: '20px 0 16px', borderColor: '#DBEAFE' }} />
            <div className="hd-card-subtitle">可调钠曲线</div>
            <div className="grid-4" style={{ gap: 16, marginBottom: 12 }}>
              <Form.Item label="钠曲线模式" name="sodiumCurve" tooltip="含单超及序贯单超选项，与机器钠程序/治疗阶段联动">
                <Select options={[...SODIUM_CURVE_OPTIONS]} placeholder="请选择" />
              </Form.Item>
              {(sodiumCurveWatched === 'linear_up' ||
                sodiumCurveWatched === 'linear_down' ||
                sodiumCurveWatched === 'step') && (
                <>
                  <Form.Item label="曲线起始钠 (mmol/L)" name="naCurveStart">
                    <InputNumber min={130} max={148} step={0.5} style={{ width: '100%' }} />
                  </Form.Item>
                  <Form.Item label="曲线目标/结束钠 (mmol/L)" name="naCurveEnd">
                    <InputNumber min={130} max={148} step={0.5} style={{ width: '100%' }} />
                  </Form.Item>
                </>
              )}
              {sodiumCurveWatched === 'programmable' && (
                <Form.Item
                  label="机型程序说明"
                  name="sodiumCurveCustom"
                  style={{ gridColumn: 'span 2' }}
                  rules={[{ required: true, message: '请填写可编程曲线要点或程序编号' }]}
                >
                  <Input placeholder="如：机型内置曲线编号、变钠节点等" />
                </Form.Item>
              )}
              {sodiumCurveWatched === 'other' && (
                <Form.Item
                  label="钠曲线说明"
                  name="sodiumCurveCustom"
                  style={{ gridColumn: 'span 3' }}
                  rules={[{ required: true, message: '请填写钠曲线说明' }]}
                >
                  <Input.TextArea rows={2} placeholder="描述钠曲线设定方式、时段与目标钠等" />
                </Form.Item>
              )}
            </div>
            {sodiumCurveWatched && sodiumCurveWatched !== 'fixed' && (
              <div className="grid-4" style={{ gap: 16, marginBottom: 12 }}>
                <Form.Item
                  label="曲线起始时间"
                  name="naCurveTimeStart"
                  tooltip="钠曲线或单超/序贯阶段在本处方中的计划起止时刻，请结合班次与标准时长核对"
                  rules={[{ required: true, message: '请填写或选择起始时间' }]}
                  {...timePickerStringBinding()}
                >
                  <TimePicker
                    format={TIME_HM_FORMAT}
                    needConfirm={false}
                    minuteStep={5}
                    style={{ width: '100%' }}
                    placeholder="手动选择"
                  />
                </Form.Item>
                <Form.Item
                  label="曲线结束时间"
                  name="naCurveTimeEnd"
                  rules={[
                    { required: true, message: '请填写或选择结束时间' },
                    ({ getFieldValue }) => ({
                      validator(_, value) {
                        const start = getFieldValue('naCurveTimeStart') as string | undefined;
                        if (!start || !value || typeof start !== 'string' || typeof value !== 'string') {
                          return Promise.resolve();
                        }
                        const s = dayjs(start, TIME_HM_FORMAT);
                        const e = dayjs(value, TIME_HM_FORMAT);
                        if (!s.isValid() || !e.isValid()) return Promise.resolve();
                        if (e.isBefore(s) || e.isSame(s)) {
                          return Promise.reject(
                            new Error('结束时间须晚于起始时间（跨日治疗请在处方备注中说明）')
                          );
                        }
                        return Promise.resolve();
                      },
                    }),
                  ]}
                  {...timePickerStringBinding()}
                >
                  <TimePicker
                    format={TIME_HM_FORMAT}
                    needConfirm={false}
                    minuteStep={5}
                    style={{ width: '100%' }}
                    placeholder="手动选择"
                  />
                </Form.Item>
              </div>
            )}
            {(sodiumCurveWatched === 'iuf' || sodiumCurveWatched === 'iuf_sequential_hd') && (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 0 }}
                message={sodiumCurveWatched === 'iuf' ? '单超（单纯超滤）' : '单超序贯常规透析'}
                description={
                  sodiumCurveWatched === 'iuf'
                    ? '本模式以超滤清除水分为主，透析液侧按科室规程执行；请确认机器单超程序、钠浓度与血流量设定，并与上方超滤量/干体重目标一致。'
                    : '建议分段设定：单超阶段与后续 HD 阶段分别核对钠曲线与透析液参数；序贯切换时按科室核对交接与记录。'
                }
              />
            )}
          </Card>
                  </div>
                ),
              },
              {
                key: 'assess',
                label: <span style={{ fontWeight: 600, fontSize: 14 }}>④ 透后评估与备注</span>,
                children: (
                  <div>
          {/* 透析后评估（与透析记录录入同步，一方填写则另一方只读） */}
          <Card
            className="hd-panel-card hd-prescription-card"
            title={<span className="hd-card-title">透后评估（医生填写）</span>}
          >
            {postDialysisLockedByNurse && (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
                message="透后数据已由护士在透析记录中填写"
                description="与「录入透析记录」页共用同一份数据，此处无需重复填写；如需更正请由护士在透析记录中修改。"
              />
            )}
            <div className="grid-4" style={{ gap: 16 }}>
              <Form.Item label="透后收缩压 (mmHg)" name="postDialysisSbp">
                <InputNumber
                  min={40}
                  max={280}
                  style={{ width: '100%' }}
                  disabled={postDialysisLockedByNurse}
                />
              </Form.Item>
              <Form.Item label="透后舒张压 (mmHg)" name="postDialysisDbp">
                <InputNumber
                  min={30}
                  max={280}
                  style={{ width: '100%' }}
                  disabled={postDialysisLockedByNurse}
                />
              </Form.Item>
              <Form.Item label="透后脉搏 (次/分)" name="postDialysisPulse">
                <InputNumber
                  min={30}
                  max={220}
                  style={{ width: '100%' }}
                  disabled={postDialysisLockedByNurse}
                />
              </Form.Item>
              <Form.Item label="透后体重 (kg)" name="postDialysisWeightKg">
                <InputNumber
                  min={20}
                  max={200}
                  step={0.1}
                  style={{ width: '100%' }}
                  disabled={postDialysisLockedByNurse}
                />
              </Form.Item>
            </div>
          </Card>

          {/* 处方备注 */}
          <Card
            className="hd-panel-card hd-prescription-card"
            title={<span className="hd-card-title">处方备注</span>}
          >
            <Form.Item
              label="血透方式备注（入库 hemodialysis_remark，可与排班备注同步）"
              name="hemodialysisRemark"
              style={{ marginBottom: 12 }}
            >
              <Input.TextArea rows={2} placeholder="如：无肝素、置换说明、与科室对接说明…" />
            </Form.Item>
            <Form.Item
              label="其他说明（与上方「透前补充」合并保存至 prescriptions.notes）"
              name="notes"
            >
              <Input.TextArea rows={2} placeholder="特殊说明（选填）；保存时与「其他（透前补充）」一并写入数据库" />
            </Form.Item>
          </Card>
                  </div>
                ),
              },
            ]}
          />

          <div className="hd-form-footer">
            <div style={{ flex: '1 1 280px', minWidth: 0 }}>
              <span className="hd-form-footer__hint">
                保存与顶部按钮相同；基本参数可本地记忆。
              </span>
              <div className="hd-form-footer__actions" style={{ marginTop: 12 }}>
                <Button
                  onClick={() => {
                    form.resetFields();
                    if (selectedPatient) {
                      applyPatientFormValues(selectedPatient);
                    }
                  }}
                >
                  重置表单
                </Button>
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <Form.Item label="医生签名" name="doctorSignature" style={{ marginBottom: 8 }}>
                <Input
                  placeholder="默认拼音首字母，可填全名（如 杨晨 或 yc）"
                  style={{ width: 'min(220px, 100%)' }}
                />
              </Form.Item>
              <div
                style={{
                  fontSize: 14,
                  lineHeight: '22px',
                  color: '#0D1B3E',
                  fontWeight: 500,
                  width: 'min(220px, 100%)',
                  marginLeft: 'auto',
                }}
              >
                生成日期：{dayjs().format('YYYY年MM月DD日')}
              </div>
            </div>
          </div>
        </Form>
          )}

        </div>
      </div>

      {/* 处方历史弹窗 */}
      <Modal title="处方修改历史" open={showHistory} onCancel={() => setShowHistory(false)} footer={null} width={680}>
        <Table
          dataSource={PRESCRIPTION_HISTORY}
          size="small"
          pagination={false}
          columns={[
            { title: '修改日期', dataIndex: 'date' },
            { title: '处方医生', dataIndex: 'doctor' },
            { title: '处方摘要', dataIndex: 'summary' },
            {
              title: '状态',
              dataIndex: 'status',
              render: (v: string) => <Tag color={v === '当前有效' ? 'green' : 'default'}>{v}</Tag>,
            },
            { title: '操作', render: () => <Button size="small">查看详情</Button> },
          ]}
        />
      </Modal>

      {/* 保存确认弹窗 */}
      <Modal
        title="确认修改处方"
        open={showConfirm}
        onOk={handleConfirm}
        onCancel={() => setShowConfirm(false)}
        okText="确认保存"
        cancelText="取消"
        confirmLoading={saveSubmitting}
      >
        <div style={{ padding: '8px 0', fontSize: 14, color: '#0D1B3E', lineHeight: 1.8 }}>
          <div>
            即将保存对 <strong>{confirmPatientDisplayName}</strong> 的透析处方修改。
          </div>
          <div
            style={{
              marginTop: 8,
              padding: 10,
              background: '#FFF1F2',
              border: '1px solid #FECDD3',
              borderRadius: 6,
              fontSize: 13,
              color: '#BE123C',
            }}
          >
            ⚠️ 处方修改将立即生效，护士在下次透析录入时将使用新处方参数。此操作将记录审计日志。
          </div>
        </div>
      </Modal>
    </PageShell>
  );
}
