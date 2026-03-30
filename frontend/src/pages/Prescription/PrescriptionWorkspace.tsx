/**
 * 透析处方管理工作台（医生端）
 * 主要作用：查看与维护患者当前透析处方参数，关联历史处方列表。
 * 主要功能：处方表单编辑；历史版本 Modal；保存时对接 prescriptions API。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, Select, Button, InputNumber, Input, Form, Divider, Table, Modal, message, Tag, Alert, TimePicker, Collapse } from 'antd';
import dayjs from 'dayjs';
import { HistoryOutlined, SaveOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';
import PageShell from '../../components/PageShell/PageShell';
import { getDialyzerSelectOptions } from '../../constants/dialyzerConsumables';
import { DIALYSIS_DEMO_PATIENTS, type DialysisDemoPatient } from '../../constants/dialysisDemoPatients';
import {
  buildPrescriptionDefaultsFromDemo,
  shiftCodeToChinese,
  frequencyPresetLabel,
  dialysisModeLabel,
  formatSodiumCurveSummary,
  yesNoAssessLabel,
  PRESCRIPTION_BASIC_PARAMS_STORAGE_KEY,
  loadPrescriptionBasicParamsFromStorage,
} from '../../utils/prescriptionFormFromDemo';
import {
  readPostDialysisSync,
  writePostDialysisSync,
  POST_DIALYSIS_SYNC_EVENT,
  type PostDialysisSyncPayload,
} from '../../utils/postDialysisAssessmentSync';

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

const ANTICOAGULANT_OPTIONS = [
  { value: 'heparin', label: '普通肝素' },
  { value: 'lmwh', label: '低分子肝素' },
  { value: 'enoxaparin', label: '依诺肝素' },
  { value: 'bemiparin', label: '贝米肝素' },
  { value: 'nafamostat', label: '甲磺酸萘莫司他' },
  { value: 'citrate', label: '枸橼酸' },
  { value: 'none', label: '无抗凝' },
] as const;

const YES_NO_ASSESS_OPTIONS = [
  { value: 'no', label: '无' },
  { value: 'yes', label: '有' },
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

/** 低分子肝素类：首剂按透析方式叠加 IU（规程演示用） */
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

function computeLmwhFamilyFirstDoseIU(coreIU: number, mode: string | undefined, anticoagulant: string | undefined): number {
  if (!LMWH_FAMILY.has(anticoagulant ?? '')) return coreIU;
  if (mode === 'HDF') return coreIU + 200;
  if (mode === 'HD_HP') return coreIU + 500;
  return coreIU;
}

type BasicParamsStored = Partial<{
  frequencyPreset: string;
  frequencyCustom: string;
  duration: number;
  mode: string;
  modeOther: string;
  dialyzer: string;
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
}>;

const BASIC_PARAM_KEYS = [
  'frequencyPreset',
  'frequencyCustom',
  'duration',
  'mode',
  'modeOther',
  'dialyzer',
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
] as const satisfies readonly (keyof BasicParamsStored)[];

function loadStoredBasicParams(): BasicParamsStored {
  return loadPrescriptionBasicParamsFromStorage() as BasicParamsStored;
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
    <div>
      <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 3, fontWeight: 500 }}>{label}</div>
      <div
        style={{
          padding: '5px 10px',
          background: bg,
          border: `1px solid ${border}`,
          borderRadius: 6,
          fontSize: 14,
          fontWeight: 700,
          color,
          fontFamily: mono ? 'DM Mono, monospace' : 'inherit',
        }}
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
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
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

const DIALYZER_OPTIONS = getDialyzerSelectOptions();

export default function PrescriptionWorkspacePage() {
  const [form] = Form.useForm();
  const [selectedPatient, setSelectedPatient] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [postSyncMeta, setPostSyncMeta] = useState<PostDialysisSyncPayload | null>(null);
  const skipPersistRef = useRef(false);
  const baselineDryWeightRef = useRef<number | null>(null);
  const heparinCoreIURef = useRef(0);
  const ufUserEditedRef = useRef(false);
  const heparinUserEditedRef = useRef(false);
  const ufProgrammaticRef = useRef(false);
  const heparinProgrammaticRef = useRef(false);

  const frequencyPreset = Form.useWatch('frequencyPreset', form);
  const modeWatched = Form.useWatch('mode', form);
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
  const naWatched = Form.useWatch('na', form);
  const kWatched = Form.useWatch('k', form);
  const caWatched = Form.useWatch('ca', form);
  const dialyzerWatched = Form.useWatch('dialyzer', form);
  const preAssessSbpLive = Form.useWatch('preAssessSbp', form);
  const preAssessDbpLive = Form.useWatch('preAssessDbp', form);
  const preAssessPulseLive = Form.useWatch('preAssessPulse', form);
  const preAssessOtherLive = Form.useWatch('preAssessOther', form);
  const bloodFlowWatched = Form.useWatch('bloodFlow', form);
  const dialysateFlowWatched = Form.useWatch('dialysateFlow', form);
  const frequencyCustomWatched = Form.useWatch('frequencyCustom', form);
  const modeOtherWatched = Form.useWatch('modeOther', form);
  const heparinFirstWatched = Form.useWatch('heparinFirst', form);
  const heparinMaintWatched = Form.useWatch('heparinMaint', form);
  const tempWatched = Form.useWatch('temp', form);
  const sodiumCurveCustomWatched = Form.useWatch('sodiumCurveCustom', form);
  const naCurveStartWatched = Form.useWatch('naCurveStart', form);
  const naCurveEndWatched = Form.useWatch('naCurveEnd', form);
  const preAssessEdemaSiteWatched = Form.useWatch('preAssessEdemaSite', form);
  const preAssessBleedingDescWatched = Form.useWatch('preAssessBleedingDesc', form);

  const patientInfo = PATIENTS.find((p) => p.value === selectedPatient);

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
  const dialyzerShort = String(dialyzerWatched ?? '').replace(/^透析器\s*/, '') || '—';

  const applyPatientFormValues = useCallback(
    (patientValue: string) => {
      const base = PATIENTS.find((p) => p.value === patientValue)?.defaults;
      if (!base) return;
      const stored = loadStoredBasicParams();
      baselineDryWeightRef.current = typeof base.dryWeight === 'number' ? base.dryWeight : null;
      heparinCoreIURef.current = typeof base.heparinFirst === 'number' ? base.heparinFirst : 0;
      ufUserEditedRef.current = false;
      heparinUserEditedRef.current = false;
      skipPersistRef.current = true;
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
      window.setTimeout(() => {
        skipPersistRef.current = false;
      }, 0);
    },
    [form]
  );

  useEffect(() => {
    if (selectedPatient) {
      applyPatientFormValues(selectedPatient);
    }
  }, [selectedPatient, applyPatientFormValues]);

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
    ufUserEditedRef.current = false;
  }, [dryWeightWatched, preMachineWeightWatched, modeWatched]);

  useEffect(() => {
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
  }, [modeWatched, anticoagulantWatched]);

  useEffect(() => {
    if (heparinUserEditedRef.current) return;
    const v = computeLmwhFamilyFirstDoseIU(heparinCoreIURef.current, modeWatched, anticoagulantWatched);
    heparinProgrammaticRef.current = true;
    form.setFieldValue('heparinFirst', v);
    window.setTimeout(() => {
      heparinProgrammaticRef.current = false;
    }, 0);
  }, [modeWatched, anticoagulantWatched, form]);

  const persistBasicParamsFromForm = useCallback(() => {
    if (skipPersistRef.current) return;
    const all = form.getFieldsValue() as Record<string, unknown>;
    const subset = pickBasicParams(all);
    try {
      localStorage.setItem(PRESCRIPTION_BASIC_PARAMS_STORAGE_KEY, JSON.stringify(subset));
    } catch {
      /* ignore quota */
    }
  }, [form]);

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

  const handleConfirm = () => {
    setShowConfirm(false);
    persistBasicParamsFromForm();
    message.success('透析处方已保存，护士下次录入时将自动带入');
  };

  return (
    <PageShell fullWidth>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
          padding: '10px 0 14px',
          borderBottom: '2px solid #EDF0F7',
          marginBottom: 16,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: 16, color: '#0D1B3E' }}>透析处方</span>
            <span style={{ fontSize: 12, color: '#94A3B8' }}>{dayjs().format('YYYY年MM月DD日 dddd')}</span>
          </div>
        </div>
        <Select
          placeholder="选择患者…"
          value={selectedPatient || undefined}
          onChange={(v) => setSelectedPatient(v)}
          options={PATIENTS.map((p) => ({ value: p.value, label: p.label }))}
          style={{ width: 280 }}
          showSearch
        />
        <Button icon={<HistoryOutlined />} onClick={() => setShowHistory(true)} disabled={!selectedPatient}>
          处方历史
        </Button>
        <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} disabled={!selectedPatient}>
          保存处方
        </Button>
      </div>

      {!selectedPatient && (
        <div
          style={{
            padding: 28,
            textAlign: 'center',
            color: '#94A3B8',
            background: '#F8FAFC',
            borderRadius: 8,
            border: '1px dashed #CBD5E1',
            fontSize: 13,
          }}
        >
          请先在上方选择患者。下方摘要与「录入透析记录」第①段「患者信息 · 处方参数 · 体重超滤」使用同一套演示数据。
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
          initialValues={PATIENTS.find((p) => p.value === selectedPatient)?.defaults}
        >
          {patientInfo && (
            <div
              style={{
                background: '#fff',
                borderRadius: 10,
                border: '1px solid #E2E8F0',
                marginBottom: 12,
                overflow: 'hidden',
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 16px',
                  background: '#FAFBFC',
                  borderBottom: '1px solid #EAECF0',
                }}
              >
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    background: '#1D4ED8',
                    color: '#fff',
                    fontSize: 12,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  1
                </div>
                <span style={{ fontWeight: 600, fontSize: 14, color: '#0D1B3E', flex: 1 }}>
                  患者信息 · 处方参数 · 体重超滤（与「录入透析记录」同步）
                </span>
              </div>
              <div style={{ padding: '16px 18px' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    flexWrap: 'wrap',
                    padding: '8px 12px',
                    background: 'linear-gradient(90deg,#EFF6FF,#F0F9FF)',
                    borderRadius: 8,
                    marginBottom: 14,
                    border: '1px solid #BFDBFE',
                  }}
                >
                  <span style={{ fontWeight: 700, fontSize: 16, color: '#1E40AF' }}>
                    {patientInfo.label.split(' — ')[0]}
                  </span>
                  <Tag color="blue">{shiftCodeToChinese(shiftWatched)}</Tag>
                  <Tag color="geekblue">{machineNoWatched ?? patientInfo.demo.preAssessment.machineNo}</Tag>
                  <Tag color={patientInfo.demo.vascular.accessType === 'AVF' || patientInfo.demo.vascular.accessType === 'AVG' ? 'green' : 'orange'}>
                    {patientInfo.demo.vascular.accessType}
                  </Tag>
                  <span style={{ fontSize: 12, color: '#64748B' }}>
                    开立医师：<strong style={{ color: '#0D1B3E' }}>{patientInfo.demo.prescribingDoctorName}</strong>
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: '#7B92BC' }}>
                    下方编辑后此处实时更新
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 16 }}>
                  <div
                    style={{
                      padding: 12,
                      background: '#F8FAFC',
                      borderRadius: 8,
                      border: '1px solid #DBEAFE',
                    }}
                  >
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#1D4ED8', marginBottom: 8, letterSpacing: 0.5 }}>
                      基本参数 · 透析处方
                    </div>
                    <div style={{ fontSize: 10, color: '#94A3B8', marginBottom: 10 }}>方案与体外循环</div>
                    <RxGrid cols={3} gap={10}>
                      <RxReadonlyValue label="透析频次" value={frequencyLabel} />
                      <RxReadonlyValue label="透析方式" value={modeDisplay} />
                      <RxReadonlyValue label="标准时长" value={`${durationWatched ?? '—'} h`} />
                      <RxReadonlyValue label="血流速" value={`${bloodFlowWatched ?? '—'} mL/min`} />
                      <RxReadonlyValue label="透析液流速" value={`${dialysateFlowWatched ?? '—'} mL/min`} />
                      <RxReadonlyValue label="透析器" value={dialyzerShort} />
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
                  <div
                    style={{
                      padding: 12,
                      background: '#F8FAFC',
                      borderRadius: 8,
                      border: '1px solid #DBEAFE',
                    }}
                  >
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#1D4ED8', marginBottom: 8, letterSpacing: 0.5 }}>
                      基本参数 · 透前评估
                    </div>
                    <div style={{ fontSize: 10, color: '#94A3B8', marginBottom: 10 }}>生命体征与临床</div>
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

                <div
                  style={{
                    padding: '12px 14px',
                    background: '#FFFDF0',
                    borderRadius: 8,
                    border: '1px solid #FDE68A',
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#92400E', marginBottom: 10, letterSpacing: 0.5 }}>
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
            bordered={false}
            style={{ background: 'transparent' }}
            defaultActiveKey={['rx']}
            items={[
              {
                key: 'rx',
                label: (
                  <span style={{ fontWeight: 600, fontSize: 14 }}>
                    ② 处方与透前评估（频次 · 方式 · 抗凝 · 干体重 · 透前）
                  </span>
                ),
                children: (
                  <div>
          {/* 基本透析参数 */}
          <Card
            style={{ marginBottom: 16, border: '1px solid #DBEAFE' }}
            styles={{ header: { background: '#FAFCFF', borderBottom: '1px solid #DBEAFE' } }}
            title={<span style={{ fontWeight: 600, color: '#0369A1' }}>📋 基本透析参数</span>}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: '#0369A1', marginBottom: 12 }}>透析方案与频次</div>
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
              <Form.Item label="透析方式" name="mode" rules={[{ required: true, message: '请选择透析方式' }]}>
                <Select options={[...MODE_OPTIONS]} />
              </Form.Item>
              {modeWatched === 'other' && (
                <Form.Item label="透析方式说明" name="modeOther" rules={[{ required: true, message: '请填写透析方式' }]}>
                  <Input placeholder="请描述具体透析方式" />
                </Form.Item>
              )}
              <Form.Item label="透析器" name="dialyzer" rules={[{ required: true, message: '请选择透析器' }]}>
                <Select options={DIALYZER_OPTIONS} showSearch optionFilterProp="label" placeholder="从耗材目录选择" />
              </Form.Item>
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
            <div className="grid-4" style={{ gap: 16, marginBottom: 16 }}>
              <Form.Item
                label="首剂"
                name="heparinFirst"
                extra={
                  LMWH_FAMILY.has(anticoagulantWatched ?? '')
                    ? '低分子肝素类：HDF 在基础首剂上 +200 IU，HD+HP +500 IU（可改）'
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
            {baselineDryWeightRef.current != null &&
            dryWeightWatched !== undefined &&
            Number(dryWeightWatched) !== baselineDryWeightRef.current ? (
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
            style={{ marginBottom: 20, border: '1px solid #DBEAFE' }}
            styles={{ header: { background: '#FAFCFF', borderBottom: '1px solid #DBEAFE' } }}
            title={<span style={{ fontWeight: 600, color: '#0369A1' }}>📊 透前评估</span>}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: '#0369A1', marginBottom: 12 }}>生命体征</div>
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
            <div style={{ fontSize: 13, fontWeight: 600, color: '#0369A1', marginBottom: 12 }}>临床与症状</div>
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
            <div style={{ fontSize: 13, fontWeight: 600, color: '#0369A1', marginBottom: 12 }}>上机安排</div>
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
              <Form.Item label="默认机器编号" name="machineNo">
                <Input placeholder="如：5号机" />
              </Form.Item>
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
            style={{ marginBottom: 20, border: '1px solid #DBEAFE' }}
            styles={{ header: { background: '#FAFCFF', borderBottom: '1px solid #DBEAFE' } }}
            title={<span style={{ fontWeight: 600, color: '#0369A1' }}>🧪 透析液参数</span>}
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
            <div style={{ fontSize: 13, fontWeight: 600, color: '#0369A1', marginBottom: 12 }}>可调钠曲线</div>
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
            style={{ marginBottom: 20, border: '1px solid #DBEAFE' }}
            styles={{ header: { background: '#FAFCFF', borderBottom: '1px solid #DBEAFE' } }}
            title={<span style={{ fontWeight: 600, color: '#0369A1' }}>📉 透析后评估（医生填写）</span>}
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
            style={{ marginBottom: 20, border: '1px solid #DBEAFE' }}
            styles={{ header: { background: '#FAFCFF', borderBottom: '1px solid #DBEAFE' } }}
            title={<span style={{ fontWeight: 600, color: '#0369A1' }}>📝 处方备注</span>}
          >
            <Form.Item name="notes" noStyle>
              <Input.TextArea rows={2} placeholder="特殊说明（选填）" />
            </Form.Item>
          </Card>
                  </div>
                ),
              },
            ]}
          />

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-end',
              flexWrap: 'wrap',
              gap: 20,
              marginTop: 8,
            }}
          >
            <div style={{ flex: '1 1 280px', minWidth: 0 }}>
              <span style={{ fontSize: 12, color: '#7B92BC' }}>
                保存与顶部按钮相同；基本参数可本地记忆。
              </span>
              <div className="flex gap-8" style={{ marginTop: 12 }}>
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
                <Input placeholder="手写或电子签名" style={{ width: 220 }} />
              </Form.Item>
              <div
                style={{
                  fontSize: 14,
                  lineHeight: '22px',
                  color: '#0D1B3E',
                  fontWeight: 500,
                  width: 220,
                  marginLeft: 'auto',
                }}
              >
                生成日期：{dayjs().format('YYYY年MM月DD日')}
              </div>
            </div>
          </div>
        </Form>
      )}

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
      >
        <div style={{ padding: '8px 0', fontSize: 14, color: '#0D1B3E', lineHeight: 1.8 }}>
          <div>
            即将保存对 <strong>{PATIENTS.find((p) => p.value === selectedPatient)?.label.split(' — ')[0]}</strong> 的透析处方修改。
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
