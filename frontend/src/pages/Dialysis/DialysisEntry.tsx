/**
 * 透析记录录入核心页（处方带入、医嘱、Kt/V、生命体征等）
 * 主要作用：护士/授权角色完成当次透析全流程数据录入与保存。
 * 主要功能：选患者与日期；自动加载处方与医嘱；并发症与凝血；Kt/V 计算与预警联动。
 */
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Form, Input, InputNumber, Select, Button, Checkbox,
  DatePicker, message, Alert, Radio, Tag, Tooltip, Modal, Table, Space,
} from 'antd';
import {
  SaveOutlined, PlusOutlined,
  DeleteOutlined, ClockCircleOutlined, CheckCircleFilled,
  WarningFilled, InfoCircleFilled, EditOutlined, CloseOutlined,
  FileTextOutlined, PrinterOutlined, SearchOutlined, HistoryOutlined,
} from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import PageShell from '../../components/PageShell/PageShell';
import { DIALYSIS_DEMO_PATIENTS, type DialysisDemoPatient } from '../../constants/dialysisDemoPatients';
import {
  dialysisApi,
  parsePrepareDialysisResponse,
  type CreateDialysisPayload,
  type DialysisRecordListRow,
  type DialysisRecordDetail,
  type PrepareDialysisData,
  type OrderForSession,
} from '../../api/dialysis';
import { patientsApi, type Patient } from '../../api/patients';
import { scheduleApi, type TodaySchedulePatientRow } from '../../api/schedule';
import {
  shiftCodeToChinese,
  computePrescriptionUltrafiltrationMl,
  dialyzerShortFromFormValue,
  anticoagulantLabelFromCode,
  frequencyPresetLabel,
  dialysisModeLabel,
  formatSodiumCurveSummary,
  yesNoAssessLabel,
  loadPrescriptionBasicParamsFromStorage,
  splitPrescriptionNotesFromDb,
} from '../../utils/prescriptionFormFromDemo';
import {
  readPostDialysisSync,
  writePostDialysisSync,
  POST_DIALYSIS_SYNC_EVENT,
  type PostDialysisSyncPayload,
} from '../../utils/postDialysisAssessmentSync';
import { useAuthStore } from '../../stores/authStore';
import AnomalyAnalysisModal from '../../components/AnomalyAnalysisModal/AnomalyAnalysisModal';
import type { AnomalyType } from '../../utils/anomalyAnalysis';
import {
  HD_PRESCRIPTION_SAVED_EVENT,
  HD_LONG_TERM_ORDER_SAVED_EVENT,
  type PrescriptionSavedDetail,
  type LongTermOrderSavedDetail,
} from '../../constants/prescriptionSyncEvents';
import ordersApi, { FREQ_LABELS, EXEC_TIMING_LABELS, type LongTermOrder } from '../../api/orders';
import {
  describeDialysisOrderFrequencyForSession,
  describeFrequencyDetailForOrder,
} from '../../utils/longTermOrderScheduleText';
import {
  DIALYSIS_ENTRY_DRAFT_VERSION,
  type DialysisEntryDraftSnapshot,
  dialysisEntryDraftStorageKey,
  loadDialysisEntryDraft,
  removeDialysisEntryDraft,
  saveDialysisEntryDraft,
  serializeFormValuesForDraft,
} from '../../utils/dialysisEntryDraft';
import { calcSpKtv, calcUrr } from '../../utils/ktv';

// ── 演示数据（与透析处方工作台共用） ─────────────────────────
const PATIENTS_LIST = DIALYSIS_DEMO_PATIENTS;

const COMPLICATIONS = [
  { value: 'hypotension',  label: '低血压',       emergency: false },
  { value: 'cramp',        label: '肌肉痉挛',     emergency: false },
  { value: 'nausea',       label: '恶心/呕吐',    emergency: false },
  { value: 'headache',     label: '头痛',         emergency: false },
  { value: 'fever',        label: '发热/寒战',    emergency: false },
  { value: 'pruritus',     label: '皮肤瘙痒',     emergency: false },
  { value: 'coagulation',  label: '体外循环凝血', emergency: false },
  { value: 'air_embolism', label: '空气栓塞',     emergency: true },
  { value: 'blood_leak',   label: '透析器漏血',   emergency: true },
  { value: 'hemolysis',    label: '急性溶血',     emergency: true },
];

type FieldDef = {
  key: string;
  label: string;
  required?: boolean;
  placeholder?: string;
} & (
  | { type: 'text' | 'textarea' | 'number' }
  | { type: 'select' | 'radio'; options: { value: string; label: string }[] }
  | {
    type: 'checkbox-group';
    options: {
      value: string;
      label: string;
      inputKey?: string;
      inputUnit?: string;
      inputPlaceholder?: string;
      inputMin?: number;
      inputMax?: number;
      inputStep?: number;
      inputPrecision?: number;
      inputRequiredMessage?: string;
    }[];
  }
);

type ComplicationConfig = {
  title: string;
  color: string;
  fields: FieldDef[];
};

const COMPLICATION_CONFIG: Record<string, ComplicationConfig> = {
  hypotension: {
    title: '低血压处理记录',
    color: '#DC2626',
    fields: [
      { key: 'occurrenceTime', label: '发生时间', type: 'text', placeholder: '如：14:30', required: true },
      { key: 'eventBp', label: '发生时血压', type: 'text', placeholder: '如：85/50 mmHg', required: true },
      { key: 'measures', label: '处理措施', type: 'checkbox-group', required: true, options: [
        { value: 'stop_uf', label: '停超滤' },
        { value: 'trendelenburg', label: '头低脚高位' },
        { value: 'saline_200', label: '输注生理盐水 200mL' },
        { value: 'slow_blood', label: '降低血流速' },
        { value: 'reduce_temp', label: '降低透析液温度' },
        {
          value: 'iv_50pct_glucose',
          label: '静注50%葡萄糖注射液',
          inputKey: 'glucoseDoseMl',
          inputUnit: 'mL',
          inputPlaceholder: '剂量',
          inputMin: 0,
          inputStep: 1,
          inputPrecision: 0,
          inputRequiredMessage: '请填写50%葡萄糖注射液剂量',
        },
        { value: 'other', label: '其他（见备注）' },
      ]},
      { key: 'afterBp', label: '处理后血压', type: 'text', placeholder: '如：110/70 mmHg' },
      { key: 'doctorNotified', label: '通知医生', type: 'radio', options: [
        { value: 'yes', label: '已通知' }, { value: 'no', label: '无需通知' },
      ]},
      { key: 'remark', label: '备注', type: 'textarea', placeholder: '其他处理措施或观察记录…' },
      { key: 'nurse', label: '处理护士签名', type: 'text', required: true },
    ],
  },
  cramp: {
    title: '肌肉痉挛处理记录',
    color: '#D97706',
    fields: [
      { key: 'occurrenceTime', label: '发生时间', type: 'text', placeholder: '如：14:30', required: true },
      { key: 'location', label: '痉挛部位', type: 'select', required: true, options: [
        { value: 'lower_limb', label: '下肢' },
        { value: 'upper_limb', label: '上肢' },
        { value: 'abdomen', label: '腹部' },
        { value: 'other', label: '其他' },
      ]},
      { key: 'measures', label: '处理措施', type: 'checkbox-group', options: [
        { value: 'reduce_uf', label: '减少超滤速率' },
        { value: 'saline_100', label: '输注生理盐水 100mL' },
        { value: 'massage', label: '局部按摩' },
        { value: 'heat', label: '局部热敷' },
        { value: 'hypertonic', label: '输注高渗盐水' },
        {
          value: 'iv_50pct_glucose',
          label: '静注50%葡萄糖注射液',
          inputKey: 'glucoseDoseMl',
          inputUnit: 'mL',
          inputPlaceholder: '剂量',
          inputMin: 0,
          inputStep: 1,
          inputPrecision: 0,
          inputRequiredMessage: '请填写50%葡萄糖注射液剂量',
        },
        { value: 'other', label: '其他（见备注）' },
      ]},
      { key: 'doctorNotified', label: '通知医生', type: 'radio', options: [
        { value: 'yes', label: '已通知' }, { value: 'no', label: '无需通知' },
      ]},
      { key: 'remark', label: '备注', type: 'textarea', placeholder: '其他处理情况…' },
      { key: 'nurse', label: '处理护士签名', type: 'text', required: true },
    ],
  },
  nausea: {
    title: '恶心/呕吐处理记录',
    color: '#D97706',
    fields: [
      { key: 'occurrenceTime', label: '发生时间', type: 'text', placeholder: '如：14:30', required: true },
      { key: 'vomitAmount', label: '呕吐量估计', type: 'text', placeholder: '如：约50mL，或"无呕吐"' },
      { key: 'measures', label: '处理措施', type: 'checkbox-group', options: [
        { value: 'slow_blood', label: '降低血流速' },
        { value: 'reduce_uf', label: '减少超滤量' },
        { value: 'head_up', label: '头部抬高' },
        { value: 'antiemetic', label: '遵医嘱给予止吐药' },
        {
          value: 'iv_50pct_glucose',
          label: '静注50%葡萄糖注射液',
          inputKey: 'glucoseDoseMl',
          inputUnit: 'mL',
          inputPlaceholder: '剂量',
          inputMin: 0,
          inputStep: 1,
          inputPrecision: 0,
          inputRequiredMessage: '请填写50%葡萄糖注射液剂量',
        },
        { value: 'other', label: '其他（见备注）' },
      ]},
      { key: 'doctorNotified', label: '通知医生', type: 'radio', options: [
        { value: 'yes', label: '已通知' }, { value: 'no', label: '无需通知' },
      ]},
      { key: 'remark', label: '备注', type: 'textarea', placeholder: '其他观察记录…' },
      { key: 'nurse', label: '处理护士签名', type: 'text', required: true },
    ],
  },
  headache: {
    title: '头痛处理记录',
    color: '#D97706',
    fields: [
      { key: 'occurrenceTime', label: '发生时间', type: 'text', placeholder: '如：14:30', required: true },
      { key: 'severity', label: '头痛程度', type: 'radio', required: true, options: [
        { value: 'mild', label: '轻度' },
        { value: 'moderate', label: '中度' },
        { value: 'severe', label: '重度' },
      ]},
      { key: 'measures', label: '处理措施', type: 'checkbox-group', options: [
        { value: 'reduce_na', label: '降低透析液钠浓度' },
        { value: 'slow_blood', label: '降低血流速' },
        { value: 'analgesic', label: '遵医嘱给予镇痛药' },
        { value: 'observe', label: '加强观察' },
        {
          value: 'iv_50pct_glucose',
          label: '静注50%葡萄糖注射液',
          inputKey: 'glucoseDoseMl',
          inputUnit: 'mL',
          inputPlaceholder: '剂量',
          inputMin: 0,
          inputStep: 1,
          inputPrecision: 0,
          inputRequiredMessage: '请填写50%葡萄糖注射液剂量',
        },
        { value: 'other', label: '其他（见备注）' },
      ]},
      { key: 'doctorNotified', label: '通知医生', type: 'radio', options: [
        { value: 'yes', label: '已通知' }, { value: 'no', label: '无需通知' },
      ]},
      { key: 'remark', label: '备注', type: 'textarea', placeholder: '其他处理及观察…' },
      { key: 'nurse', label: '处理护士签名', type: 'text', required: true },
    ],
  },
  fever: {
    title: '发热/寒战处理记录',
    color: '#DC2626',
    fields: [
      { key: 'occurrenceTime', label: '发生时间', type: 'text', placeholder: '如：14:30', required: true },
      { key: 'temperature', label: '体温（℃）', type: 'number', placeholder: '如：38.5', required: true },
      { key: 'symptoms', label: '伴随症状', type: 'checkbox-group', options: [
        { value: 'chills', label: '寒战' },
        { value: 'sweat', label: '大汗' },
        { value: 'fatigue', label: '乏力' },
        { value: 'other', label: '其他' },
      ]},
      { key: 'measures', label: '处理措施', type: 'checkbox-group', options: [
        { value: 'stop_dialysis', label: '停止透析' },
        { value: 'blood_culture', label: '遵医嘱抽血培养' },
        { value: 'antipyretic', label: '遵医嘱给予退热药' },
        { value: 'warm', label: '保暖' },
        { value: 'observe', label: '加强观察' },
        { value: 'other', label: '其他（见备注）' },
      ]},
      { key: 'doctorNotified', label: '通知医生', type: 'radio', required: true, options: [
        { value: 'yes', label: '已通知' }, { value: 'no', label: '无需通知' },
      ]},
      { key: 'remark', label: '备注', type: 'textarea', placeholder: '其他处理或体温变化记录…' },
      { key: 'nurse', label: '处理护士签名', type: 'text', required: true },
    ],
  },
  pruritus: {
    title: '皮肤瘙痒处理记录',
    color: '#7C3AED',
    fields: [
      { key: 'occurrenceTime', label: '发生时间', type: 'text', placeholder: '如：14:30', required: true },
      { key: 'location', label: '瘙痒部位', type: 'text', placeholder: '如：背部、四肢等' },
      { key: 'measures', label: '处理措施', type: 'checkbox-group', options: [
        { value: 'antihistamine', label: '遵医嘱给予抗组胺药' },
        { value: 'cool_compress', label: '局部冷敷' },
        { value: 'observe', label: '加强观察' },
        { value: 'other', label: '其他（见备注）' },
      ]},
      { key: 'doctorNotified', label: '通知医生', type: 'radio', options: [
        { value: 'yes', label: '已通知' }, { value: 'no', label: '无需通知' },
      ]},
      { key: 'remark', label: '备注', type: 'textarea', placeholder: '其他情况…' },
      { key: 'nurse', label: '处理护士签名', type: 'text', required: true },
    ],
  },
  coagulation: {
    title: '体外循环凝血处理记录',
    color: '#DC2626',
    fields: [
      { key: 'occurrenceTime', label: '发生时间', type: 'text', placeholder: '如：14:30', required: true },
      { key: 'grade', label: '凝血分级', type: 'radio', required: true, options: [
        { value: '1', label: 'Ⅰ级（<20%变黑）' },
        { value: '2', label: 'Ⅱ级（静脉壶明显）' },
        { value: '3', label: 'Ⅲ级（>50%或停机）' },
      ]},
      { key: 'isCompleteStopped', label: '是否停机更换管路', type: 'radio', required: true, options: [
        { value: 'yes', label: '是（完全凝血，计入质控）' },
        { value: 'no', label: '否' },
      ]},
      { key: 'measures', label: '处理措施', type: 'checkbox-group', options: [
        { value: 'increase_heparin', label: '追加肝素剂量' },
        { value: 'saline_flush', label: '生理盐水冲管' },
        { value: 'replace_circuit', label: '更换管路/透析器' },
        { value: 'stop_dialysis', label: '终止透析' },
        { value: 'other', label: '其他（见备注）' },
      ]},
      { key: 'doctorNotified', label: '通知医生', type: 'radio', required: true, options: [
        { value: 'yes', label: '已通知' }, { value: 'no', label: '无需通知' },
      ]},
      { key: 'remark', label: '备注', type: 'textarea', placeholder: '凝血情况详细描述…' },
      { key: 'nurse', label: '处理护士签名', type: 'text', required: true },
    ],
  },
  air_embolism: {
    title: '空气栓塞应急处理记录',
    color: '#DC2626',
    fields: [
      { key: 'occurrenceTime', label: '发生时间', type: 'text', placeholder: '如：14:30', required: true },
      { key: 'symptoms', label: '患者症状', type: 'checkbox-group', required: true, options: [
        { value: 'cough', label: '咳嗽' },
        { value: 'dyspnea', label: '呼吸困难' },
        { value: 'chest_pain', label: '胸痛' },
        { value: 'cyanosis', label: '发绀' },
        { value: 'unconscious', label: '意识障碍' },
      ]},
      { key: 'emergencyMeasures', label: '应急处理措施', type: 'checkbox-group', required: true, options: [
        { value: 'stop_blood_pump', label: '立即关闭血泵' },
        { value: 'clamp_tube', label: '钳夹静脉管路' },
        { value: 'left_lateral', label: '取左侧卧位+头低脚高' },
        { value: 'oxygen', label: '高流量吸氧（10L/min）' },
        { value: 'call_doctor', label: '呼叫医生/抢救' },
        { value: 'other', label: '其他（见备注）' },
      ]},
      { key: 'doctorArrivalTime', label: '医生到达时间', type: 'text', placeholder: '如：14:35' },
      { key: 'outcome', label: '处置结果', type: 'select', required: true, options: [
        { value: 'stable', label: '病情稳定' },
        { value: 'transferred', label: '转科处理' },
        { value: 'emergency', label: '紧急抢救' },
      ]},
      { key: 'remark', label: '备注', type: 'textarea', placeholder: '事件经过详细记录…' },
      { key: 'nurse', label: '处理护士签名', type: 'text', required: true },
    ],
  },
  blood_leak: {
    title: '透析器漏血处理记录',
    color: '#DC2626',
    fields: [
      { key: 'occurrenceTime', label: '发生时间', type: 'text', placeholder: '如：14:30', required: true },
      { key: 'detectionMethod', label: '发现方式', type: 'radio', options: [
        { value: 'alarm', label: '机器漏血报警' },
        { value: 'visual', label: '肉眼观察' },
      ]},
      { key: 'replacedDialyzer', label: '是否更换透析器', type: 'radio', required: true, options: [
        { value: 'yes', label: '是（已更换）' },
        { value: 'no', label: '否（停止透析）' },
      ]},
      { key: 'measures', label: '处理措施', type: 'checkbox-group', options: [
        { value: 'stop_blood_pump', label: '停止血泵' },
        { value: 'replace_dialyzer', label: '更换透析器' },
        { value: 'stop_dialysis', label: '终止本次透析' },
        { value: 'blood_test', label: '遵医嘱抽血检查' },
        { value: 'other', label: '其他（见备注）' },
      ]},
      { key: 'doctorNotified', label: '通知医生', type: 'radio', required: true, options: [
        { value: 'yes', label: '已通知' }, { value: 'no', label: '无需通知' },
      ]},
      { key: 'remark', label: '备注', type: 'textarea', placeholder: '事件经过及处理结果…' },
      { key: 'nurse', label: '处理护士签名', type: 'text', required: true },
    ],
  },
  hemolysis: {
    title: '急性溶血应急处理记录',
    color: '#DC2626',
    fields: [
      { key: 'occurrenceTime', label: '发生时间', type: 'text', placeholder: '如：14:30', required: true },
      { key: 'symptoms', label: '患者症状', type: 'checkbox-group', required: true, options: [
        { value: 'chest_pain', label: '胸痛' },
        { value: 'back_pain', label: '腰背痛' },
        { value: 'dyspnea', label: '呼吸困难' },
        { value: 'nausea', label: '恶心呕吐' },
        { value: 'fever', label: '发热' },
        { value: 'hypotension', label: '低血压' },
      ]},
      { key: 'plasmaColor', label: '静脉血颜色', type: 'select', required: true, options: [
        { value: 'pink', label: '粉红色（轻度溶血）' },
        { value: 'red', label: '红色（中度溶血）' },
        { value: 'dark_red', label: '暗红/棕红（重度溶血）' },
      ]},
      { key: 'emergencyMeasures', label: '应急处置', type: 'checkbox-group', required: true, options: [
        { value: 'stop_return', label: '停止回血（丢弃体外血液）' },
        { value: 'stop_dialysis', label: '立即终止透析' },
        { value: 'oxygen', label: '给予吸氧' },
        { value: 'blood_sample', label: '抽血样送检' },
        { value: 'call_doctor', label: '呼叫医生/抢救' },
        { value: 'other', label: '其他（见备注）' },
      ]},
      { key: 'doctorArrivalTime', label: '医生到达时间', type: 'text', placeholder: '如：14:35' },
      { key: 'remark', label: '备注', type: 'textarea', placeholder: '事件经过详细记录…', required: true },
      { key: 'nurse', label: '处理护士签名', type: 'text', required: true },
    ],
  },
};

const PENDING_ORDERS = [
  { key: '1', drug: '重组人促红素注射液 6000 IU', detail: '皮下注射 · tiw · 今日应执行', executed: false },
  { key: '2', drug: '蔗糖铁注射液 200mg', detail: '静脉输注（透析中）· qw · 上次 2026-03-12', executed: false },
];

/** 与长期医嘱页「具体执行」同源，并按床旁核对习惯将「透析前/中/后」排在频次说明附近 */
function formatOrderSessionDetail(
  o: OrderForSession,
  prescriptionSessionsPerWeek?: number | null,
): string {
  const parts: string[] = [];
  if (o.route?.trim()) parts.push(o.route.trim());
  const freqKey = String(o.frequency ?? '');
  const fl = FREQ_LABELS[freqKey] || freqKey;
  const scheduleText = describeDialysisOrderFrequencyForSession(
    freqKey,
    o.frequency_detail ?? null,
    prescriptionSessionsPerWeek,
  );
  parts.push(`${fl}（${scheduleText}）`);
  const timing = typeof o.execute_timing === 'string' ? o.execute_timing.trim() : '';
  if (timing) {
    parts.push(`执行时段：${EXEC_TIMING_LABELS[timing] || timing}`);
  }
  const doseText = [o.dose != null && o.dose !== '' ? String(o.dose) : '', o.dose_unit ?? '']
    .join(' ')
    .trim();
  if (doseText) parts.push(doseText);
  if (o.notes?.trim()) parts.push(o.notes.trim());
  return parts.join(' · ');
}

const BEDSIDE_TIMING_SORT: Record<string, number> = {
  pre_dialysis: 0,
  during_dialysis: 1,
  post_dialysis: 2,
  anytime: 3,
};

/** 主药按「床旁执行时段」排序，子药紧随主药（与长期医嘱单展示一致） */
function sortSessionsForBedsideDisplay(sessions: OrderForSession[]): OrderForSession[] {
  if (!sessions.length) return [];
  const byParent = new Map<string, OrderForSession[]>();
  for (const o of sessions) {
    if (o.parent_order_id) {
      const pid = String(o.parent_order_id);
      if (!byParent.has(pid)) byParent.set(pid, []);
      byParent.get(pid)!.push(o);
    }
  }
  const roots = sessions.filter((o) => !o.parent_order_id);
  const sortedRoots = [...roots].sort((a, b) => {
    const ta = BEDSIDE_TIMING_SORT[String(a.execute_timing || '')] ?? 99;
    const tb = BEDSIDE_TIMING_SORT[String(b.execute_timing || '')] ?? 99;
    if (ta !== tb) return ta - tb;
    return String(a.id).localeCompare(String(b.id));
  });
  const out: OrderForSession[] = [];
  const seen = new Set<string>();
  for (const r of sortedRoots) {
    out.push(r);
    seen.add(r.id);
    const ch = [...(byParent.get(String(r.id)) ?? [])].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    for (const c of ch) {
      out.push(c);
      seen.add(c.id);
    }
  }
  for (const o of sessions) {
    if (!seen.has(o.id)) out.push(o);
  }
  return out;
}

/** 今日医嘱执行确认：组合医嘱多行合并为一条卡片展示 */
type DialysisOrderExecRow = {
  key: string;
  drug: string;
  detail: string;
  alreadyExecuted: boolean;
  isComboChild: boolean;
};

type DialysisOrderExecGroup = {
  groupId: string;
  isCombo: boolean;
  rows: DialysisOrderExecRow[];
};

function buildDialysisOrderExecutionGroups(
  sessions: OrderForSession[],
  prescriptionSessionsPerWeek?: number | null,
): DialysisOrderExecGroup[] {
  /** 先按床旁执行时段排主药，再挂子药；避免仅按 id 排序打乱「透析前→中→后」 */
  const sorted = sortSessionsForBedsideDisplay(sessions);
  const byParent = new Map<string, OrderForSession[]>();
  for (const o of sorted) {
    if (!o.parent_order_id) continue;
    const pid = o.parent_order_id;
    if (!byParent.has(pid)) byParent.set(pid, []);
    byParent.get(pid)!.push(o);
  }
  const roots = sorted.filter((o) => !o.parent_order_id);
  const assigned = new Set<string>();
  const groups: DialysisOrderExecGroup[] = [];

  for (const root of roots) {
    const children = [...(byParent.get(root.id) ?? [])].sort((a, b) =>
      String(a.id).localeCompare(String(b.id)),
    );
    const rows: DialysisOrderExecRow[] = [
      {
        key: root.id,
        drug: (root.drug_name || '（未命名药品）').trim(),
        detail: formatOrderSessionDetail(root, prescriptionSessionsPerWeek),
        alreadyExecuted: root.alreadyExecuted,
        isComboChild: false,
      },
      ...children.map((ch) => ({
        key: ch.id,
        drug: (ch.drug_name || '（未命名药品）').trim(),
        detail: formatOrderSessionDetail(ch, prescriptionSessionsPerWeek),
        alreadyExecuted: ch.alreadyExecuted,
        isComboChild: true,
      })),
    ];
    rows.forEach((r) => assigned.add(r.key));
    groups.push({
      groupId: root.id,
      isCombo: children.length > 0,
      rows,
    });
  }

  for (const o of sorted) {
    if (assigned.has(o.id)) continue;
    groups.push({
      groupId: o.id,
      isCombo: false,
      rows: [
        {
          key: o.id,
          drug: (o.drug_name || '（未命名药品）').trim(),
          detail: formatOrderSessionDetail(o, prescriptionSessionsPerWeek),
          alreadyExecuted: o.alreadyExecuted,
          isComboChild: !!o.parent_order_id,
        },
      ],
    });
    assigned.add(o.id);
  }

  return groups;
}

/** 组合医嘱：主药与子药共用同一勾选状态（与床旁一次确认一致） */
function buildInitialOrdersMapFromSessions(
  list: OrderForSession[],
  prescriptionSessionsPerWeek?: number | null,
): Record<string, boolean> {
  const byId = new Map(list.map((o) => [o.id, o]));
  const groups = buildDialysisOrderExecutionGroups(list, prescriptionSessionsPerWeek);
  const out: Record<string, boolean> = {};
  for (const g of groups) {
    if (g.isCombo) {
      const checked = g.rows.every((r) => !!byId.get(r.key)?.alreadyExecuted);
      for (const r of g.rows) out[r.key] = checked;
    } else {
      const r = g.rows[0];
      out[r.key] = !!byId.get(r.key)?.alreadyExecuted;
    }
  }
  return out;
}

/** 恢复草稿时与当前服务端医嘱 id 对齐，忽略已删除的医嘱勾选 */
function mergeDraftOrdersWithSessions(
  list: OrderForSession[] | undefined,
  draft: Record<string, boolean>,
  prescriptionSessionsPerWeek?: number | null,
): Record<string, boolean> {
  if (!list?.length) return { ...draft };
  const base = buildInitialOrdersMapFromSessions(list, prescriptionSessionsPerWeek);
  const valid = new Set(list.map((o) => o.id));
  const out = { ...base };
  for (const k of Object.keys(draft)) {
    if (valid.has(k)) out[k] = draft[k];
  }
  return out;
}

type VitalSignRow = { id: string; time: string; values: Record<string, string> };

/** 生命体征行：除签名外任一有内容即视为「已填数据」，此时再自动带填写人签名 */
const VITAL_SIGN_DATA_KEYS = ['sbp', 'dbp', 'pulse', 'ap', 'vp', 'tmp', 'bloodflow', 'remark'] as const;

function vitalSignRowHasData(values: Record<string, string>): boolean {
  return VITAL_SIGN_DATA_KEYS.some((k) => String(values[k] ?? '').trim() !== '');
}

function createVitalSignRow(): VitalSignRow {
  const now = dayjs();
  return {
    id: `vital-${now.valueOf()}-${Math.random().toString(36).slice(2, 7)}`,
    time: now.format('HH:mm'),
    values: {},
  };
}

function toFixedDateFromAny(raw: string | null | undefined): Dayjs | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const short = text.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(short) && dayjs(short, 'YYYY-MM-DD', true).isValid()) {
    return dayjs(short).startOf('day');
  }
  const parsed = dayjs(text);
  return parsed.isValid() ? parsed.startOf('day') : null;
}

function toHHmm(raw: string | null | undefined): string {
  const text = String(raw ?? '').trim();
  if (!text) return dayjs().format('HH:mm');
  const parsed = dayjs(text);
  if (parsed.isValid()) return parsed.format('HH:mm');
  const m = text.match(/(\d{1,2}:\d{2})/);
  if (!m) return dayjs().format('HH:mm');
  return m[1].padStart(5, '0');
}

const DIALYSIS_SHIFT_LABELS: Record<string, string> = {
  morning: '早班',
  afternoon: '中班',
  evening: '晚班',
};

function shiftLabelFromRecord(shift: string | null | undefined): string {
  const key = String(shift ?? '').trim().toLowerCase();
  return DIALYSIS_SHIFT_LABELS[key] ?? String(shift ?? '—');
}

function zoneLabelFromPatient(zone: string | null | undefined): string {
  if (zone === 'hbv') return '乙肝区';
  if (zone === 'hcv') return '丙肝区';
  if (zone === 'observation') return '观察区';
  if (zone === 'last_shift') return '末班区';
  return '普通区';
}

function buildHistoryPatientOptionLabel(p: Patient): string {
  return `${p.name} — ${zoneLabelFromPatient(p.isolation_zone)}`;
}

/** 与 PrescriptionWorkspace 处方表单、打印单处方区同源 */
type RxPrintBundle = {
  frequencyLabel: string;
  modeDisplay: string;
  bloodFlow: number | null;
  dialysateFlow: number | null;
  duration: number | null;
  dialyzerShort: string;
  anticoagulantLabel: string;
  heparinFirst: number | null;
  heparinMaint: number | null;
  na: number | null;
  k: number | null;
  ca: number | null;
  dialysateTemp: number | null;
  sodiumCurveLine: string;
  preAssessSbp: number | null;
  preAssessDbp: number | null;
  preAssessPulse: number | null;
  /** 透前其他补充 */
  preAssessOther: string;
  edemaDisplay: string;
  bleedingDisplay: string;
  shiftChinese: string;
  machineNo: string;
  preMachineWeightRx: number | null;
  prescriptionUfMl: number | null;
  prescriptionUfRate: string | null;
  /** 处方超滤率按干体重折算：mL·h⁻¹·kg⁻¹（干体重） */
  prescriptionUfPerHrPerDryKg: string | null;
};

function buildRxPrintBundle(
  rx: Record<string, unknown> | null,
  demo: DialysisDemoPatient | null,
): RxPrintBundle | null {
  if (!rx || !demo) return null;
  const mode = String(rx.mode ?? 'HD');
  const dw = rx.dryWeight as number;
  const preM = rx.preMachineWeight as number;
  const dur = rx.duration as number;
  if (!Number.isFinite(dw) || !Number.isFinite(preM) || !Number.isFinite(dur)) return null;
  const ufMl = computePrescriptionUltrafiltrationMl(preM, dw, mode);
  const ufRate = dur > 0 ? (ufMl / dur).toFixed(0) : null;
  const ufPerHrPerDryKg = dur > 0 && dw > 0 ? ((ufMl / dur) / dw).toFixed(2) : null;

  const freqPreset = String(rx.frequencyPreset ?? '');
  const freqCustom = String(rx.frequencyCustom ?? '');
  const modeOther = String(rx.modeOther ?? '');
  const edema = String(rx.preAssessEdema ?? '');
  const edemaSite = String(rx.preAssessEdemaSite ?? '').trim();
  const bleeding = String(rx.preAssessBleeding ?? '');
  const bleedingDesc = String(rx.preAssessBleedingDesc ?? '').trim();
  const edemaDisplay =
    edema === 'yes' ? (edemaSite ? `有 · ${edemaSite}` : '有') : yesNoAssessLabel(edema);
  const bleedingDisplay =
    bleeding === 'yes' ? (bleedingDesc ? `有 · ${bleedingDesc}` : '有') : yesNoAssessLabel(bleeding);

  return {
    frequencyLabel: frequencyPresetLabel(freqPreset, freqCustom),
    modeDisplay: dialysisModeLabel(mode, modeOther),
    bloodFlow: typeof rx.bloodFlow === 'number' ? rx.bloodFlow : null,
    dialysateFlow: typeof rx.dialysateFlow === 'number' ? rx.dialysateFlow : null,
    duration: dur,
    dialyzerShort: dialyzerShortFromFormValue(String(rx.dialyzer ?? '')),
    anticoagulantLabel: anticoagulantLabelFromCode(String(rx.anticoagulant ?? '')),
    heparinFirst: typeof rx.heparinFirst === 'number' ? rx.heparinFirst : null,
    heparinMaint: typeof rx.heparinMaint === 'number' ? rx.heparinMaint : null,
    na: typeof rx.na === 'number' ? rx.na : null,
    k: typeof rx.k === 'number' ? rx.k : null,
    ca: typeof rx.ca === 'number' ? rx.ca : null,
    dialysateTemp: typeof rx.temp === 'number' ? rx.temp : null,
    sodiumCurveLine: formatSodiumCurveSummary(rx),
    preAssessSbp: typeof rx.preAssessSbp === 'number' ? rx.preAssessSbp : null,
    preAssessDbp: typeof rx.preAssessDbp === 'number' ? rx.preAssessDbp : null,
    preAssessPulse: typeof rx.preAssessPulse === 'number' ? rx.preAssessPulse : null,
    preAssessOther: String(rx.preAssessOther ?? '').trim(),
    edemaDisplay,
    bleedingDisplay,
    shiftChinese: shiftCodeToChinese(String(rx.shift ?? '')),
    machineNo: String(rx.machineNo ?? ''),
    preMachineWeightRx: preM,
    prescriptionUfMl: ufMl,
    prescriptionUfRate: ufRate,
    prescriptionUfPerHrPerDryKg: ufPerHrPerDryKg,
  };
}

// ── A4 打印单 HTML 生成 ───────────────────────────────────
interface PrintData {
  patientLabel: string;
  printDate: string;
  prescribingDoctorName: string | null;
  rxPrint: RxPrintBundle | null;
  dryWeight: number | null;
  postWeight: number | null;
  durationHours: number | null;
  preBun: number | null;
  postBun: number | null;
  computedUF: number | null;
  ufPercent: string | null;
  ufAlert: boolean;
  accessType: string;
  catheterLocation: string;
  catheterDays: number | null;
  complications: string[];
  complicationRecords: Record<string, Record<string, unknown>>;
  orders: Record<string, boolean>;
  orderRows: { key: string; drug: string; detail: string }[];
  vitalRows: VitalSignRow[];
  ktv: number | null;
  urr: number | null;
  ktvAdequate: boolean | null;
  urrAdequate: boolean | null;
  formValues: Record<string, unknown>;
}

function generatePrintHtml(d: PrintData): string {
  const v = (val: unknown, unit = '', fallback = '—') =>
    val !== null && val !== undefined && val !== '' ? `${val}${unit}` : fallback;

  // 生命体征表格行
  const vitalTableRows = d.vitalRows.map(row => `
    <tr>
      <td>${row.time}</td>
      <td>${row.values.sbp || ''}</td>
      <td>${row.values.dbp || ''}</td>
      <td>${row.values.pulse || ''}</td>
      <td>${row.values.ap || ''}</td>
      <td>${row.values.vp || ''}</td>
      <td>${row.values.tmp || ''}</td>
      <td>${row.values.bloodflow || ''}</td>
      <td style="text-align:left">${row.values.remark || ''}</td>
      <td>${row.values.signature || ''}</td>
    </tr>`).join('');

  // 并发症列表
  const compItems = d.complications.length === 0
    ? '<span style="color:#666">无</span>'
    : d.complications.map(cv => {
      const comp = COMPLICATIONS.find(c => c.value === cv);
      const rec = d.complicationRecords[cv];
      const measuresArr = rec?.measures as string[] | undefined;
      const measuresText = measuresArr?.length
        ? measuresArr.map(m => {
          const cfg = COMPLICATION_CONFIG[cv];
          const measuresField = cfg?.fields.find((f): f is Extract<FieldDef, { type: 'checkbox-group' }> =>
            f.key === 'measures' && f.type === 'checkbox-group',
          );
          const option = measuresField?.options?.find(o => o.value === m);
          if (!option) return m;
          if (option.inputKey) {
            const dose = rec?.[option.inputKey];
            const doseText = dose !== null && dose !== undefined && dose !== '' ? String(dose) : '';
            return doseText ? `${option.label}（${doseText}${option.inputUnit ?? ''}）` : option.label;
          }
          return option.label;
        }).join('、')
        : '';
      return `<div style="margin-bottom:3px">
        <b>${comp?.emergency ? '⚡ ' : ''}${comp?.label ?? cv}</b>
        ${rec?.occurrenceTime ? `&nbsp;${rec.occurrenceTime}` : ''}
        ${measuresText ? `<br><span style="color:#444">处置：${measuresText}</span>` : ''}
        ${rec?.doctorNotified === 'yes' ? '&nbsp;<b>[已通知医生]</b>' : ''}
        ${rec?.nurse ? `&nbsp;护士：${rec.nurse}` : ''}
      </div>`;
    }).join('');

  // 医嘱执行情况
  const orderItems = d.orderRows.length === 0
    ? '<span style="color:#666">无</span>'
    : d.orderRows.map(o =>
      `<div style="margin-bottom:2px">${d.orders[o.key] ? '☑' : '☐'} ${o.drug} <span style="color:${d.orders[o.key] ? '#008000' : '#CC6600'}">${d.orders[o.key] ? '已执行' : '未执行'}</span></div>`
    ).join('');

  // Kt/V 区域
  const ktvSection = d.ktv !== null ? `
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:5px">
      <div style="border:2px solid ${d.ktvAdequate ? '#008000' : '#CC6600'};text-align:center;padding:5px;border-radius:4px">
        <div style="font-size:7pt;color:#555">spKt/V（Daugirdas II）</div>
        <div style="font-size:20pt;font-weight:bold;color:${d.ktvAdequate ? '#008000' : '#CC6600'}">${d.ktv}</div>
        <div style="font-size:8pt;font-weight:bold;color:${d.ktvAdequate ? '#008000' : '#CC6600'}">${d.ktvAdequate ? '✓ 达标 ≥1.2' : '✗ 不达标 <1.2'}</div>
      </div>
      <div style="border:2px solid ${d.urrAdequate ? '#008000' : '#CC6600'};text-align:center;padding:5px;border-radius:4px">
        <div style="font-size:7pt;color:#555">URR（尿素清除率）</div>
        <div style="font-size:20pt;font-weight:bold;color:${d.urrAdequate ? '#008000' : '#CC6600'}">${d.urr}%</div>
        <div style="font-size:8pt;font-weight:bold;color:${d.urrAdequate ? '#008000' : '#CC6600'}">${d.urrAdequate ? '✓ 达标 ≥65%' : '✗ 不达标 <65%'}</div>
      </div>
      <div style="border:2px solid ${d.ufAlert ? '#CC0000' : '#0066CC'};text-align:center;padding:5px;border-radius:4px">
        <div style="font-size:7pt;color:#555">实际超滤量</div>
        <div style="font-size:16pt;font-weight:bold;color:${d.ufAlert ? '#CC0000' : '#0066CC'}">${v(d.computedUF, ' mL')}</div>
        <div style="font-size:8pt;color:${d.ufAlert ? '#CC0000' : '#444'}">${d.ufPercent ? `占干体重 ${d.ufPercent}%${d.ufAlert ? ' ⚠超限' : ''}` : '—'}</div>
      </div>
    </div>` : `<div style="color:#888;font-style:italic">BUN 数据未填写，Kt/V 未计算</div>`;

  const CATHETER_LOCATION_MAP: Record<string, string> = {
    right_jugular: '右颈内静脉', left_jugular: '左颈内静脉',
    right_femoral: '右股静脉', left_femoral: '左股静脉',
    right_subclavian: '右锁骨下静脉', left_subclavian: '左锁骨下静脉',
  };

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>血液透析记录单 — ${d.patientLabel} — ${d.printDate}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Microsoft YaHei','微软雅黑',SimSun,sans-serif;font-size:9pt;color:#000;background:#fff}
  .page{width:210mm;min-height:297mm;padding:7mm 9mm;margin:0 auto}
  .hd-title{text-align:center;border-bottom:2.5px solid #000;padding-bottom:5px;margin-bottom:6px}
  .hd-title h1{font-size:15pt;font-weight:bold;letter-spacing:2px}
  .hd-title .meta{font-size:8.5pt;margin-top:3px;display:flex;justify-content:space-between}
  .block{border:1px solid #333;margin-bottom:5px;border-radius:2px;overflow:hidden}
  .block-hd{background:#EAECF0;font-weight:bold;font-size:8pt;padding:2px 6px;border-bottom:1px solid #333}
  .block-bd{padding:4px 6px}
  .g2{display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:5px}
  .g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:5px;margin-bottom:5px}
  .kv{display:flex;flex-wrap:wrap;gap:2px 14px;line-height:1.8}
  .kv .item{white-space:nowrap}
  .kv .item b{font-weight:bold}
  table{width:100%;border-collapse:collapse;font-size:7.5pt}
  th,td{border:1px solid #555;padding:2px 3px;text-align:center;vertical-align:middle}
  th{background:#EAECF0;font-weight:bold}
  .sign-line{display:flex;gap:0;margin-top:4px;border-top:1px solid #333;padding-top:4px}
  .sign-cell{flex:1;text-align:center;border-right:1px solid #ccc;padding:2px 4px;font-size:8pt}
  .sign-cell:last-child{border-right:none}
  .sign-cell .lbl{color:#555;font-size:7.5pt}
  .sign-cell .val{border-bottom:1px solid #333;min-height:16px;margin-top:1px}
  @media print{
    body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .no-print{display:none!important}
    @page{size:A4 portrait;margin:0}
    .page{margin:0;padding:7mm 9mm}
  }
</style>
</head>
<body>
<div class="page">

  <!-- 页眉 -->
  <div class="hd-title">
    <h1>血 液 透 析 记 录 单</h1>
    <div class="meta">
      <span>患者：<b>${d.patientLabel}</b></span>
      <span>班次：<b>${d.rxPrint?.shiftChinese ?? '—'}</b>&emsp;机器：<b>${d.rxPrint?.machineNo ?? '—'}</b></span>
      <span>通路：<b>${d.accessType}</b></span>
      <span>透析日期：<b>${d.printDate}</b></span>
    </div>
  </div>

  <!-- 第一行：处方参数 + 透前评估 -->
  <div class="g2">
    <div class="block">
      <div class="block-hd">透析处方参数（来自医生处方）</div>
      <div class="block-bd kv">
        <div class="item">透析频次：<b>${d.rxPrint?.frequencyLabel ?? '—'}</b></div>
        <div class="item">透析方式：<b>${d.rxPrint?.modeDisplay ?? '—'}</b></div>
        <div class="item">标准时长：<b>${v(d.rxPrint?.duration, ' h')}</b></div>
        <div class="item">血流速：<b>${v(d.rxPrint?.bloodFlow, ' mL/min')}</b></div>
        <div class="item">透析液流速：<b>${v(d.rxPrint?.dialysateFlow, ' mL/min')}</b></div>
        <div class="item">透析器：<b>${d.rxPrint?.dialyzerShort ?? '—'}</b></div>
        <div class="item">Na / K / Ca：<b>${d.rxPrint?.na ?? '—'} / ${d.rxPrint?.k ?? '—'} / ${d.rxPrint?.ca ?? '—'}</b></div>
        <div class="item">透析液温度：<b>${v(d.rxPrint?.dialysateTemp, ' ℃')}</b></div>
        <div class="item">钠曲线：<b>${d.rxPrint?.sodiumCurveLine ?? '—'}</b></div>
        <div class="item">抗凝方案：<b>${d.rxPrint?.anticoagulantLabel ?? '—'}</b></div>
        <div class="item">首剂：<b>${v(d.rxPrint?.heparinFirst, ' IU')}</b></div>
        <div class="item">追加：<b>${v(d.rxPrint?.heparinMaint, ' IU/h')}</b></div>
      </div>
    </div>
    <div class="block">
      <div class="block-hd">透前评估 &amp; 体重超滤</div>
      <div class="block-bd kv">
        <div class="item">透前收缩压：<b>${v(d.rxPrint?.preAssessSbp, ' mmHg')}</b></div>
        <div class="item">舒张压：<b>${v(d.rxPrint?.preAssessDbp, ' mmHg')}</b></div>
        <div class="item">脉搏：<b>${v(d.rxPrint?.preAssessPulse, ' 次/分')}</b></div>
        <div class="item">其他：<b>${d.rxPrint?.preAssessOther?.trim() ? d.rxPrint.preAssessOther : '—'}</b></div>
        <div class="item">水肿：<b>${d.rxPrint?.edemaDisplay ?? '—'}</b></div>
        <div class="item">活动性出血：<b>${d.rxPrint?.bleedingDisplay ?? '—'}</b></div>
        <div class="item">干体重（处方）：<b>${v(d.dryWeight, ' kg')}</b></div>
        <div class="item">上机前体重（处方）：<b>${v(d.rxPrint?.preMachineWeightRx, ' kg')}</b></div>
        <div class="item">处方超滤量：<b>${v(d.rxPrint?.prescriptionUfMl, ' mL')}</b></div>
        <div class="item">超滤率（处方）：<b>${v(d.rxPrint?.prescriptionUfRate, ' mL/h')}</b></div>
        <div class="item">每公斤体重每小时超滤率（干体重）：<b>${d.rxPrint?.prescriptionUfPerHrPerDryKg != null ? `${d.rxPrint.prescriptionUfPerHrPerDryKg} mL·h⁻¹·kg⁻¹` : '—'}</b></div>
      </div>
    </div>
  </div>
  <div style="text-align:right;font-size:8.5pt;margin:-1px 0 5px;padding-right:1px;color:#333">
    医生签名：<span style="font-family:'KaiTi','STKaiti','FangSong',serif;font-size:13pt;font-weight:bold;letter-spacing:0.15em">${d.prescribingDoctorName || '—'}</span>
  </div>

  <!-- 第二行：通路信息 + 护士签名 -->
  <div class="g2">
    <div class="block">
      <div class="block-hd">血管通路信息</div>
      <div class="block-bd kv">
        <div class="item">通路类型：<b>${d.accessType}</b></div>
        ${(d.accessType === 'TCC' || d.accessType === 'NCC') ? `
          <div class="item">导管位置：<b>${CATHETER_LOCATION_MAP[d.catheterLocation] ?? d.catheterLocation ?? '—'}</b></div>
          <div class="item">留置天数：<b>${v(d.catheterDays, ' 天')}</b></div>
        ` : ''}
        <div class="item">穿刺结果：<b>${(d.formValues.puncture_result as string) ?? '—'}</b></div>
        <div class="item">震颤：<b>${(d.formValues.thrill as string) ?? '—'}</b></div>
        <div class="item">杂音：<b>${(d.formValues.bruit as string) ?? '—'}</b></div>
      </div>
    </div>
    <div class="block">
      <div class="block-hd">护士签名（上机前）</div>
      <div class="block-bd">
        <div class="sign-line">
          <div class="sign-cell"><div class="lbl">穿刺护士</div><div class="val">${String(d.formValues.nurse_puncture_sign ?? '').trim() || '&nbsp;'}</div></div>
          <div class="sign-cell"><div class="lbl">上机护士</div><div class="val">${String(d.formValues.nurse_on_machine_sign ?? '').trim() || '&nbsp;'}</div></div>
          <div class="sign-cell"><div class="lbl">二次核对</div><div class="val">${String(d.formValues.nurse_double_check_sign ?? '').trim() || '&nbsp;'}</div></div>
        </div>
      </div>
    </div>
  </div>

  <!-- 第三行：生命体征表格 -->
  <div class="block" style="margin-bottom:5px">
    <div class="block-hd">透析中生命体征记录（每50分钟记录一次）</div>
    <div class="block-bd" style="padding:3px 4px">
      <table>
        <thead>
          <tr>
            <th style="width:42px">时间</th>
            <th style="width:50px">收缩压<br>(mmHg)</th>
            <th style="width:50px">舒张压<br>(mmHg)</th>
            <th style="width:50px">脉搏<br>(次/分)</th>
            <th style="width:50px">动脉压<br>(mmHg)</th>
            <th style="width:50px">静脉压<br>(mmHg)</th>
            <th style="width:50px">跨膜压<br>(mmHg)</th>
            <th style="width:52px">血流速<br>(mL/min)</th>
            <th>备注</th>
            <th style="width:54px">护士签名</th>
          </tr>
        </thead>
        <tbody>
          ${vitalTableRows}
          <tr><td colspan="10" style="height:16px"></td></tr>
          <tr><td colspan="10" style="height:16px"></td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- 第四行：医嘱执行 + 并发症 -->
  <div class="g2">
    <div class="block">
      <div class="block-hd">今日医嘱执行</div>
      <div class="block-bd" style="font-size:8.5pt">${orderItems}</div>
    </div>
    <div class="block">
      <div class="block-hd">并发症记录</div>
      <div class="block-bd" style="font-size:8.5pt">${compItems}</div>
    </div>
  </div>

  <!-- 第五行：透析后评估 -->
  <div class="block" style="margin-bottom:5px">
    <div class="block-hd">透析后评估</div>
    <div class="block-bd">
      <div class="kv" style="margin-bottom:4px">
        <div class="item">实际时长：<b>${v(d.durationHours, ' h')}</b></div>
        <div class="item">透后体重：<b>${v(d.postWeight, ' kg')}</b></div>
        <div class="item">实际脱水量：<b>${v(d.computedUF, ' mL')}${d.ufAlert ? ' ⚠超限' : ''}</b></div>
        <div class="item">期间入量：<b>${v(d.formValues.input_volume, ' mL')}</b></div>
        <div class="item">透后收缩压：<b>${v(d.formValues.post_sbp, ' mmHg')}</b></div>
        <div class="item">透后舒张压：<b>${v(d.formValues.post_dbp, ' mmHg')}</b></div>
        <div class="item">透后脉搏：<b>${v(d.formValues.post_pulse, ' 次/分')}</b></div>
        <div class="item">凝血分级：<b>${v(d.formValues.coagulation)}</b></div>
        <div class="item">渗血部位：<b>${v(d.formValues.bleed_site)}</b></div>
        <div class="item">封管用药：<b>${v(d.formValues.lock_drug)}</b></div>
        <div class="item">患者状态：<b>${v(d.formValues.patient_status)}</b></div>
        <div class="item">机器运行：<b>${v(d.formValues.machine_status)}</b></div>
        <div class="item">消毒方式：<b>${v(d.formValues.disinfect)}</b></div>
        <div class="item">皮肤完好：<b>${v(d.formValues.skin_intact)}</b></div>
        <div class="item">透前BUN：<b>${v(d.preBun, ' mmol/L')}</b></div>
        <div class="item">透后BUN：<b>${v(d.postBun, ' mmol/L')}</b></div>
      </div>
      ${ktvSection}
    </div>
  </div>

  <!-- 第六行：备注 + 签名 -->
  <div class="block">
    <div class="block-hd">护士备注 &amp; 记录签名</div>
    <div class="block-bd">
      <div style="border-bottom:1px solid #333;min-height:22px;margin-bottom:6px;font-size:8.5pt;color:#555">
        ${(d.formValues.remark as string) ? (d.formValues.remark as string) : '&nbsp;'}
      </div>
      <div class="sign-line" style="border-top:none;padding-top:0">
        <div class="sign-cell"><div class="lbl">记录护士签名</div><div class="val">${String(d.formValues.nurse_record_sign ?? '').trim() || '&nbsp;'}</div></div>
        <div class="sign-cell"><div class="lbl">穿刺护士签名</div><div class="val">${String(d.formValues.nurse_puncture_sign ?? '').trim() || '&nbsp;'}</div></div>
        <div class="sign-cell"><div class="lbl">上机护士签名</div><div class="val">${String(d.formValues.nurse_on_machine_sign ?? '').trim() || '&nbsp;'}</div></div>
        <div class="sign-cell" style="flex:1.5"><div class="lbl">记录日期</div><div class="val" style="font-weight:bold">${d.printDate}</div></div>
      </div>
    </div>
  </div>

  <!-- 页脚 -->
  <div style="text-align:center;font-size:7pt;color:#888;margin-top:4px;border-top:1px solid #ccc;padding-top:3px">
    本记录单由血液透析室管理系统自动生成 · 打印时间：${dayjs().format('YYYY-MM-DD HH:mm')} · 打印后请核对并签字确认
  </div>

</div>
<script>window.onload=function(){window.print()}</script>
</body>
</html>`;
}

// ── 区块标题组件 ──────────────────────────────────────────
function SectionTitle({ step, color, title, extra }: {
  step: number; color: string; title: string; extra?: React.ReactNode;
}) {
  return (
    <div className="hd-record-section__header">
      <div className="hd-record-section__step" style={{ background: color }}>{step}</div>
      <span className="hd-record-section__title">{title}</span>
      {extra}
    </div>
  );
}

// ── 只读值展示格（带背景色） ──────────────────────────────
function ReadonlyValue({ label, value, color = '#0369A1', bg = '#F0F9FF', border = '#BAE6FD', mono = false }: {
  label: string; value: React.ReactNode; color?: string; bg?: string; border?: string; mono?: boolean;
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

// ── 表单项标签 ────────────────────────────────────────────
function FieldLabel({ text, required }: { text: string; required?: boolean }) {
  return (
    <span className="hd-field-label">
      {text}{required && <span style={{ color: '#EF4444', marginLeft: 2 }}>*</span>}
    </span>
  );
}

// ── 区块容器 ──────────────────────────────────────────────
function Section({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="hd-record-section" style={style}>
      {children}
    </div>
  );
}

function SectionBody({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div className="hd-record-section__body" style={style}>{children}</div>;
}

// ── 网格布局辅助 ──────────────────────────────────────────
function Grid({ cols = 4, gap = 14, children, style }: {
  cols?: number; gap?: number; children: React.ReactNode; style?: React.CSSProperties;
}) {
  const minWidth = cols >= 4 ? 168 : cols === 3 ? 220 : 260;
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${minWidth}px), 1fr))`,
      gap,
      ...style,
    }}>{children}</div>
  );
}

/** 透析后评估区块内二级分组标题 */
function SubsectionTitle({ children, first }: { children: React.ReactNode; first?: boolean }) {
  return (
    <div className={`hd-subsection-title${first ? ' hd-subsection-title--first' : ''}`}>{children}</div>
  );
}

// ── UUID 校验（用于区分真实患者 ID 与演示 ID）──────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isRealPatientId = (v: string) => UUID_RE.test(v);

function normNum(v: unknown): number | undefined {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** 与处方工作台 localStorage 同源：库中无 form_extra 时补齐透前评估/钠曲线等 */
const FORM_EXTRA_STORAGE_KEYS = [
  'preMachineWeight',
  'ultrafiltrationMl',
  'preAssessSbp',
  'preAssessDbp',
  'preAssessPulse',
  'preAssessEdema',
  'preAssessEdemaSite',
  'preAssessBleeding',
  'preAssessBleedingDesc',
  'sodiumCurve',
  'sodiumCurveCustom',
  'naCurveStart',
  'naCurveEnd',
  'naCurveTimeStart',
  'naCurveTimeEnd',
  'preAssessOther',
] as const;

function mergeFormExtraFromStorage(patientId: string, fe: Record<string, unknown>): Record<string, unknown> {
  const stored = loadPrescriptionBasicParamsFromStorage(patientId);
  const out = { ...fe };
  for (const key of FORM_EXTRA_STORAGE_KEYS) {
    if (
      (out[key] === undefined || out[key] === null) &&
      stored[key] !== undefined &&
      stored[key] !== null
    ) {
      out[key] = stored[key];
    }
  }
  return out;
}

function frequencyWeekLabel(perWeek: number | null | undefined): string {
  if (perWeek == null || !Number.isFinite(Number(perWeek))) return '—';
  return `每周 ${perWeek} 次`;
}

function hdfReplacementModeLabel(code: string | null | undefined): string {
  if (!code) return '—';
  const m: Record<string, string> = { pre: '前置换', post: '后置换', both: '前后置换' };
  return m[String(code).toLowerCase()] ?? String(code);
}

function modalityCodeFromScheduleOrRx(
  sessionMode: string | null | undefined,
  rxModality: string | null | undefined,
): string {
  const raw = (sessionMode?.trim() || rxModality?.trim() || 'HD');
  const u = String(raw).toUpperCase().replace(/\+/g, '_');
  if (u === 'HDF') return 'HDF';
  if (u === 'HD_HP' || u === 'HDHP') return 'HD_HP';
  return 'HD';
}

// ── 主组件 ──────────────────────────────────────────────────
export default function DialysisEntryPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  /** 本人签名展示名：优先真实姓名，空则回退登录名（避免库内 real_name 未维护时整段为空） */
  const signerLabel = useAuthStore((s) => {
    const u = s.user;
    if (!u) return '';
    return (u.real_name?.trim() || u.username?.trim() || '');
  });
  /** 仅「记录护士签名」（文末）默认带出当前用户；③上机前穿刺/上机/核对须手填，不自动写入 */
  const nurseSignatureInitialValues = useMemo(
    () => (signerLabel ? { nurse_record_sign: signerLabel } : {}),
    [signerLabel],
  );
  const canAnomaly = useAuthStore((s) => s.hasRole(['admin', 'doctor', 'head_nurse']));
  const [anomalyOpen, setAnomalyOpen] = useState(false);
  const [anomalyCtx, setAnomalyCtx] = useState<{
    anomalyType: AnomalyType;
    contextId?: string;
  } | null>(null);

  const [selectedPatient, setSelectedPatient] = useState<string>('');
  const [recordIdFromUrl, setRecordIdFromUrl] = useState<string>('');
  const [openedRecordDetail, setOpenedRecordDetail] = useState<DialysisRecordDetail | null>(null);
  /** 选中的日期（DatePicker），默认今日（与本地日历日对齐） */
  const [sessionDate, setSessionDate] = useState<Dayjs>(() => dayjs().startOf('day'));
  /** 与处方工作台 mergePrescriptionDefaultsForPatient 同源（演示默认值 + 医生保存的参数），仅展示只读 */
  const [rxDefaults, setRxDefaults] = useState<Record<string, unknown> | null>(null);
  /** 真实患者：从 /api/dialysis/prepare 获取的处方与医嘱数据 */
  const [realPrepareData, setRealPrepareData] = useState<PrepareDialysisData | null>(null);
  /** 处方工作台保存成功后递增，触发重新拉取 prepare（同页停留也能同步） */
  const [prepareRefreshNonce, setPrepareRefreshNonce] = useState(0);
  const [dryWeight, setDryWeight] = useState<number | null>(null);

  const [postWeight, setPostWeight] = useState<number | null>(null);
  const [durationHours, setDurationHours] = useState<number | null>(null);
  const [preBun, setPreBun] = useState<number | null>(null);
  const [postBun, setPostBun] = useState<number | null>(null);

  const [accessType, setAccessType] = useState<'AVF' | 'AVG' | 'TCC' | 'NCC'>('AVF');
  const [catheterLocation, setCatheterLocation] = useState<string>('');
  const [catheterPlacedDate, setCatheterPlacedDate] = useState<string | null>(null);
  const catheterDays = catheterPlacedDate ? dayjs().diff(dayjs(catheterPlacedDate), 'day') : null;

  const [complications, setComplications] = useState<string[]>([]);
  const [complicationRecords, setComplicationRecords] = useState<Record<string, Record<string, unknown>>>({});
  const [treatmentModalTarget, setTreatmentModalTarget] = useState<string | null>(null);
  const [treatmentForm] = Form.useForm();
  const [postDialysisSyncMeta, setPostDialysisSyncMeta] = useState<PostDialysisSyncPayload | null>(null);
  const [orders, setOrders] = useState<Record<string, boolean>>({});
  const [vitalRows, setVitalRows] = useState<VitalSignRow[]>(() => [createVitalSignRow()]);
  /** 间期用药（非透析日）：仅展示长期医嘱中的执行约定，不在此页勾选执行 */
  const [intervalOrdersReadonly, setIntervalOrdersReadonly] = useState<LongTermOrder[]>([]);

  /** 来自 URL / 排班快捷入口，用于展示当前患者标签 */
  const [pinnedPatientOption, setPinnedPatientOption] = useState<{ value: string; label: string } | null>(null);
  const [todayDialysisQuickList, setTodayDialysisQuickList] = useState<TodaySchedulePatientRow[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyRows, setHistoryRows] = useState<DialysisRecordListRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(8);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPatientId, setHistoryPatientId] = useState<string>('');
  const [historyShift, setHistoryShift] = useState<'all' | 'morning' | 'afternoon' | 'evening'>('all');
  const [historyDateRange, setHistoryDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [historyPatientOptions, setHistoryPatientOptions] = useState<{ value: string; label: string }[]>([]);
  const [historyPatientLoading, setHistoryPatientLoading] = useState(false);
  const [historyActionLoadingId, setHistoryActionLoadingId] = useState<string>('');

  /** 切换患者/透析日前一状态，用于临时保存草稿 key 与快照日期 */
  const prevPatientRef = useRef<string>(selectedPatient);
  const prevSessionDateRef = useRef<Dayjs>(sessionDate);
  const draftDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressDraftSaveUntilRef = useRef(0);
  const [draftSavedAtIso, setDraftSavedAtIso] = useState<string | null>(null);
  const hydratedRecordRef = useRef<string>('');

  const collectDraftSnapshotWithSessionDate = useCallback(
    (metaDate: Dayjs): DialysisEntryDraftSnapshot => ({
      v: DIALYSIS_ENTRY_DRAFT_VERSION,
      savedAt: new Date().toISOString(),
      sessionDateStr: metaDate.format('YYYY-MM-DD'),
      formValues: serializeFormValuesForDraft(form.getFieldsValue(true) as Record<string, unknown>),
      vitalRows,
      complications,
      complicationRecords,
      orders,
      accessType,
      catheterLocation,
      catheterPlacedDate,
      postWeight,
      durationHours,
      preBun,
      postBun,
      dryWeight,
    }),
    [
      form,
      vitalRows,
      complications,
      complicationRecords,
      orders,
      accessType,
      catheterLocation,
      catheterPlacedDate,
      postWeight,
      durationHours,
      preBun,
      postBun,
      dryWeight,
    ],
  );

  const collectDialysisEntryDraftSnapshot = useCallback(
    () => collectDraftSnapshotWithSessionDate(sessionDate),
    [collectDraftSnapshotWithSessionDate, sessionDate],
  );

  const applyDialysisEntryDraftSnapshot = useCallback(
    (d: DialysisEntryDraftSnapshot) => {
      form.setFieldsValue(d.formValues);
      setVitalRows(d.vitalRows.length ? d.vitalRows : [createVitalSignRow()]);
      setComplications(d.complications);
      setComplicationRecords(d.complicationRecords);
      if (isRealPatientId(selectedPatient) && realPrepareData?.ordersToday?.length) {
        setOrders(
          mergeDraftOrdersWithSessions(
            realPrepareData.ordersToday,
            d.orders,
            realPrepareData.prescription?.frequency_per_week ?? null,
          ),
        );
      } else {
        setOrders(d.orders);
      }
      setAccessType(d.accessType);
      setCatheterLocation(d.catheterLocation);
      setCatheterPlacedDate(d.catheterPlacedDate);
      setPostWeight(d.postWeight);
      setDurationHours(d.durationHours);
      setPreBun(d.preBun);
      setPostBun(d.postBun);
      /** 草稿里往往未存干体重(null)，若直接覆盖会抹掉 prepare 已从处方写入的值；处方干体重以库为准 */
      const rxDw =
        isRealPatientId(selectedPatient) && realPrepareData?.prescription
          ? normNum(realPrepareData.prescription.dry_weight)
          : undefined;
      setDryWeight(rxDw != null ? rxDw : d.dryWeight ?? null);
    },
    [form, selectedPatient, realPrepareData],
  );

  /** 切换患者或透析日期：先写入上一桶草稿，再清空本页状态，避免串患者 */
  useEffect(() => {
    if (recordIdFromUrl) {
      prevPatientRef.current = selectedPatient;
      prevSessionDateRef.current = sessionDate;
      return;
    }

    const prevP = prevPatientRef.current;
    const prevD = prevSessionDateRef.current;
    const nextP = selectedPatient;
    const nextD = sessionDate;

    const prevKey = prevP
      ? dialysisEntryDraftStorageKey(prevP, prevD.format('YYYY-MM-DD'))
      : null;
    const nextKey = nextP
      ? dialysisEntryDraftStorageKey(nextP, nextD.format('YYYY-MM-DD'))
      : null;

    if (prevKey && nextKey && prevKey !== nextKey) {
      saveDialysisEntryDraft(prevKey, collectDraftSnapshotWithSessionDate(prevD));
      suppressDraftSaveUntilRef.current = Date.now() + 1200;
      form.resetFields();
      setVitalRows([createVitalSignRow()]);
      setComplications([]);
      setComplicationRecords({});
      setOrders({});
      setAccessType('AVF');
      setCatheterLocation('');
      setCatheterPlacedDate(null);
      setPostWeight(null);
      setDurationHours(null);
      setPreBun(null);
      setPostBun(null);
      setDryWeight(null);
      if (signerLabel) form.setFieldsValue({ nurse_record_sign: signerLabel });
    }

    prevPatientRef.current = nextP;
    prevSessionDateRef.current = nextD;
  }, [selectedPatient, sessionDate, form, collectDraftSnapshotWithSessionDate, signerLabel, recordIdFromUrl]);

  const schedulePersistDialysisDraft = useCallback(() => {
    if (recordIdFromUrl) return;
    if (!selectedPatient) return;
    if (Date.now() < suppressDraftSaveUntilRef.current) return;
    if (isRealPatientId(selectedPatient) && realPrepareData === null) return;

    if (draftDebounceTimerRef.current) clearTimeout(draftDebounceTimerRef.current);
    draftDebounceTimerRef.current = setTimeout(() => {
      draftDebounceTimerRef.current = null;
      const key = dialysisEntryDraftStorageKey(selectedPatient, sessionDate.format('YYYY-MM-DD'));
      saveDialysisEntryDraft(key, collectDialysisEntryDraftSnapshot());
      setDraftSavedAtIso(new Date().toISOString());
    }, 600);
  }, [recordIdFromUrl, selectedPatient, sessionDate, realPrepareData, collectDialysisEntryDraftSnapshot]);

  useEffect(
    () => () => {
      if (draftDebounceTimerRef.current) clearTimeout(draftDebounceTimerRef.current);
    },
    [],
  );

  /** 今日上机名单（与排班管理 / 处方页同源），用于顶栏快捷点选 */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await scheduleApi.getToday();
        if (!cancelled) setTodayDialysisQuickList(Array.isArray(rows) ? rows : []);
      } catch {
        if (!cancelled) setTodayDialysisQuickList([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedPatient || !isRealPatientId(selectedPatient)) return;
    setHistoryPatientId((prev) => (prev ? prev : selectedPatient));
  }, [selectedPatient]);

  useEffect(() => {
    if (!historyOpen || historyPatientOptions.length > 0) return;
    let cancelled = false;
    (async () => {
      setHistoryPatientLoading(true);
      try {
        const res = await patientsApi.list({ page: 1, page_size: 500, status: 'active' });
        if (cancelled) return;
        const payload = res.data.data as { list?: Patient[] } | Patient[] | null | undefined;
        const list =
          Array.isArray(payload)
            ? payload
            : payload && typeof payload === 'object' && Array.isArray(payload.list)
              ? payload.list
              : [];
        setHistoryPatientOptions(
          list.map((p) => ({ value: p.id, label: buildHistoryPatientOptionLabel(p) })),
        );
      } catch {
        if (!cancelled) {
          setHistoryPatientOptions([]);
        }
      } finally {
        if (!cancelled) setHistoryPatientLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [historyOpen, historyPatientOptions.length]);

  const loadHistoryRecords = useCallback(
    async (opts?: {
      page?: number;
      pageSize?: number;
      patientId?: string;
      shift?: 'all' | 'morning' | 'afternoon' | 'evening';
      dateRange?: [Dayjs | null, Dayjs | null] | null;
    }) => {
      const page = opts?.page ?? historyPage;
      const pageSize = opts?.pageSize ?? historyPageSize;
      const patientId = opts?.patientId ?? historyPatientId;
      const shift = opts?.shift ?? historyShift;
      const dateRange = opts?.dateRange ?? historyDateRange;

      setHistoryLoading(true);
      try {
        const params: {
          page: number;
          page_size: number;
          patient_id?: string;
          shift?: 'morning' | 'afternoon' | 'evening';
          start_date?: string;
          end_date?: string;
        } = {
          page,
          page_size: pageSize,
        };
        if (patientId && isRealPatientId(patientId)) params.patient_id = patientId;
        if (shift !== 'all') params.shift = shift;
        if (dateRange?.[0]) params.start_date = dateRange[0].format('YYYY-MM-DD');
        if (dateRange?.[1]) params.end_date = dateRange[1].format('YYYY-MM-DD');

        const res = await dialysisApi.list(params);
        const payload = res.data.data as
          | { list?: unknown; total?: unknown }
          | DialysisRecordListRow[]
          | null
          | undefined;
        const payloadRecord =
          payload && typeof payload === 'object' && !Array.isArray(payload)
            ? (payload as { list?: unknown; total?: unknown })
            : null;
        const list =
          Array.isArray(payload)
            ? payload
            : payloadRecord && Array.isArray(payloadRecord.list)
              ? (payloadRecord.list as DialysisRecordListRow[])
              : [];
        const total =
          typeof payloadRecord?.total === 'number'
            ? payloadRecord.total
            : list.length;

        setHistoryRows(list);
        setHistoryTotal(total);
        setHistoryPage(page);
        setHistoryPageSize(pageSize);
      } catch {
        setHistoryRows([]);
        setHistoryTotal(0);
      } finally {
        setHistoryLoading(false);
      }
    },
    [historyDateRange, historyPage, historyPageSize, historyPatientId, historyShift],
  );

  const openHistoryRecord = useCallback(
    async (recordId: string, autoPrint: boolean) => {
      if (!recordId) return;
      setHistoryActionLoadingId(recordId);
      try {
        const res = await dialysisApi.detail(recordId);
        const detail = res.data.data;
        if (!detail || !isRealPatientId(detail.patient_id)) {
          message.error('历史记录信息不完整，无法打开');
          return;
        }
        const dateStr =
          toFixedDateFromAny(detail.session_date)?.format('YYYY-MM-DD')
          ?? dayjs().format('YYYY-MM-DD');
        const next = new URLSearchParams();
        next.set('patient_id', detail.patient_id);
        next.set('date', dateStr);
        next.set('record_id', detail.id);
        if (autoPrint) next.set('autoprint', '1');
        setHistoryOpen(false);
        navigate(`/dialysis/entry?${next.toString()}`);
      } catch {
        message.error(autoPrint ? '打开打印记录失败，请稍后重试' : '打开历史记录失败，请稍后重试');
      } finally {
        setHistoryActionLoadingId('');
      }
    },
    [navigate],
  );

  const openHistoryQueryModal = useCallback(() => {
    const initialPatientId =
      historyPatientId || (selectedPatient && isRealPatientId(selectedPatient) ? selectedPatient : '');
    if (initialPatientId && initialPatientId !== historyPatientId) {
      setHistoryPatientId(initialPatientId);
    }
    setHistoryOpen(true);
    void loadHistoryRecords({
      page: 1,
      pageSize: historyPageSize,
      patientId: initialPatientId || undefined,
    });
  }, [historyPatientId, historyPageSize, loadHistoryRecords, selectedPatient]);

  /** 间期用药：拉取有效长期医嘱并筛选类型，用于下方「周几/日期」说明 */
  useEffect(() => {
    if (!selectedPatient || !isRealPatientId(selectedPatient)) {
      setIntervalOrdersReadonly([]);
      return;
    }
    let cancelled = false;
    ordersApi
      .getActive(selectedPatient)
      .then((res) => {
        if (cancelled) return;
        const list = res.data.data ?? [];
        setIntervalOrdersReadonly(list.filter((o) => o.order_type === 'interval_drug'));
      })
      .catch(() => {
        if (!cancelled) setIntervalOrdersReadonly([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPatient]);

  /** URL：?patient_id=&date= 与排班页跳转一致；无 date 时用当前本地日，避免残留状态与「今日」不一致。
   * 须随 patient_id 每次变化同步 selectedPatient（侧栏切换会更新 URL；若仅用 ref 拦首次则右侧仍停留在上一人）。 */
  useEffect(() => {
    const pid = searchParams.get('patient_id');
    const ds = searchParams.get('date');
    const rid = searchParams.get('record_id');
    setRecordIdFromUrl(rid && isRealPatientId(rid) ? rid : '');
    const parsedDate = toFixedDateFromAny(ds);
    setSessionDate(parsedDate ?? dayjs().startOf('day'));
    if (pid && isRealPatientId(pid)) {
      setSelectedPatient(pid);
      let cancelled = false;
      patientsApi
        .get(pid)
        .then((res) => {
          if (cancelled) return;
          const p = res.data.data;
          if (!p) return;
          const label = `${p.name} — ${p.primary_diagnosis} — ${
            p.isolation_zone === 'normal' ? '普通区' : p.isolation_zone === 'hbv' ? '乙肝区' : '丙肝区'
          }`;
          setPinnedPatientOption({ value: pid, label });
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }
    setSelectedPatient('');
    setPinnedPatientOption(null);
    return undefined;
  }, [searchParams]);

  /** 处方页保存成功广播：当前选中患者一致时刷新 prepare */
  useEffect(() => {
    const handler = (ev: Event) => {
      const ce = ev as CustomEvent<PrescriptionSavedDetail>;
      const d = ce.detail;
      if (!d?.patientId) return;
      if (d.patientId === selectedPatient && isRealPatientId(selectedPatient)) {
        setPrepareRefreshNonce((n) => n + 1);
      }
    };
    window.addEventListener(HD_PRESCRIPTION_SAVED_EVENT, handler as EventListener);
    return () => window.removeEventListener(HD_PRESCRIPTION_SAVED_EVENT, handler as EventListener);
  }, [selectedPatient]);

  /** 长期医嘱页开立/停止成功：当前选中患者一致时刷新 prepare（今日医嘱执行确认） */
  useEffect(() => {
    const handler = (ev: Event) => {
      const ce = ev as CustomEvent<LongTermOrderSavedDetail>;
      const d = ce.detail;
      if (!d?.patientId) return;
      if (d.patientId === selectedPatient && isRealPatientId(selectedPatient)) {
        setPrepareRefreshNonce((n) => n + 1);
      }
    };
    window.addEventListener(HD_LONG_TERM_ORDER_SAVED_EVENT, handler as EventListener);
    return () => window.removeEventListener(HD_LONG_TERM_ORDER_SAVED_EVENT, handler as EventListener);
  }, [selectedPatient]);

  /** 真实患者：随患者或透析日期变化重新加载当前处方与当日医嘱（与透析处方管理保存结果一致） */
  useEffect(() => {
    if (!selectedPatient || !isRealPatientId(selectedPatient)) {
      return;
    }
    let cancelled = false;
    setRealPrepareData(null);
    (async () => {
      try {
        const dateStr = sessionDate.format('YYYY-MM-DD');
        const resp = await dialysisApi.prepare(selectedPatient, dateStr);
        if (cancelled) return;
        const prep = parsePrepareDialysisResponse(resp);
        setRealPrepareData(prep);
        if (prep.prescription) {
          const rx = prep.prescription;
          const feRaw =
            rx.form_extra != null && typeof rx.form_extra === 'object' && !Array.isArray(rx.form_extra)
              ? (rx.form_extra as Record<string, unknown>)
              : {};
          const fe = mergeFormExtraFromStorage(selectedPatient, feRaw);
          const preFromRx = normNum(fe.preMachineWeight);
          setDryWeight(normNum(rx.dry_weight) ?? null);
          const dur = normNum(rx.duration_hours);
          if (!recordIdFromUrl) {
            setDurationHours(dur ?? null);
            form.setFieldsValue({
              blood_flow_rate: normNum(rx.blood_flow_rate),
              dialysate_flow_rate: normNum(rx.dialysate_flow_rate),
              dialysate_na: normNum(rx.dialysate_na),
              dialysate_ca: normNum(rx.dialysate_ca),
              dialysate_k: normNum(rx.dialysate_k),
              dialysate_temp: normNum(rx.dialysate_temp),
              heparin_prime_dose: normNum(rx.heparin_prime_dose),
              heparin_maintain: normNum(rx.heparin_maintain),
              pre_weight: preFromRx ?? normNum(rx.dry_weight),
            });
          }
        } else {
          setDryWeight(null);
          if (!recordIdFromUrl) {
            setDurationHours(null);
            form.setFieldsValue({ pre_weight: undefined });
          }
        }
        setRxDefaults(null);
      } catch {
        if (!cancelled) {
          message.error('加载患者处方数据失败，请检查网络或联系管理员');
          setRealPrepareData(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedPatient, sessionDate, form, prepareRefreshNonce, recordIdFromUrl]);

  /** 从 URL 的 record_id 打开既往透析记录：拉取详情并回填当前记录单 */
  useEffect(() => {
    if (!recordIdFromUrl) {
      hydratedRecordRef.current = '';
      setOpenedRecordDetail(null);
      return;
    }
    if (hydratedRecordRef.current === recordIdFromUrl) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await dialysisApi.detail(recordIdFromUrl);
        if (cancelled) return;
        if (res.data.code !== 200 || !res.data.data) {
          message.error(res.data.message || '透析记录详情加载失败');
          return;
        }
        const detail = res.data.data;
        setOpenedRecordDetail(detail);

        if (isRealPatientId(detail.patient_id) && detail.patient_id !== selectedPatient) {
          setSelectedPatient(detail.patient_id);
        }
        const detailDate = toFixedDateFromAny(detail.session_date);
        if (detailDate) setSessionDate(detailDate);

        form.setFieldsValue({
          pre_weight: normNum(detail.pre_weight) ?? undefined,
          blood_flow_rate: normNum(detail.blood_flow_rate) ?? undefined,
          dialysate_flow_rate: normNum(detail.dialysate_flow_rate) ?? undefined,
          dialysate_na: normNum(detail.dialysate_na) ?? undefined,
          dialysate_ca: normNum(detail.dialysate_ca) ?? undefined,
          dialysate_k: normNum(detail.dialysate_k) ?? undefined,
          dialysate_temp: normNum(detail.dialysate_temp) ?? undefined,
          heparin_prime_dose: normNum(detail.heparin_prime_dose) ?? undefined,
          heparin_maintain: normNum(detail.heparin_maintain) ?? undefined,
          puncture_result: detail.puncture_result ?? undefined,
          puncture_method: detail.puncture_method ?? undefined,
          coagulation_grade: detail.coagulation_grade ?? 0,
          remark: detail.notes || undefined,
          post_sbp: undefined,
          post_dbp: undefined,
          post_pulse: undefined,
        });
        setPostWeight(normNum(detail.post_weight) ?? null);
        setDurationHours(
          detail.actual_duration != null
            ? Math.round((Number(detail.actual_duration) / 60) * 10) / 10
            : null,
        );
        setPreBun(normNum(detail.pre_bun) ?? null);
        setPostBun(normNum(detail.post_bun) ?? null);
        setAccessType(detail.is_avf_session ? 'AVF' : 'TCC');

        const vitals = Array.isArray(detail.vital_signs)
          ? [...detail.vital_signs]
              .sort((a, b) => {
                const sa = Number(a.sequence_no ?? 9999);
                const sb = Number(b.sequence_no ?? 9999);
                if (sa !== sb) return sa - sb;
                return String(a.record_time ?? '').localeCompare(String(b.record_time ?? ''));
              })
              .map((item, index) => ({
                id: item.id || `vital-detail-${recordIdFromUrl}-${index}`,
                time: toHHmm(item.record_time || item.time_label || ''),
                values: {
                  sbp: item.systolic_bp != null ? String(item.systolic_bp) : '',
                  dbp: item.diastolic_bp != null ? String(item.diastolic_bp) : '',
                  pulse: item.heart_rate != null ? String(item.heart_rate) : '',
                  ap: item.arterial_pressure != null ? String(item.arterial_pressure) : '',
                  vp: item.venous_pressure != null ? String(item.venous_pressure) : '',
                  tmp: item.tmp != null ? String(item.tmp) : '',
                  bloodflow: '',
                  remark: item.notes || '',
                  signature: '',
                },
              }))
          : [];
        setVitalRows(vitals.length > 0 ? vitals : [createVitalSignRow()]);

        const validCompValues = new Set(COMPLICATIONS.map((item) => item.value));
        const compValues: string[] = [];
        const compRecords: Record<string, Record<string, unknown>> = {};
        for (const comp of detail.complications || []) {
          const compType = String(comp.comp_type || '').trim();
          if (!compType || !validCompValues.has(compType)) continue;
          if (!compValues.includes(compType)) compValues.push(compType);
          const rawDetail = comp.detail && typeof comp.detail === 'object' ? comp.detail : {};
          compRecords[compType] = {
            ...(rawDetail as Record<string, unknown>),
            occurrenceTime: toHHmm(comp.occurred_at || ''),
            remark: comp.notes || (rawDetail as Record<string, unknown>).remark || '',
          };
        }
        setComplications(compValues);
        setComplicationRecords(compRecords);

        const execMap: Record<string, boolean> = {};
        for (const exec of detail.order_executions || []) {
          if (!exec.long_term_order_id) continue;
          execMap[exec.long_term_order_id] = exec.status === 'executed';
        }
        if (Object.keys(execMap).length > 0) {
          setOrders((prev) => ({ ...prev, ...execMap }));
        }

        hydratedRecordRef.current = recordIdFromUrl;
      } catch {
        if (!cancelled) message.error('透析记录详情加载失败，请稍后重试');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [recordIdFromUrl, selectedPatient, form]);

  const selectedDemoPatient = useMemo(
    () => isRealPatientId(selectedPatient)
      ? null
      : (PATIENTS_LIST.find((p) => p.value === selectedPatient) ?? null),
    [selectedPatient],
  );

  /** 异常分析弹窗展示用（真实患者来自排班/URL 固定标签；演示患者来自演示列表） */
  const selectedPatientDisplayLabel = useMemo(() => {
    if (!selectedPatient) return undefined;
    if (pinnedPatientOption?.value === selectedPatient) return pinnedPatientOption.label;
    const fromSchedule = todayDialysisQuickList.find((r) => r.patient_id === selectedPatient);
    if (fromSchedule) {
      const zone =
        fromSchedule.isolation_zone === 'hbv'
          ? '乙肝区'
          : fromSchedule.isolation_zone === 'hcv'
            ? '丙肝区'
            : '普通区';
      return `${fromSchedule.patient_name || '患者'} — ${zone} — 今日排班`;
    }
    const demo = PATIENTS_LIST.find((p) => p.value === selectedPatient);
    if (demo) {
      const name = demo.label.split(' — ')[0]?.trim();
      return name || demo.label;
    }
    return undefined;
  }, [selectedPatient, pinnedPatientOption, todayDialysisQuickList]);

  /** 与 PrescriptionWorkspace 处方表单字段同源（只读） */
  const rxPreview = useMemo(() => {
    if (!rxDefaults || !selectedDemoPatient) return null;
    const mode = String(rxDefaults.mode ?? 'HD');
    const dw = rxDefaults.dryWeight as number;
    const preM = rxDefaults.preMachineWeight as number;
    const dur = rxDefaults.duration as number;
    if (!Number.isFinite(dw) || !Number.isFinite(preM) || !Number.isFinite(dur)) return null;
    const ufMl = computePrescriptionUltrafiltrationMl(preM, dw, mode);
    const ufRate = dur > 0 ? (ufMl / dur).toFixed(0) : null;
    const ufPerHrPerDryKg = dur > 0 && dw > 0 ? ((ufMl / dur) / dw).toFixed(2) : null;
    const ufAlert = ufMl / (dw * 1000) > 0.05;

    const freqPreset = String(rxDefaults.frequencyPreset ?? '');
    const freqCustom = String(rxDefaults.frequencyCustom ?? '');
    const modeOther = String(rxDefaults.modeOther ?? '');
    const heparinFirst = typeof rxDefaults.heparinFirst === 'number' ? rxDefaults.heparinFirst : null;
    const heparinMaint = typeof rxDefaults.heparinMaint === 'number' ? rxDefaults.heparinMaint : null;
    const dialysateTemp = typeof rxDefaults.temp === 'number' ? rxDefaults.temp : null;
    const sodiumCurveLine = formatSodiumCurveSummary(rxDefaults);
    const edema = String(rxDefaults.preAssessEdema ?? '');
    const edemaSite = String(rxDefaults.preAssessEdemaSite ?? '').trim();
    const bleeding = String(rxDefaults.preAssessBleeding ?? '');
    const bleedingDesc = String(rxDefaults.preAssessBleedingDesc ?? '').trim();
    const edemaDisplay =
      edema === 'yes' ? (edemaSite ? `有 · ${edemaSite}` : '有') : yesNoAssessLabel(edema);
    const bleedingDisplay =
      bleeding === 'yes' ? (bleedingDesc ? `有 · ${bleedingDesc}` : '有') : yesNoAssessLabel(bleeding);

    return {
      frequencyLabel: frequencyPresetLabel(freqPreset, freqCustom),
      modeDisplay: dialysisModeLabel(mode, modeOther),
      bloodFlow: rxDefaults.bloodFlow as number,
      dialysateFlow: rxDefaults.dialysateFlow as number,
      duration: dur,
      dialyzerShort: dialyzerShortFromFormValue(String(rxDefaults.dialyzer ?? '')),
      anticoagulantLabel: anticoagulantLabelFromCode(String(rxDefaults.anticoagulant ?? '')),
      heparinFirst,
      heparinMaint,
      na: rxDefaults.na as number,
      k: rxDefaults.k as number,
      ca: rxDefaults.ca as number,
      dialysateTemp,
      sodiumCurveLine,
      preAssessSbp: rxDefaults.preAssessSbp as number,
      preAssessDbp: rxDefaults.preAssessDbp as number,
      preAssessPulse: rxDefaults.preAssessPulse as number,
      preAssessOther: String(rxDefaults.preAssessOther ?? '').trim(),
      edemaDisplay,
      bleedingDisplay,
      shiftChinese: shiftCodeToChinese(String(rxDefaults.shift ?? '')),
      machineNo: String(rxDefaults.machineNo ?? ''),
      preMachineWeightRx: preM,
      prescriptionUfMl: ufMl,
      prescriptionUfRate: ufRate,
      prescriptionUfPerHrPerDryKg: ufPerHrPerDryKg,
      ufAlertPrescription: ufAlert,
    };
  }, [rxDefaults, selectedDemoPatient]);

  /** 当日排班条（仅当透析日期为今天时与 prepare 合并展示） */
  const scheduleTodayRow = useMemo(() => {
    if (!selectedPatient || !isRealPatientId(selectedPatient)) return null;
    if (!sessionDate.isSame(dayjs(), 'day')) return null;
    return todayDialysisQuickList.find((r) => r.patient_id === selectedPatient) ?? null;
  }, [selectedPatient, sessionDate, todayDialysisQuickList]);

  /** 今日医嘱执行确认：真实患者来自 prepare.ordersToday（透析用药；口服 qd/bid/tid 间期药不在此同步）；演示患者为本地示例 */
  const orderDisplayList = useMemo(() => {
    if (!isRealPatientId(selectedPatient)) {
      return PENDING_ORDERS.map((o) => ({
        key: o.key,
        drug: o.drug,
        detail: o.detail,
        alreadyExecuted: false,
      }));
    }
    if (!realPrepareData?.ordersToday?.length) {
      return [];
    }
    const rxPerWeek = realPrepareData.prescription?.frequency_per_week ?? null;
    const sorted = sortSessionsForBedsideDisplay(realPrepareData.ordersToday);
    return sorted.map((o: OrderForSession) => ({
      key: o.id,
      drug: `${o.parent_order_id ? '↳ ' : ''}${(o.drug_name || '（未命名药品）').trim()}`,
      detail: formatOrderSessionDetail(o, rxPerWeek),
      alreadyExecuted: o.alreadyExecuted,
    }));
  }, [selectedPatient, realPrepareData]);

  /** 组合医嘱合并为一条卡片；演示患者仍为单行组 */
  const orderExecutionGroups = useMemo((): DialysisOrderExecGroup[] => {
    if (!isRealPatientId(selectedPatient)) {
      return PENDING_ORDERS.map((p) => ({
        groupId: p.key,
        isCombo: false,
        rows: [
          {
            key: p.key,
            drug: p.drug,
            detail: p.detail,
            alreadyExecuted: false,
            isComboChild: false,
          },
        ],
      }));
    }
    if (!realPrepareData?.ordersToday?.length) return [];
    return buildDialysisOrderExecutionGroups(
      realPrepareData.ordersToday,
      realPrepareData.prescription?.frequency_per_week ?? null,
    );
  }, [selectedPatient, realPrepareData]);

  useEffect(() => {
    if (!selectedPatient) {
      setOrders({});
      return;
    }
    if (!isRealPatientId(selectedPatient)) {
      setOrders(Object.fromEntries(PENDING_ORDERS.map((o) => [o.key, false])));
      return;
    }
    const list = realPrepareData?.ordersToday;
    if (!list?.length) {
      setOrders({});
      return;
    }
    setOrders(
      buildInitialOrdersMapFromSessions(
        list,
        realPrepareData?.prescription?.frequency_per_week ?? null,
      ),
    );
  }, [selectedPatient, sessionDate, realPrepareData]);

  /** prepare 就绪后恢复 sessionStorage 草稿（与处方刷新后再次叠加，以本地未入库编辑为准） */
  useEffect(() => {
    if (recordIdFromUrl) {
      setDraftSavedAtIso(null);
      return;
    }
    if (!selectedPatient) return;
    if (isRealPatientId(selectedPatient) && realPrepareData === null) return;

    const key = dialysisEntryDraftStorageKey(selectedPatient, sessionDate.format('YYYY-MM-DD'));
    const draft = loadDialysisEntryDraft(key);
    if (!draft) {
      setDraftSavedAtIso(null);
      return;
    }
    applyDialysisEntryDraftSnapshot(draft);
    setDraftSavedAtIso(draft.savedAt);
  }, [
    recordIdFromUrl,
    selectedPatient,
    sessionDate,
    realPrepareData,
    prepareRefreshNonce,
    applyDialysisEntryDraftSnapshot,
  ]);

  /** 干体重（处方）展示依赖 state；草稿恢复可能曾把 null 写回，此处与 prepare 处方再对齐一次 */
  useEffect(() => {
    if (!selectedPatient || !isRealPatientId(selectedPatient)) return;
    const rx = realPrepareData?.prescription;
    if (!rx) return;
    const dw = normNum(rx.dry_weight);
    setDryWeight(dw ?? null);
  }, [selectedPatient, realPrepareData]);

  const postSbpWatch = Form.useWatch('post_sbp', form);
  const postDbpWatch = Form.useWatch('post_dbp', form);
  const postPulseWatch = Form.useWatch('post_pulse', form);
  const preWeightWatch = Form.useWatch('pre_weight', form);
  const postDialysisLockedByDoctor = postDialysisSyncMeta?.filledBy === 'doctor';

  /** 真实患者：与处方管理 / 排班合并后的只读摘要（依赖表单上机前体重用于超滤估算） */
  const realPatientRxPreview = useMemo(() => {
    if (!isRealPatientId(selectedPatient) || !realPrepareData?.prescription) return null;
    const rx = realPrepareData.prescription;
    const feRaw =
      rx.form_extra != null && typeof rx.form_extra === 'object' && !Array.isArray(rx.form_extra)
        ? (rx.form_extra as Record<string, unknown>)
        : {};
    const fe = mergeFormExtraFromStorage(selectedPatient, feRaw);
    const notesForSplit =
      rx.notes == null ? null : typeof rx.notes === 'string' ? rx.notes : String(rx.notes);
    const splitNotes = splitPrescriptionNotesFromDb(notesForSplit);
    const preAssessOtherText =
      String(fe.preAssessOther ?? '').trim() || splitNotes.preAssessOther || '';
    const prescriptionNotesOnly = String(splitNotes.notes ?? '').trim();
    const edema = String(fe.preAssessEdema ?? '');
    const edemaSite = String(fe.preAssessEdemaSite ?? '').trim();
    const bleeding = String(fe.preAssessBleeding ?? '');
    const bleedingDesc = String(fe.preAssessBleedingDesc ?? '').trim();
    const edemaDisplay =
      edema === 'yes' ? (edemaSite ? `有 · ${edemaSite}` : '有') : yesNoAssessLabel(edema);
    const bleedingDisplay =
      bleeding === 'yes' ? (bleedingDesc ? `有 · ${bleedingDesc}` : '有') : yesNoAssessLabel(bleeding);
    const sodiumCurveDisplay =
      typeof fe.sodiumCurve === 'string' && fe.sodiumCurve
        ? formatSodiumCurveSummary(fe)
        : '—';
    const modeCode = modalityCodeFromScheduleOrRx(
      scheduleTodayRow?.session_dialysis_mode,
      rx.hemodialysis_modality,
    );
    const dw = normNum(rx.dry_weight);
    const dur = normNum(rx.duration_hours);
    if (dw == null || dur == null) return null;
    const preFromExtra = normNum(fe.preMachineWeight);
    const preM =
      preWeightWatch != null && Number.isFinite(Number(preWeightWatch))
        ? Number(preWeightWatch)
        : preFromExtra ?? dw;
    const ufMl = computePrescriptionUltrafiltrationMl(preM, dw, modeCode);
    const ufRate = dur > 0 ? (ufMl / dur).toFixed(0) : null;
    const ufPerHrPerDryKg = dur > 0 && dw > 0 ? ((ufMl / dur) / dw).toFixed(2) : null;
    const ufAlert = ufMl / (dw * 1000) > 0.05;
    const modeDisplay = dialysisModeLabel(
      modeCode === 'HD_HP' ? 'HD_HP' : modeCode === 'HDF' ? 'HDF' : 'HD',
      undefined,
    );
    const rxOnlyMod = modalityCodeFromScheduleOrRx(undefined, rx.hemodialysis_modality);
    const prescriptionModeOnly = dialysisModeLabel(
      rxOnlyMod === 'HD_HP' ? 'HD_HP' : rxOnlyMod === 'HDF' ? 'HDF' : 'HD',
      undefined,
    );
    const schedMc = scheduleTodayRow?.session_dialysis_mode
      ? modalityCodeFromScheduleOrRx(scheduleTodayRow.session_dialysis_mode, undefined)
      : null;
    const scheduleModeOnly = schedMc
      ? dialysisModeLabel(schedMc === 'HD_HP' ? 'HD_HP' : schedMc === 'HDF' ? 'HDF' : 'HD', undefined)
      : null;
    const scheduleDiffers =
      !!scheduleTodayRow?.session_dialysis_mode?.trim() &&
      modalityCodeFromScheduleOrRx(scheduleTodayRow.session_dialysis_mode, rx.hemodialysis_modality) !== rxOnlyMod;
    const hdfExtra =
      modeCode === 'HDF' && (rx.hdf_replacement_mode || rx.hdf_replacement_volume_l != null)
        ? `${hdfReplacementModeLabel(rx.hdf_replacement_mode)}${
            rx.hdf_replacement_volume_l != null ? ` · ${rx.hdf_replacement_volume_l} L` : ''
          }`
        : null;
    const shiftShort: Record<string, string> = { am: '早', pm: '中', eve: '晚' };
    return {
      frequencyLabel: frequencyWeekLabel(rx.frequency_per_week),
      modeDisplay,
      prescriptionModeOnly,
      scheduleModeOnly,
      scheduleDiffers,
      bloodFlow: normNum(rx.blood_flow_rate) ?? 0,
      dialysateFlow: normNum(rx.dialysate_flow_rate) ?? 0,
      duration: dur,
      dialyzerShort: dialyzerShortFromFormValue(rx.dialyzer_model ?? ''),
      anticoagulantLabel: anticoagulantLabelFromCode(String(rx.anticoagulant ?? '')),
      heparinFirst: normNum(rx.heparin_prime_dose) ?? null,
      heparinMaint: normNum(rx.heparin_maintain) ?? null,
      na: normNum(rx.dialysate_na) ?? 0,
      k: normNum(rx.dialysate_k) ?? 0,
      ca: normNum(rx.dialysate_ca) ?? 0,
      dialysateTemp: normNum(rx.dialysate_temp) ?? null,
      sodiumCurveDisplay,
      prescriptionNotesDisplay: prescriptionNotesOnly ? prescriptionNotesOnly : '—',
      preAssessSbp: normNum(fe.preAssessSbp),
      preAssessDbp: normNum(fe.preAssessDbp),
      preAssessPulse: normNum(fe.preAssessPulse),
      edemaDisplay,
      bleedingDisplay,
      preAssessOtherDisplay: preAssessOtherText ? preAssessOtherText : '—',
      shiftChinese: scheduleTodayRow ? shiftShort[scheduleTodayRow.shift] ?? scheduleTodayRow.shift : '—',
      /** 机位：与患者档案 machine_station 一致（prepare 返回档案字段；无则回退当日排班同步字段） */
      machineStation:
        (typeof realPrepareData?.machine_station === 'string' && realPrepareData.machine_station.trim()
          ? realPrepareData.machine_station.trim()
          : '') ||
        (typeof scheduleTodayRow?.machine_station === 'string' && scheduleTodayRow.machine_station.trim()
          ? scheduleTodayRow.machine_station.trim()
          : '') ||
        '—',
      preMachineWeightRx: preM,
      prescriptionUfMl: ufMl,
      prescriptionUfRate: ufRate,
      prescriptionUfPerHrPerDryKg: ufPerHrPerDryKg,
      ufAlertPrescription: ufAlert,
      hemodialysisRemark: rx.hemodialysis_remark?.trim() || null,
      hdfExtra,
    };
  }, [
    selectedPatient,
    realPrepareData,
    scheduleTodayRow,
    preWeightWatch,
  ]);

  /**
   * 实际脱水量（mL）：
   * - 演示患者：处方上机前体重 - 透后体重
   * - 真实患者：表单上机前体重 - 透后体重
   */
  const preWeightForUF =
    rxPreview?.preMachineWeightRx
    ?? (preWeightWatch != null && Number.isFinite(Number(preWeightWatch)) ? Number(preWeightWatch) : null)
    ?? null;
  const computedUF =
    preWeightForUF != null && postWeight != null
      ? Math.round((preWeightForUF - postWeight) * 1000)
      : null;
  const ufPercent = dryWeight && computedUF ? ((computedUF / (dryWeight * 1000)) * 100).toFixed(1) : null;
  const ufAlert = ufPercent ? parseFloat(ufPercent) > 5 : false;

  const ktv = preBun && postBun && durationHours && postWeight
        ? calcSpKtv(preBun, postBun, durationHours, (computedUF ?? 0) / 1000, postWeight)
    : null;
  const urr = preBun && postBun ? calcUrr(preBun, postBun) : null;
  const ktvAdequate = ktv !== null ? ktv >= 1.2 : null;
  const urrAdequate = urr !== null ? urr >= 65 : null;

  useEffect(() => {
    const refresh = () => {
      if (!selectedPatient) {
        setPostDialysisSyncMeta(null);
        return;
      }
      const sync = readPostDialysisSync(selectedPatient);
      setPostDialysisSyncMeta(sync);
      if (sync?.filledBy === 'doctor') {
        setPostWeight(sync.postWeightKg);
        form.setFieldsValue({
          post_sbp: sync.postSbp ?? undefined,
          post_dbp: sync.postDbp ?? undefined,
          post_pulse: sync.postPulse ?? undefined,
        });
      }
    };
    refresh();
    window.addEventListener('storage', refresh);
    window.addEventListener(POST_DIALYSIS_SYNC_EVENT, refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener(POST_DIALYSIS_SYNC_EVENT, refresh);
    };
  }, [selectedPatient, form]);

  useEffect(() => {
    if (!selectedPatient) return;
    if (readPostDialysisSync(selectedPatient)?.filledBy === 'doctor') return;
    const hasAny =
      postSbpWatch != null ||
      postDbpWatch != null ||
      postPulseWatch != null ||
      postWeight != null;
    if (!hasAny) return;
    const t = window.setTimeout(() => {
      if (readPostDialysisSync(selectedPatient)?.filledBy === 'doctor') return;
      writePostDialysisSync({
        patientId: selectedPatient,
        postSbp: postSbpWatch ?? null,
        postDbp: postDbpWatch ?? null,
        postPulse: postPulseWatch ?? null,
        postWeightKg: postWeight,
        filledBy: 'nurse',
        updatedAt: new Date().toISOString(),
      });
      setPostDialysisSyncMeta(readPostDialysisSync(selectedPatient));
    }, 450);
    return () => window.clearTimeout(t);
  }, [selectedPatient, postWeight, postSbpWatch, postDbpWatch, postPulseWatch]);

  const handleVitalChange = useCallback(
    (rowId: string, field: string, val: string) => {
      setVitalRows((prev) =>
        prev.map((row) => {
          if (row.id !== rowId) return row;
          const nextValues = { ...row.values, [field]: val };
          if (field !== 'signature' && signerLabel) {
            if (vitalSignRowHasData(nextValues) && !String(nextValues.signature ?? '').trim()) {
              nextValues.signature = signerLabel;
            }
          }
          return { ...row, values: nextValues };
        }),
      );
      schedulePersistDialysisDraft();
    },
    [signerLabel, schedulePersistDialysisDraft],
  );

  const handleAddVitalRow = () => {
    setVitalRows((prev) => [...prev, createVitalSignRow()]);
    schedulePersistDialysisDraft();
  };

  /** 仅补充「记录护士签名」默认带出；③上机前三项不自动填充 */
  useEffect(() => {
    if (!signerLabel) return;
    queueMicrotask(() => {
      const cur = form.getFieldValue('nurse_record_sign');
      if (cur == null || String(cur).trim() === '') {
        form.setFieldValue('nurse_record_sign', signerLabel);
      }
    });
  }, [signerLabel, selectedPatient, form]);

  const handleRemoveVitalRow = (rowId: string) => {
    setVitalRows(prev => {
      if (prev.length <= 1) { message.warning('至少保留 1 条生命体征记录'); return prev; }
      return prev.filter(row => row.id !== rowId);
    });
    schedulePersistDialysisDraft();
  };

  const handleOrderToggle = (key: string, checked: boolean) => {
    setOrders((prev) => ({ ...prev, [key]: checked }));
    schedulePersistDialysisDraft();
  };

  /** 组合医嘱：一次勾选同步主药 + 所有子药 */
  const handleComboGroupToggle = (g: DialysisOrderExecGroup, checked: boolean) => {
    setOrders((prev) => {
      const next = { ...prev };
      for (const r of g.rows) next[r.key] = checked;
      return next;
    });
    schedulePersistDialysisDraft();
  };

  const handleSubmit = async () => {
    if (!selectedPatient) { message.warning('请先选择患者'); return; }
    // 允许真实患者（有 realPrepareData）或演示患者（有 rxPreview）继续提交
    const hasRealRx = isRealPatientId(selectedPatient) && realPrepareData !== null;
    const hasDemoRx = !isRealPatientId(selectedPatient) && rxPreview !== null;
    if (!hasRealRx && !hasDemoRx) { message.warning('处方数据未加载，请重新选择患者'); return; }
    if (postWeight == null) { message.warning('请填写透后体重'); return; }
    const hasUnsignedVitalRow = vitalRows.some((row) => {
      if (!vitalSignRowHasData(row.values)) return false;
      return !row.values.signature?.trim();
    });
    if (hasUnsignedVitalRow) {
      message.warning('已填写数据的每一行生命体征须填写护士签名（录入数据后将自动带出填写人姓名）');
      return;
    }

    setLoading(true);
    try {
      if (isRealPatientId(selectedPatient)) {
        // ── 真实患者：构建 API 请求体 ──
        const formValues = form.getFieldsValue() as Record<string, unknown>;
        const dateStr = sessionDate.format('YYYY-MM-DD');
        const preWeightVal = normNum(formValues.pre_weight);

        // 生命体征数组
        const vitalSignsPayload = vitalRows
          .filter(row => row.values.sbp || row.values.systolic_bp)
          .map((row, i) => ({
            sequence_no: i + 1,
            time_label: row.time || `第${i + 1}次`,
            record_time: row.time ? `${dateStr}T${row.time.length === 5 ? row.time + ':00' : row.time}` : new Date().toISOString(),
            systolic_bp: row.values.sbp ? parseInt(row.values.sbp) : undefined,
            diastolic_bp: row.values.dbp ? parseInt(row.values.dbp) : undefined,
            heart_rate: row.values.pulse ? parseInt(row.values.pulse) : undefined,
            arterial_pressure: row.values.ap ? parseInt(row.values.ap) : undefined,
            venous_pressure: row.values.vp ? parseInt(row.values.vp) : undefined,
            tmp: row.values.tmp ? parseInt(row.values.tmp) : undefined,
            notes: row.values.remark || undefined,
          }));

        // 并发症数组（合并类型字符串与详细记录）
        const complicationsPayload = complications.map(compType => ({
          comp_type: compType,
          detail: complicationRecords[compType] || undefined,
          notes: (complicationRecords[compType]?.remark as string) || undefined,
        }));

        // 医嘱执行记录
        const orderExecPayload = realPrepareData?.ordersToday
          .filter(o => orders[o.id] !== undefined)
          .map(o => ({
            long_term_order_id: o.id,
            status: (orders[o.id] ? 'executed' : 'skipped') as 'executed' | 'skipped',
          })) ?? [];

        const payload: CreateDialysisPayload = {
          patient_id: selectedPatient,
          session_date: dateStr,
          shift: (formValues.shift as 'morning' | 'afternoon' | 'evening') || 'morning',
          prescription_id: realPrepareData?.prescription?.id || undefined,
          pre_weight: preWeightVal ?? undefined,
          post_weight: postWeight,
          dry_weight: dryWeight ?? undefined,
          actual_duration: durationHours != null ? Math.round(durationHours * 60) : undefined,
          blood_flow_rate: (formValues.blood_flow_rate as number) || undefined,
          dialysate_flow_rate: (formValues.dialysate_flow_rate as number) || undefined,
          dialysate_temp: (formValues.dialysate_temp as number) || undefined,
          dialysate_ca: (formValues.dialysate_ca as number) || undefined,
          dialysate_k: (formValues.dialysate_k as number) || undefined,
          dialysate_na: (formValues.dialysate_na as number) || undefined,
          heparin_prime_dose: (formValues.heparin_prime_dose as number) || undefined,
          heparin_maintain: (formValues.heparin_maintain as number) || undefined,
          puncture_result: (formValues.puncture_result as 'one_shot' | 'two_shot' | 'difficult') || undefined,
          puncture_method: (formValues.puncture_method as 'rope_ladder' | 'buttonhole' | 'area') || undefined,
          is_avf_session: accessType === 'AVF' || accessType === 'AVG',
          coagulation_grade: (formValues.coagulation_grade as 0 | 1 | 2 | 3) ?? 0,
          blood_return_method: 'closed',
          pre_bun: preBun ?? undefined,
          post_bun: postBun ?? undefined,
          notes: (formValues.remark as string) || undefined,
          vital_signs: vitalSignsPayload,
          complications: complicationsPayload,
          order_executions: orderExecPayload,
        };

        await dialysisApi.create(payload);
        message.success('透析记录已保存，Kt/V已计算并记录');
        removeDialysisEntryDraft(
          dialysisEntryDraftStorageKey(selectedPatient, sessionDate.format('YYYY-MM-DD')),
        );
        setDraftSavedAtIso(null);
        // 清除透后同步缓存
        if (selectedPatient) {
          writePostDialysisSync({
            patientId: selectedPatient,
            postSbp: null,
            postDbp: null,
            postPulse: null,
            postWeightKg: null,
            filledBy: 'nurse',
            updatedAt: new Date().toISOString(),
          });
        }
        navigate('/dashboard');
      } else {
        // ── 演示患者：保持原有模拟逻辑 ──
        await new Promise(r => setTimeout(r, 800));
        message.success('透析记录已保存（演示模式，未写入数据库）');
        removeDialysisEntryDraft(
          dialysisEntryDraftStorageKey(selectedPatient, sessionDate.format('YYYY-MM-DD')),
        );
        setDraftSavedAtIso(null);
        navigate('/dashboard');
      }
    } catch {
      // 错误由 request 拦截器统一提示
    } finally {
      setLoading(false);
    }
  };

  const autoGeneratedDate = sessionDate.format('YYYY年M月D日');
  const prescribingDoctorName =
    PATIENTS_LIST.find(p => p.value === selectedPatient)?.prescribingDoctorName ?? null;
  const hasEmergency = complications.some(c => COMPLICATIONS.find(co => co.value === c)?.emergency);

  const handlePrint = useCallback(() => {
    if (!selectedPatient) { message.warning('请先选择患者后再打印'); return; }
    if (!recordIdFromUrl) {
      message.warning('请先保存记录，再通过「历史记录查询」打开后打印');
      return;
    }
    if (!openedRecordDetail) {
      message.info('历史记录正在加载，请稍后再打印');
      return;
    }
    const patient = PATIENTS_LIST.find(p => p.value === selectedPatient);
    const formValues = form.getFieldsValue() as Record<string, unknown>;
    const html = generatePrintHtml({
      patientLabel: patient?.label?.split(' — ').join(' ') ?? selectedPatient,
      printDate: sessionDate.format('YYYY年MM月DD日'),
      prescribingDoctorName,
      rxPrint: buildRxPrintBundle(rxDefaults, patient ?? null),
      dryWeight,
      postWeight,
      durationHours,
      preBun,
      postBun,
      computedUF,
      ufPercent,
      ufAlert,
      accessType,
      catheterLocation,
      catheterDays,
      complications,
      complicationRecords,
      orders,
      orderRows: orderDisplayList.map(({ key, drug, detail }) => ({ key, drug, detail })),
      vitalRows,
      ktv,
      urr,
      ktvAdequate,
      urrAdequate,
      formValues,
    });
    const win = window.open('', '_blank', 'width=900,height=1000');
    if (!win) { message.error('请允许弹出窗口以进行打印'); return; }
    win.document.write(html);
    win.document.close();
  }, [
    selectedPatient, sessionDate, prescribingDoctorName, rxDefaults, dryWeight, postWeight,
    durationHours, preBun, postBun, computedUF, ufPercent, ufAlert,
    accessType, catheterLocation, catheterDays, complications, complicationRecords,
    orders, orderDisplayList, vitalRows, ktv, urr, ktvAdequate, urrAdequate, form,
    recordIdFromUrl, openedRecordDetail,
  ]);

  useEffect(() => {
    const autoPrint = searchParams.get('autoprint') === '1';
    if (!autoPrint || !recordIdFromUrl || !openedRecordDetail) return;
    if (openedRecordDetail.id !== recordIdFromUrl) return;
    handlePrint();
    const next = new URLSearchParams(searchParams.toString());
    next.delete('autoprint');
    navigate(`/dialysis/entry?${next.toString()}`, { replace: true });
  }, [searchParams, recordIdFromUrl, openedRecordDetail, handlePrint, navigate]);

  return (
    <PageShell fullWidth>
      <div className="hd-page-intro">
        <div>
          <div className="hd-page-intro__eyebrow">Session Record</div>
          <div className="hd-page-intro__title">透析记录录入</div>
        </div>
        <div className="hd-page-intro__chips">
          <span className="hd-page-intro__chip">{sessionDate.format('YYYY年MM月DD日 dddd')}</span>
          <span className="hd-page-intro__chip">{selectedPatientDisplayLabel ?? '未选择患者'}</span>
          {draftSavedAtIso && selectedPatient ? (
            <span className="hd-page-intro__chip">
              临时保存 {dayjs(draftSavedAtIso).format('HH:mm:ss')}
            </span>
          ) : null}
          {recordIdFromUrl ? (
            <span className="hd-page-intro__chip">
              历史记录 #{recordIdFromUrl.slice(0, 8)}
            </span>
          ) : null}
        </div>
      </div>

      {recordIdFromUrl ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 10 }}
          message={openedRecordDetail ? '已加载历史透析记录内容' : '正在加载历史透析记录内容…'}
          description={openedRecordDetail ? `记录ID：${openedRecordDetail.id}` : `记录ID：${recordIdFromUrl}`}
        />
      ) : null}

      <div className="hd-filter-bar">
        <div className="hd-filter-bar__left">
          <span className="hd-toolbar-label">透析日期</span>
          <DatePicker
            value={sessionDate}
            onChange={(val) => val && setSessionDate(val)}
            style={{ width: 130 }}
            format="YYYY-MM-DD"
            size="middle"
          />
        </div>
        <div className="hd-filter-bar__right">
          <Button icon={<HistoryOutlined />} onClick={openHistoryQueryModal}>
            历史记录查询
          </Button>
          <Button icon={<PrinterOutlined />} onClick={handlePrint}>
            打印记录单
          </Button>
          <Button type="primary" icon={<SaveOutlined />} loading={loading} onClick={handleSubmit}>
            {recordIdFromUrl ? '保存为新记录' : '保存记录'}
          </Button>
        </div>
      </div>

      <Form
        form={form}
        layout="vertical"
        size="middle"
        initialValues={nurseSignatureInitialValues}
        onValuesChange={() => {
          schedulePersistDialysisDraft();
        }}
      >

        {/* ══════════════════ ① 患者信息 + 处方 + 体重 ══════════════════ */}
        <Section>
          <SectionTitle step={1} color="#1D4ED8" title="患者信息 · 处方参数 · 体重超滤" />
          <SectionBody>
            {!selectedPatient && (
              <div className="hd-empty-state">
                请从侧栏「今日上机名单」选择患者，或由排班/处方页携带患者链接进入；系统将自动带入处方与评估信息
              </div>
            )}

            {rxPreview && selectedDemoPatient && (
              <>
                <div className="hd-clinical-banner">
                  <span className="hd-clinical-banner__name">
                    {selectedDemoPatient.label.split(' — ')[0]}
                  </span>
                  <Tag color="blue">{rxPreview.shiftChinese}</Tag>
                  <Tag color="geekblue">机位 {rxPreview.machineNo}</Tag>
                  <Tag color={accessType === 'AVF' || accessType === 'AVG' ? 'green' : 'orange'}>
                    {accessType}
                  </Tag>
                  <span className="hd-clinical-banner__copy">
                    开立医师：
                    <strong style={{ color: '#0D1B3E' }}>{selectedDemoPatient.prescribingDoctorName}</strong>
                  </span>
                  <span className="hd-clinical-banner__hint">
                    处方与评估信息自动导入，仅查看不可修改
                  </span>
                </div>

                <div className="hd-split-panels" style={{ marginBottom: 16 }}>
                  <div className="hd-summary-block">
                    <div className="hd-summary-block__title">
                      处方参数
                    </div>
                    <Grid cols={3} gap={10}>
                      <ReadonlyValue label="透析频次" value={rxPreview.frequencyLabel} />
                      <ReadonlyValue label="透析方式" value={rxPreview.modeDisplay} />
                      <ReadonlyValue label="标准时长" value={`${rxPreview.duration} h`} />
                      <ReadonlyValue label="血流速" value={`${rxPreview.bloodFlow} mL/min`} />
                      <ReadonlyValue label="透析液流速" value={`${rxPreview.dialysateFlow} mL/min`} />
                      <ReadonlyValue label="透析器" value={rxPreview.dialyzerShort} />
                      <ReadonlyValue label="Na / K / Ca" value={`${rxPreview.na} / ${rxPreview.k} / ${rxPreview.ca}`} />
                      <ReadonlyValue
                        label="透析液温度 (℃)"
                        value={rxPreview.dialysateTemp != null ? `${rxPreview.dialysateTemp} ℃` : '—'}
                      />
                      <ReadonlyValue label="钠曲线" value={rxPreview.sodiumCurveLine} />
                      <ReadonlyValue label="抗凝方案" value={rxPreview.anticoagulantLabel} />
                      <ReadonlyValue
                        label="首剂"
                        value={rxPreview.heparinFirst != null ? `${rxPreview.heparinFirst} IU` : '—'}
                      />
                      <ReadonlyValue
                        label="追加"
                        value={rxPreview.heparinMaint != null ? `${rxPreview.heparinMaint} IU/h` : '—'}
                      />
                    </Grid>
                  </div>

                  <div className="hd-summary-block">
                    <div className="hd-summary-block__title">
                      透前评估
                    </div>
                    <Grid cols={3} gap={10}>
                      <ReadonlyValue label="收缩压" value={`${rxPreview.preAssessSbp} mmHg`} />
                      <ReadonlyValue label="舒张压" value={`${rxPreview.preAssessDbp} mmHg`} />
                      <ReadonlyValue label="脉搏" value={`${rxPreview.preAssessPulse} 次/分`} />
                      <ReadonlyValue label="水肿" value={rxPreview.edemaDisplay} />
                      <ReadonlyValue label="活动性出血" value={rxPreview.bleedingDisplay} />
                    </Grid>
                    <div style={{ marginTop: 10 }}>
                      <ReadonlyValue
                        label="其他（透前补充）"
                        value={
                          rxPreview.preAssessOther ? (
                            <span style={{ whiteSpace: 'pre-wrap', fontWeight: 700, fontSize: 13 }}>
                              {rxPreview.preAssessOther}
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
                    体重与超滤（与处方工作台「超滤量」一致：(上机前体重−干体重)×1000 + 附加（HD/HDF +200mL，HD+HP +500mL）；处方为只读）
                  </div>
                  <Grid cols={4} gap={14}>
                    <ReadonlyValue label="干体重（处方）" value={`${dryWeight} kg`} color="#1D4ED8" bg="#EFF6FF" border="#BFDBFE" />
                    <ReadonlyValue label="上机前体重（处方）" value={`${rxPreview.preMachineWeightRx} kg`} />
                    <ReadonlyValue
                      label="处方超滤量"
                      value={
                        rxPreview.prescriptionUfMl !== null
                          ? `${rxPreview.prescriptionUfMl} mL${rxPreview.ufAlertPrescription ? ' ⚠️' : ''}`
                          : '—'
                      }
                      color={rxPreview.ufAlertPrescription ? '#BE123C' : '#15803D'}
                      bg={rxPreview.ufAlertPrescription ? '#FFF1F2' : '#F0FDF4'}
                      border={rxPreview.ufAlertPrescription ? '#FECDD3' : '#BBF7D0'}
                    />
                    <ReadonlyValue
                      label="超滤率 = 超滤量 ÷ 时长"
                      value={rxPreview.prescriptionUfRate !== null ? `${rxPreview.prescriptionUfRate} mL/h` : '—'}
                      color="#0369A1"
                      bg="#F0F9FF"
                      border="#BAE6FD"
                    />
                    <ReadonlyValue
                      label="每公斤体重每小时超滤率（干体重）"
                      value={
                        rxPreview.prescriptionUfPerHrPerDryKg != null
                          ? `${rxPreview.prescriptionUfPerHrPerDryKg} mL·h⁻¹·kg⁻¹`
                          : '—'
                      }
                      color="#0369A1"
                      bg="#F0F9FF"
                      border="#BAE6FD"
                    />
                  </Grid>
                </div>

                <div className="hd-signature-row">
                  <span className="hd-signature-label">医生签名：</span>
                  <span className="hd-signature-line">
                    {prescribingDoctorName ?? '—'}
                  </span>
                </div>
              </>
            )}

            {isRealPatientId(selectedPatient) && realPrepareData && (
              <>
                {realPatientRxPreview ? (
                  <>
                    <div className="hd-clinical-banner">
                      <span className="hd-clinical-banner__name">
                        {selectedPatientDisplayLabel?.split(' — ')[0] ?? '患者'}
                      </span>
                      <Tag color="blue">{realPatientRxPreview.shiftChinese}班</Tag>
                      <Tag color="geekblue">机位 {realPatientRxPreview.machineStation}</Tag>
                      <span className="hd-clinical-banner__hint">
                        与「透析处方管理」当前保存参数同步；上机前体重可在下方第⑦段修改
                      </span>
                    </div>

                    <div className="hd-split-panels" style={{ marginBottom: 16 }}>
                      <div className="hd-summary-block">
                        <div className="hd-summary-block__title">
                          处方参数（数据库当前处方）
                        </div>
                        <Grid cols={3} gap={10}>
                          <ReadonlyValue label="透析频次" value={realPatientRxPreview.frequencyLabel} />
                          <ReadonlyValue label="透析方式（生效）" value={realPatientRxPreview.modeDisplay} />
                          <ReadonlyValue label="标准时长" value={`${realPatientRxPreview.duration} h`} />
                          {realPatientRxPreview.scheduleDiffers && realPatientRxPreview.scheduleModeOnly ? (
                            <ReadonlyValue
                              label="处方 / 今日排班"
                              value={`${realPatientRxPreview.prescriptionModeOnly} / ${realPatientRxPreview.scheduleModeOnly}`}
                            />
                          ) : null}
                          {realPatientRxPreview.hdfExtra ? (
                            <ReadonlyValue label="HDF 置换" value={realPatientRxPreview.hdfExtra} />
                          ) : null}
                          <ReadonlyValue label="血流速" value={`${realPatientRxPreview.bloodFlow} mL/min`} />
                          <ReadonlyValue label="透析液流速" value={`${realPatientRxPreview.dialysateFlow} mL/min`} />
                          <ReadonlyValue label="透析器" value={realPatientRxPreview.dialyzerShort} />
                          <ReadonlyValue label="Na / K / Ca" value={`${realPatientRxPreview.na} / ${realPatientRxPreview.k} / ${realPatientRxPreview.ca}`} />
                          <ReadonlyValue
                            label="透析液温度 (℃)"
                            value={realPatientRxPreview.dialysateTemp != null ? `${realPatientRxPreview.dialysateTemp} ℃` : '—'}
                          />
                          <ReadonlyValue label="钠曲线" value={realPatientRxPreview.sodiumCurveDisplay} />
                          <ReadonlyValue
                            label="处方备注"
                            value={
                              realPatientRxPreview.prescriptionNotesDisplay !== '—' ? (
                                <span style={{ whiteSpace: 'pre-wrap', fontWeight: 600, fontSize: 13 }}>
                                  {realPatientRxPreview.prescriptionNotesDisplay}
                                </span>
                              ) : (
                                '—'
                              )
                            }
                          />
                          <ReadonlyValue label="抗凝方案" value={realPatientRxPreview.anticoagulantLabel} />
                          <ReadonlyValue
                            label="首剂"
                            value={realPatientRxPreview.heparinFirst != null ? `${realPatientRxPreview.heparinFirst} IU` : '—'}
                          />
                          <ReadonlyValue
                            label="追加"
                            value={realPatientRxPreview.heparinMaint != null ? `${realPatientRxPreview.heparinMaint} IU/h` : '—'}
                          />
                        </Grid>
                      </div>

                      <div className="hd-summary-block">
                        <div className="hd-summary-block__title">
                          透前评估（与透析处方管理同步）
                        </div>
                        <Grid cols={3} gap={10}>
                          <ReadonlyValue
                            label="收缩压"
                            value={
                              realPatientRxPreview.preAssessSbp != null
                                ? `${realPatientRxPreview.preAssessSbp} mmHg`
                                : '—'
                            }
                          />
                          <ReadonlyValue
                            label="舒张压"
                            value={
                              realPatientRxPreview.preAssessDbp != null
                                ? `${realPatientRxPreview.preAssessDbp} mmHg`
                                : '—'
                            }
                          />
                          <ReadonlyValue
                            label="脉搏"
                            value={
                              realPatientRxPreview.preAssessPulse != null
                                ? `${realPatientRxPreview.preAssessPulse} 次/分`
                                : '—'
                            }
                          />
                          <ReadonlyValue label="水肿" value={realPatientRxPreview.edemaDisplay} />
                          <ReadonlyValue label="活动性出血" value={realPatientRxPreview.bleedingDisplay} />
                        </Grid>
                        <div style={{ marginTop: 10 }}>
                          <ReadonlyValue
                            label="其他（透前补充）"
                            value={
                              realPatientRxPreview.preAssessOtherDisplay !== '—' ? (
                                <span style={{ whiteSpace: 'pre-wrap', fontWeight: 700, fontSize: 13 }}>
                                  {realPatientRxPreview.preAssessOtherDisplay}
                                </span>
                              ) : (
                                '—'
                              )
                            }
                          />
                        </div>
                        <div style={{ marginTop: 10 }}>
                          <ReadonlyValue
                            label="血透方式备注（处方）"
                            value={realPatientRxPreview.hemodialysisRemark ?? '—'}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="hd-summary-block hd-summary-block--warm">
                      <div className="hd-summary-block__title">
                        体重与超滤（与处方工作台公式一致；上机前体重默认取干体重，请在第⑦段改为实测值）
                      </div>
                      <Grid cols={4} gap={14}>
                        <ReadonlyValue label="干体重（处方）" value={`${dryWeight ?? '—'} kg`} color="#1D4ED8" bg="#EFF6FF" border="#BFDBFE" />
                        <ReadonlyValue label="上机前体重（用于估算）" value={`${realPatientRxPreview.preMachineWeightRx} kg`} />
                        <ReadonlyValue
                          label="处方超滤量"
                          value={
                            `${realPatientRxPreview.prescriptionUfMl} mL${realPatientRxPreview.ufAlertPrescription ? ' ⚠️' : ''}`
                          }
                          color={realPatientRxPreview.ufAlertPrescription ? '#BE123C' : '#15803D'}
                          bg={realPatientRxPreview.ufAlertPrescription ? '#FFF1F2' : '#F0FDF4'}
                          border={realPatientRxPreview.ufAlertPrescription ? '#FECDD3' : '#BBF7D0'}
                        />
                        <ReadonlyValue
                          label="超滤率 = 超滤量 ÷ 时长"
                          value={realPatientRxPreview.prescriptionUfRate != null ? `${realPatientRxPreview.prescriptionUfRate} mL/h` : '—'}
                          color="#0369A1"
                          bg="#F0F9FF"
                          border="#BAE6FD"
                        />
                        <ReadonlyValue
                          label="每公斤体重每小时超滤率（干体重）"
                          value={
                            realPatientRxPreview.prescriptionUfPerHrPerDryKg != null
                              ? `${realPatientRxPreview.prescriptionUfPerHrPerDryKg} mL·h⁻¹·kg⁻¹`
                              : '—'
                          }
                          color="#0369A1"
                          bg="#F0F9FF"
                          border="#BAE6FD"
                        />
                      </Grid>
                    </div>
                  </>
                ) : (
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="暂无当前有效透析处方"
                    description="请医生在「透析处方管理」中保存处方后，本页将自动从数据库带入参数。"
                  />
                )}
              </>
            )}
          </SectionBody>
        </Section>

        {/* ══════════════════ ② 通路信息 ══════════════════ */}
        <Section>
          <SectionTitle step={2} color="#0891B2" title="血管通路信息" />
          <SectionBody>
            {/* 通路类型选择条 */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '8px 12px', background: '#F0F9FF',
              borderRadius: 8, border: '1px solid #BAE6FD', marginBottom: 14,
            }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#0369A1', whiteSpace: 'nowrap' }}>通路类型</span>
              <Radio.Group
                value={accessType}
                onChange={(e) => {
                  setAccessType(e.target.value);
                  schedulePersistDialysisDraft();
                }}
                optionType="button"
                buttonStyle="solid"
              >
                <Radio.Button value="AVF">AVF 自体内瘘</Radio.Button>
                <Radio.Button value="AVG">AVG 人工血管</Radio.Button>
                <Radio.Button value="TCC">TCC 长期导管</Radio.Button>
                <Radio.Button value="NCC">NCC 临时导管</Radio.Button>
              </Radio.Group>
              {selectedPatient && (
                <Tag color="blue" style={{ marginLeft: 'auto', fontSize: 11 }}>已从通路管理同步</Tag>
              )}
            </div>

            {/* AVF / AVG 字段 */}
            {(accessType === 'AVF' || accessType === 'AVG') && (
              <>
                <Grid cols={4} gap={14} style={{ marginBottom: 12 }}>
                  <Form.Item label={<FieldLabel text="震颤" />} style={{ marginBottom: 0 }}>
                    <Select defaultValue="strong" options={[
                      { value: 'strong', label: '强' },
                      { value: 'weak', label: '弱' },
                      { value: 'none', label: '无' },
                    ]} />
                  </Form.Item>
                  <Form.Item label={<FieldLabel text="杂音" />} style={{ marginBottom: 0 }}>
                    <Select defaultValue="strong" options={[
                      { value: 'strong', label: '强' },
                      { value: 'weak', label: '弱' },
                      { value: 'none', label: '无' },
                    ]} />
                  </Form.Item>
                  <Form.Item label={<FieldLabel text="动脉端血流" />} style={{ marginBottom: 0 }}>
                    <Select defaultValue="full" options={[
                      { value: 'full', label: '饱满' },
                      { value: 'weak', label: '减弱' },
                    ]} />
                  </Form.Item>
                  <Form.Item label={<FieldLabel text="静脉端血流" />} style={{ marginBottom: 0 }}>
                    <Select defaultValue="full" options={[
                      { value: 'full', label: '饱满' },
                      { value: 'weak', label: '减弱' },
                    ]} />
                  </Form.Item>
                  <Form.Item label={<FieldLabel text="局部红肿" />} style={{ marginBottom: 0 }}>
                    <Select defaultValue="none" options={[
                      { value: 'none', label: '无' },
                      { value: 'yes', label: '有' },
                    ]} />
                  </Form.Item>
                  <Form.Item label={<FieldLabel text="血管瘤" />} style={{ marginBottom: 0 }}>
                    <Select defaultValue="none" options={[
                      { value: 'none', label: '无' },
                      { value: 'yes', label: '有' },
                    ]} />
                  </Form.Item>
                  <Form.Item label={<FieldLabel text="穿刺结果" />} style={{ marginBottom: 0 }}>
                    <Select defaultValue="success" options={[
                      { value: 'success', label: '一针成功' },
                      { value: 'second', label: '二次穿刺' },
                      { value: 'difficult', label: '穿刺困难' },
                    ]} />
                  </Form.Item>
                  <Form.Item label={<FieldLabel text="固定情况" />} style={{ marginBottom: 0 }}>
                    <Select defaultValue="firm" options={[
                      { value: 'firm', label: '固定牢固' },
                      { value: 'loose', label: '需重新固定' },
                    ]} />
                  </Form.Item>
                </Grid>
                <Form.Item label={<FieldLabel text="通知医生" />} style={{ marginBottom: 0 }}>
                  <Radio.Group defaultValue="no">
                    <Radio value="yes">已通知</Radio>
                    <Radio value="no">无需通知</Radio>
                  </Radio.Group>
                </Form.Item>
              </>
            )}

            {/* TCC / NCC 字段 */}
            {(accessType === 'TCC' || accessType === 'NCC') && (
              <Grid cols={4} gap={14}>
                <Form.Item label={<FieldLabel text="导管位置" />} style={{ marginBottom: 0 }}>
                  <Select
                    value={catheterLocation || undefined}
                    onChange={(v) => {
                      setCatheterLocation(v);
                      schedulePersistDialysisDraft();
                    }}
                    options={[
                      { value: 'right_jugular', label: '右颈内静脉' },
                      { value: 'left_jugular', label: '左颈内静脉' },
                      { value: 'right_femoral', label: '右股静脉' },
                      { value: 'left_femoral', label: '左股静脉' },
                      { value: 'right_subclavian', label: '右锁骨下静脉' },
                      { value: 'left_subclavian', label: '左锁骨下静脉' },
                    ]}
                  />
                </Form.Item>
                <Form.Item
                  label={
                    <Tooltip title={catheterPlacedDate ? `置管日期：${catheterPlacedDate}（来自通路管理）` : '未找到置管日期'}>
                      <FieldLabel text="留置天数 ℹ" />
                    </Tooltip>
                  }
                  style={{ marginBottom: 0 }}
                >
                  <Input
                    value={catheterDays !== null ? `${catheterDays} 天` : '—'}
                    readOnly
                    style={{
                      background: '#F0F9FF',
                      color: catheterDays !== null && catheterDays > 90 ? '#D97706' : '#0369A1',
                      fontWeight: 700, cursor: 'default',
                    }}
                    suffix={catheterDays !== null && catheterDays > 90 ? <WarningFilled style={{ color: '#D97706' }} /> : undefined}
                  />
                </Form.Item>
                <Form.Item label={<FieldLabel text="导管出口情况" />} style={{ marginBottom: 0 }}>
                  <Select defaultValue="normal" options={[
                    { value: 'normal', label: '正常' },
                    { value: 'erythema', label: '红肿' },
                    { value: 'discharge', label: '渗液' },
                    { value: 'crust', label: '结痂' },
                  ]} />
                </Form.Item>
                <Form.Item label={<FieldLabel text="分泌物" />} style={{ marginBottom: 0 }}>
                  <Select defaultValue="none" options={[
                    { value: 'none', label: '无' },
                    { value: 'serous', label: '有（浆液性）' },
                    { value: 'purulent', label: '有（脓性）' },
                    { value: 'bloody', label: '有（血性）' },
                  ]} />
                </Form.Item>
                <Form.Item label={<FieldLabel text="导管固定" />} style={{ marginBottom: 0 }}>
                  <Select defaultValue="firm" options={[
                    { value: 'firm', label: '固定牢固' },
                    { value: 'loose', label: '松动需处理' },
                    { value: 'replaced', label: '已更换敷料' },
                  ]} />
                </Form.Item>
                <Form.Item label={<FieldLabel text="通知医生" />} style={{ marginBottom: 0 }}>
                  <Radio.Group defaultValue="no">
                    <Radio value="yes">已通知</Radio>
                    <Radio value="no">无需通知</Radio>
                  </Radio.Group>
                </Form.Item>
              </Grid>
            )}
          </SectionBody>
        </Section>

        {/* ══════════════════ ③ 护士签名 ══════════════════ */}
        <Section>
          <SectionTitle step={3} color="#7C3AED" title="护士签名（上机前）" />
          <SectionBody>
            <Grid cols={3} gap={14}>
              <Form.Item
                label={<FieldLabel text="穿刺护士" required />}
                name="nurse_puncture_sign"
                rules={[{ required: true, message: '请填写或确认穿刺护士签名' }]}
                style={{ marginBottom: 0 }}
              >
                <Input placeholder="请填写护士姓名" />
              </Form.Item>
              <Form.Item
                label={<FieldLabel text="上机护士" required />}
                name="nurse_on_machine_sign"
                rules={[{ required: true, message: '请填写或确认上机护士签名' }]}
                style={{ marginBottom: 0 }}
              >
                <Input placeholder="请填写护士姓名" />
              </Form.Item>
              <Form.Item label={<FieldLabel text="二次核对护士" />} name="nurse_double_check_sign" style={{ marginBottom: 0 }}>
                <Input placeholder="选填" />
              </Form.Item>
            </Grid>
          </SectionBody>
        </Section>

        {/* ══════════════════ ④ 生命体征记录 ══════════════════ */}
        <Section>
          <SectionTitle
            step={4}
            color="#059669"
            title="透析中生命体征记录"
            extra={
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: '#64748B' }}>
                  <ClockCircleOutlined /> 每50分钟记录一次 · 时间由系统自动生成
                </span>
                <Button
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={handleAddVitalRow}
                  type="primary"
                  ghost
                >
                  新增记录
                </Button>
              </div>
            }
          />
          <SectionBody style={{ padding: '12px 18px' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr>
                    {[
                      { label: '时间', width: 60 },
                      { label: '收缩压\n(mmHg)', width: 70 },
                      { label: '舒张压\n(mmHg)', width: 70 },
                      { label: '脉搏\n(次/分)', width: 70 },
                      { label: '动脉压\n(mmHg)', width: 70 },
                      { label: '静脉压\n(mmHg)', width: 70 },
                      { label: '跨膜压\n(mmHg)', width: 70 },
                      { label: '血流速\n(mL/min)', width: 76 },
                      { label: '备注', width: 100 },
                      { label: '护士签名', width: 90 },
                      { label: '', width: 44 },
                    ].map((h, i) => (
                      <th key={i} style={{
                        background: '#F1F5F9', color: '#475569',
                        padding: '7px 6px', fontSize: 11, fontWeight: 600,
                        textAlign: 'center', border: '1px solid #E2E8F0',
                        whiteSpace: 'pre-line', lineHeight: 1.3,
                        width: h.width,
                      }}>
                        {h.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {vitalRows.map((row, idx) => (
                    <tr key={row.id} style={{ background: idx % 2 === 0 ? '#fff' : '#FAFBFC' }}>
                      <td style={{
                        padding: '5px 8px', border: '1px solid #E2E8F0',
                        fontWeight: 600, color: '#1D4ED8', textAlign: 'center',
                        fontSize: 12, whiteSpace: 'nowrap',
                        fontFamily: 'DM Mono, monospace',
                      }}>
                        {row.time}
                      </td>
                      {['sbp', 'dbp', 'pulse', 'ap', 'vp', 'tmp', 'bloodflow', 'remark', 'signature'].map(field => (
                        <td key={field} style={{ padding: 3, border: '1px solid #E2E8F0', textAlign: 'center' }}>
                          <input
                            type={field === 'remark' || field === 'signature' ? 'text' : 'number'}
                            value={row.values[field] || ''}
                            onChange={e => handleVitalChange(row.id, field, e.target.value)}
                            placeholder={field === 'signature' ? '录入数据后自动填写' : ''}
                            style={{
                              width: '100%', padding: '4px 6px',
                              border: '1px solid transparent',
                              borderRadius: 4, textAlign: 'center',
                              fontSize: 12.5, background: 'transparent',
                              outline: 'none',
                              fontFamily: field === 'signature' ? 'inherit' : 'DM Mono, monospace',
                              color: field === 'signature' ? '#7C3AED' : '#0D1B3E',
                            }}
                            onFocus={e => {
                              e.currentTarget.style.background = '#EFF6FF';
                              e.currentTarget.style.borderColor = '#93C5FD';
                            }}
                            onBlur={e => {
                              e.currentTarget.style.background = 'transparent';
                              e.currentTarget.style.borderColor = 'transparent';
                            }}
                          />
                        </td>
                      ))}
                      <td style={{ padding: 3, border: '1px solid #E2E8F0', textAlign: 'center' }}>
                        <Button
                          danger size="small"
                          icon={<DeleteOutlined />}
                          onClick={() => handleRemoveVitalRow(row.id)}
                          type="text"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionBody>
        </Section>

        {/* ══════════════════ ⑤ 医嘱执行 + 并发症（并排） ══════════════════ */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>

          {/* 医嘱执行 */}
          <Section style={{ marginBottom: 0 }}>
            <SectionTitle step={5} color="#D97706" title="今日医嘱执行确认" />
            <SectionBody>
              {isRealPatientId(selectedPatient) && realPrepareData && orderExecutionGroups.length === 0 && (
                <Alert
                  type="info" showIcon
                  message="本透析日暂无待确认的透析用药医嘱（未开立、已停止，或频次不在今日执行）"
                  style={{ marginBottom: 10, fontSize: 12 }}
                />
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {orderExecutionGroups.map((g) => {
                  const allDone = g.rows.length > 0 && g.rows.every((r) => orders[r.key]);
                  const borderOk = allDone ? '#6EE7B7' : '#FDE68A';
                  const bgOuter = allDone ? '#ECFDF5' : '#FFFBF0';
                  const anyPriorExec = g.rows.some((r) => r.alreadyExecuted);

                  if (g.isCombo) {
                    return (
                      <div
                        key={g.groupId}
                        style={{
                          border: `1.5px solid ${borderOk}`,
                          borderRadius: 8,
                          overflow: 'hidden',
                          background: bgOuter,
                          transition: 'all 0.15s',
                        }}
                      >
                        <div
                          style={{
                            padding: '6px 12px',
                            fontSize: 11,
                            fontWeight: 600,
                            color: '#B45309',
                            background: '#FEF3C7',
                            borderBottom: '1px solid #FDE68A',
                          }}
                        >
                          组合医嘱（共用用法与频次）
                        </div>
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => handleComboGroupToggle(g, !allDone)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              handleComboGroupToggle(g, !allDone);
                            }
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 10,
                            padding: '12px',
                            cursor: 'pointer',
                            background: allDone ? '#F0FDF4' : '#FFFBEB',
                          }}
                        >
                          <Checkbox
                            checked={allDone}
                            onChange={(e) => {
                              e.stopPropagation();
                              handleComboGroupToggle(g, e.target.checked);
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            {g.rows.map((o, idx) => (
                              <div
                                key={o.key}
                                style={{
                                  marginBottom: idx < g.rows.length - 1 ? 10 : 0,
                                  paddingBottom: idx < g.rows.length - 1 ? 10 : 0,
                                  borderBottom: idx < g.rows.length - 1 ? '1px dashed #E7DCC8' : undefined,
                                }}
                              >
                                <div style={{ fontWeight: 600, color: '#0D1B3E', fontSize: 13 }}>
                                  {o.isComboChild ? (
                                    <>
                                      <span style={{ color: '#94A3B8', marginRight: 4 }}>↳</span>
                                      {o.drug}
                                    </>
                                  ) : (
                                    o.drug
                                  )}
                                </div>
                                <div style={{ fontSize: 11, color: '#7B92BC', marginTop: 2 }}>{o.detail}</div>
                              </div>
                            ))}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                            {anyPriorExec && (
                              <Tag color="processing" style={{ fontSize: 10, margin: 0 }}>已有执行记录</Tag>
                            )}
                            {allDone
                              ? <Tag color="success" icon={<CheckCircleFilled />}>已执行</Tag>
                              : <Tag color="warning">待执行</Tag>
                            }
                          </div>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={g.groupId}
                      style={{
                        border: `1.5px solid ${borderOk}`,
                        borderRadius: 8,
                        overflow: 'hidden',
                        background: bgOuter,
                        transition: 'all 0.15s',
                      }}
                    >
                      {g.rows.map((o) => (
                        <div
                          key={o.key}
                          role="button"
                          tabIndex={0}
                          onClick={() => handleOrderToggle(o.key, !orders[o.key])}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              handleOrderToggle(o.key, !orders[o.key]);
                            }
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '10px 12px',
                            cursor: 'pointer',
                            background: orders[o.key] ? '#F0FDF4' : '#FFFBEB',
                            transition: 'background 0.12s',
                          }}
                        >
                          <Checkbox
                            checked={!!orders[o.key]}
                            onChange={() => {}}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, color: '#0D1B3E', fontSize: 13 }}>{o.drug}</div>
                            <div style={{ fontSize: 11, color: '#7B92BC', marginTop: 1 }}>{o.detail}</div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                            {o.alreadyExecuted && (
                              <Tag color="processing" style={{ fontSize: 10, margin: 0 }}>已有执行记录</Tag>
                            )}
                            {orders[o.key]
                              ? <Tag color="success" icon={<CheckCircleFilled />}>已执行</Tag>
                              : <Tag color="warning">待执行</Tag>
                            }
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </SectionBody>
          </Section>

          {/* 并发症记录 */}
          <Section style={{ marginBottom: 0 }}>
            <SectionTitle step={6} color={hasEmergency ? '#DC2626' : '#64748B'} title="并发症记录（点击选中后填写处理记录）" />
            <SectionBody>
              {hasEmergency && (
                <Alert
                  type="error" showIcon
                  message="检测到紧急并发症！请立即通知值班医生并按应急流程处理。"
                  style={{ marginBottom: 10, padding: '6px 10px', fontSize: 12 }}
                />
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {COMPLICATIONS.map(c => {
                  const active = complications.includes(c.value);
                  const record = complicationRecords[c.value];
                  const hasFilled = active && record && Object.keys(record).length > 0;
                  return (
                    <div key={c.value} style={{
                      border: `1.5px solid ${active ? (c.emergency ? '#F43F5E' : '#0EA5E9') : '#E2E8F0'}`,
                      borderRadius: 8,
                      background: active ? (c.emergency ? '#FFF1F2' : '#EFF9FF') : '#FAFBFC',
                      overflow: 'hidden',
                      transition: 'all 0.12s',
                    }}>
                      {/* 主行：勾选 + 标签 + 操作 */}
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '8px 10px', cursor: 'pointer',
                      }}
                        onClick={() => {
                          if (active) return; // 已选中时只能通过右侧X取消
                          setComplications(prev => [...prev, c.value]);
                          setTreatmentModalTarget(c.value);
                          treatmentForm.resetFields();
                          treatmentForm.setFieldValue('occurrenceTime', dayjs().format('HH:mm'));
                          treatmentForm.setFieldValue('nurse', signerLabel);
                          schedulePersistDialysisDraft();
                        }}
                      >
                        <Checkbox
                          checked={active}
                          onChange={() => {}}
                          style={{ pointerEvents: 'none', flexShrink: 0 }}
                        />
                        {c.emergency && <WarningFilled style={{ color: '#F43F5E', fontSize: 12, flexShrink: 0 }} />}
                        <span style={{
                          flex: 1, fontSize: 13,
                          color: c.emergency ? '#BE123C' : '#1E293B',
                          fontWeight: c.emergency ? 600 : 500,
                        }}>
                          {c.label}
                        </span>
                        {c.emergency && !active && (
                          <Tag color="error" style={{ fontSize: 10, padding: '0 4px', lineHeight: '16px', flexShrink: 0 }}>紧急</Tag>
                        )}
                        {active && (
                          <div style={{ display: 'flex', gap: 5, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                            <Button
                              size="small" type="link"
                              icon={hasFilled ? <EditOutlined /> : <FileTextOutlined />}
                              style={{ padding: '0 4px', fontSize: 12, color: c.emergency ? '#DC2626' : '#0369A1' }}
                              onClick={() => {
                                setTreatmentModalTarget(c.value);
                                const base = record ?? { occurrenceTime: dayjs().format('HH:mm') };
                                const n = String((base as Record<string, unknown>).nurse ?? '').trim();
                                treatmentForm.setFieldsValue({
                                  ...base,
                                  nurse: n || signerLabel,
                                });
                              }}
                            >
                              {hasFilled ? '编辑记录' : '填写处理记录'}
                            </Button>
                            <Button
                              size="small" type="text" danger
                              icon={<CloseOutlined />}
                              style={{ padding: '0 4px', fontSize: 11 }}
                              onClick={() => {
                                setComplications(prev => prev.filter(x => x !== c.value));
                                setComplicationRecords(prev => {
                                  const next = { ...prev };
                                  delete next[c.value];
                                  return next;
                                });
                                schedulePersistDialysisDraft();
                              }}
                            />
                          </div>
                        )}
                      </div>
                      {/* 已填写记录摘要 */}
                      {hasFilled && (
                        <div style={{
                          padding: '5px 10px 7px 36px',
                          borderTop: `1px dashed ${c.emergency ? '#FECDD3' : '#BAE6FD'}`,
                          background: c.emergency ? '#FFF5F5' : '#F0F9FF',
                          fontSize: 11, color: '#64748B', lineHeight: 1.6,
                        }}>
                          {!!record.occurrenceTime && <span style={{ marginRight: 12 }}>⏱ {record.occurrenceTime as string}</span>}
                          {!!record.nurse && <span style={{ marginRight: 12 }}>✍ {record.nurse as string}</span>}
                          {record.doctorNotified === 'yes' && <Tag color="orange" style={{ fontSize: 10, lineHeight: '16px' }}>已通知医生</Tag>}
                          {record.isCompleteStopped === 'yes' && <Tag color="red" style={{ fontSize: 10, lineHeight: '16px' }}>计入质控</Tag>}
                          {(record.remark as string) && (
                            <div style={{ marginTop: 2, color: '#475569', fontStyle: 'italic' }}>
                              备注：{(record.remark as string).slice(0, 40)}{(record.remark as string).length > 40 ? '…' : ''}
                            </div>
                          )}
                        </div>
                      )}
                      {/* 未填写提示 */}
                      {active && !hasFilled && (
                        <div style={{
                          padding: '4px 10px 6px 36px',
                          borderTop: `1px dashed ${c.emergency ? '#FECDD3' : '#BAE6FD'}`,
                          fontSize: 11, color: '#F59E0B', fontStyle: 'italic',
                        }}>
                          ⚠ 请点击「填写处理记录」完善本次并发症记录
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </SectionBody>
          </Section>
        </div>

        {/* 间期用药（非透析日）：标准展示为「周几或每月几日」，不在此页执行确认 */}
        {isRealPatientId(selectedPatient) && intervalOrdersReadonly.length > 0 && (
          <div style={{
            marginBottom: 12,
            border: '1px solid #E2E8F0',
            borderRadius: 8,
            overflow: 'hidden',
            background: '#fff',
          }}>
            <div style={{
              padding: '10px 16px',
              background: '#F8FAFC',
              borderBottom: '1px solid #E2E8F0',
              fontWeight: 600,
              fontSize: 14,
              color: '#475569',
            }}>
              间期用药（非透析日）· 具体执行约定
            </div>
            <div style={{ padding: 12 }}>
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 10, fontSize: 12 }}
                message="以下药品在透析间期使用；执行时间以长期医嘱填写的「周几或日期」为准，不在上方「今日医嘱执行确认」中勾选。"
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {intervalOrdersReadonly.map((o) => (
                  <div
                    key={o.id}
                    style={{
                      padding: '10px 12px',
                      border: '1px solid #EEF2F7',
                      borderRadius: 8,
                      background: '#FAFBFC',
                    }}
                  >
                    <div style={{ fontWeight: 600, color: '#0D1B3E', fontSize: 13 }}>{o.drug_name}</div>
                    <div style={{ fontSize: 11, color: '#64748B', marginTop: 4 }}>
                      {[o.dose, o.dose_unit].filter(Boolean).join(' ')} · {o.route} · {FREQ_LABELS[o.frequency] || o.frequency}
                    </div>
                    <div style={{ fontSize: 12, color: '#0369A1', marginTop: 6 }}>
                      <strong>具体执行：</strong>
                      {describeFrequencyDetailForOrder(o.frequency, o.frequency_detail)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════ ⑦ 透析后评估 ══════════════════ */}
        <Section>
          <SectionTitle step={7} color="#0D1B3E" title="透析后评估 · 充分性计算（Kt/V）" />
          <SectionBody>
            {postDialysisLockedByDoctor && (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 14 }}
                message="透后数据已由医生在透析处方工作台填写"
                description="与「透析处方管理」页共用同一份数据，此处无需重复填写；如需更正请由医生在处方页修改。"
              />
            )}

            <SubsectionTitle first>体重、时间与液体</SubsectionTitle>
            <Grid cols={4} gap={14} style={{ marginBottom: 10 }}>
              <Form.Item label={<FieldLabel text="实际透析时长" required />} style={{ marginBottom: 0 }}>
                <InputNumber
                  min={0} max={8} step={0.1} precision={1}
                  style={{ width: '100%' }} addonAfter="h"
                  value={durationHours ?? undefined}
                  onChange={(v) => {
                    setDurationHours(v);
                    schedulePersistDialysisDraft();
                  }}
                />
              </Form.Item>
              <Form.Item
                name="pre_weight"
                label={<FieldLabel text="上机前体重（kg）" />}
                style={{ marginBottom: 0 }}
                tooltip="默认取处方干体重，请改为当日实测值；用于脱水量与 Kt/V 计算"
              >
                <InputNumber
                  min={20} max={200} step={0.1} precision={1}
                  style={{ width: '100%' }} addonAfter="kg"
                  placeholder="实测上机前体重"
                />
              </Form.Item>
              <Form.Item label={<FieldLabel text="透析后体重" required />} style={{ marginBottom: 0 }}>
                <InputNumber
                  min={20} max={200} step={0.1} precision={1}
                  style={{ width: '100%' }} addonAfter="kg"
                  value={postWeight ?? undefined}
                  onChange={(v) => {
                    setPostWeight(v);
                    schedulePersistDialysisDraft();
                  }}
                  placeholder="如：62.0"
                  disabled={postDialysisLockedByDoctor}
                />
              </Form.Item>
              <Form.Item label={<FieldLabel text="透析期间入量" />} style={{ marginBottom: 0 }}>
                <InputNumber min={0} max={10000} style={{ width: '100%' }} addonAfter="mL" />
              </Form.Item>
            </Grid>
            <div style={{ marginBottom: 14 }}>
              <FieldLabel text="实际脱水量（自动）" />
              <div style={{
                marginTop: 4, padding: '8px 12px',
                background: computedUF !== null ? (ufAlert ? '#FFF1F2' : '#F0FDF4') : '#F8FAFC',
                border: `1px solid ${computedUF !== null ? (ufAlert ? '#FECDD3' : '#BBF7D0') : '#E2E8F0'}`,
                borderRadius: 6, fontWeight: 700, fontSize: 15,
                color: computedUF !== null ? (ufAlert ? '#BE123C' : '#15803D') : '#94A3B8',
                fontFamily: 'DM Mono, monospace',
                display: 'flex', alignItems: 'center', gap: 6,
                minHeight: 36,
              }}>
                {computedUF !== null
                  ? <>{computedUF} mL {ufPercent && <span style={{ fontSize: 12, fontWeight: 400 }}>({ufPercent}%)</span>}{ufAlert && <WarningFilled />}</>
                  : '—'
                }
              </div>
            </div>

            <SubsectionTitle>透后生命体征</SubsectionTitle>
            <Grid cols={3} gap={14} style={{ marginBottom: 14 }}>
              <Form.Item name="post_sbp" label={<FieldLabel text="收缩压" />} style={{ marginBottom: 0 }}>
                <InputNumber min={60} max={250} style={{ width: '100%' }} addonAfter="mmHg" disabled={postDialysisLockedByDoctor} />
              </Form.Item>
              <Form.Item name="post_dbp" label={<FieldLabel text="舒张压" />} style={{ marginBottom: 0 }}>
                <InputNumber min={40} max={160} style={{ width: '100%' }} addonAfter="mmHg" disabled={postDialysisLockedByDoctor} />
              </Form.Item>
              <Form.Item name="post_pulse" label={<FieldLabel text="脉搏" />} style={{ marginBottom: 0 }}>
                <InputNumber min={30} max={220} style={{ width: '100%' }} addonAfter="次/分" disabled={postDialysisLockedByDoctor} />
              </Form.Item>
            </Grid>

            <SubsectionTitle>凝血与通路</SubsectionTitle>
            <Grid cols={3} gap={14} style={{ marginBottom: 14 }}>
              <Form.Item label={<FieldLabel text="凝血分级" />} style={{ marginBottom: 0 }}>
                <Select defaultValue="0" options={[
                  { value: '0', label: '0级（无凝血）' },
                  { value: '1', label: 'Ⅰ级（<20%变黑）' },
                  { value: '2', label: 'Ⅱ级（静脉壶明显）' },
                  { value: '3', label: 'Ⅲ级（>50%或停机）' },
                ]} />
              </Form.Item>
              <Form.Item label={<FieldLabel text="渗血部位" />} style={{ marginBottom: 0 }}>
                <Input placeholder="如：动脉穿刺点（无则留空）" />
              </Form.Item>
              <Form.Item label={<FieldLabel text="置管封管用药" />} style={{ marginBottom: 0 }}>
                <Input placeholder="如：肝素钠 1mL" />
              </Form.Item>
            </Grid>

            <SubsectionTitle>透析过程与设备</SubsectionTitle>
            <Grid cols={3} gap={14} style={{ marginBottom: 14 }}>
              <Form.Item label={<FieldLabel text="透析期间患者状态" />} style={{ marginBottom: 0 }}>
                <Select defaultValue="stable" options={[
                  { value: 'stable', label: '平稳' },
                  { value: 'general', label: '一般' },
                  { value: 'unstable', label: '不稳定' },
                ]} />
              </Form.Item>
              <Form.Item label={<FieldLabel text="下机后机器运行" />} style={{ marginBottom: 0 }}>
                <Select defaultValue="normal" options={[
                  { value: 'normal', label: '正常' },
                  { value: 'abnormal', label: '异常' },
                ]} />
              </Form.Item>
              <Form.Item label={<FieldLabel text="下机消毒方式" />} style={{ marginBottom: 0 }}>
                <Select defaultValue="thermal-chemical" options={[
                  { value: 'thermal-chemical', label: '热化学消毒' },
                  { value: 'chemical', label: '化学消毒' },
                  { value: 'other', label: '其他' },
                ]} />
              </Form.Item>
            </Grid>

            <SubsectionTitle>护理确认</SubsectionTitle>
            <Grid cols={2} gap={20} style={{ marginBottom: 14 }}>
              <Form.Item label={<FieldLabel text="局部皮肤完好" />} style={{ marginBottom: 0 }}>
                <Radio.Group defaultValue="yes" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <Radio value="yes">是</Radio>
                  <Radio value="no">否</Radio>
                </Radio.Group>
              </Form.Item>
              <Form.Item label={<FieldLabel text="透后用药执行" />} style={{ marginBottom: 0 }}>
                <Radio.Group defaultValue="yes" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <Radio value="yes">是</Radio>
                  <Radio value="no">否</Radio>
                </Radio.Group>
              </Form.Item>
            </Grid>

            <SubsectionTitle>尿素（Kt/V / URR）</SubsectionTitle>
            <Grid cols={2} gap={14} style={{ marginBottom: 14, maxWidth: 560 }}>
              <Form.Item label={<FieldLabel text="透前 BUN" />} style={{ marginBottom: 0 }}>
                <InputNumber min={1} max={100} step={0.1} precision={1} style={{ width: '100%' }}
                  value={preBun ?? undefined}
                  onChange={(v) => {
                    setPreBun(v);
                    schedulePersistDialysisDraft();
                  }}
                  placeholder="透析前"
                  addonAfter="mmol/L"
                />
              </Form.Item>
              <Form.Item label={<FieldLabel text="透后 BUN" />} style={{ marginBottom: 0 }}>
                <InputNumber
                  min={1}
                  max={100}
                  step={0.1}
                  precision={1}
                  style={{ width: '100%' }}
                  value={postBun ?? undefined}
                  onChange={(v) => {
                    setPostBun(v);
                    schedulePersistDialysisDraft();
                  }}
                  placeholder="透析后"
                  addonAfter="mmol/L"
                />
              </Form.Item>
            </Grid>

            {/* BUN 数据异常提示 */}
            {preBun && postBun && ktv === null && (
              <Alert
                type="error" showIcon
                message="BUN 数值异常（透后BUN应小于透前BUN），请核查数据。"
                style={{ marginBottom: 14 }}
                action={
                  canAnomaly && isRealPatientId(selectedPatient) ? (
                    <Button
                      size="small"
                      onClick={() => {
                        setAnomalyCtx({ anomalyType: 'bun_invalid' });
                        setAnomalyOpen(true);
                      }}
                    >
                      分析
                    </Button>
                  ) : undefined
                }
              />
            )}

            <SubsectionTitle>充分性计算（自动）</SubsectionTitle>
            {/* Kt/V + URR + 超滤 结果卡片 */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 12, marginBottom: 14,
            }}>
              {/* spKt/V */}
              <div style={{
                padding: '14px 16px', borderRadius: 10, textAlign: 'center',
                background: ktv === null
                  ? '#F8FAFC'
                  : ktvAdequate ? 'linear-gradient(135deg,#ECFDF5,#D1FAE5)' : 'linear-gradient(135deg,#FFFBEB,#FEF3C7)',
                border: `2px solid ${ktv === null ? '#E2E8F0' : ktvAdequate ? '#34D399' : '#FCD34D'}`,
              }}>
                <div style={{ fontSize: 11, color: '#64748B', marginBottom: 4, fontWeight: 500 }}>
                  spKt/V（Daugirdas II）
                </div>
                {ktv !== null ? (
                  <>
                    <div style={{
                      fontFamily: 'DM Mono, monospace', fontSize: 32, fontWeight: 700, lineHeight: 1.1,
                      color: ktvAdequate ? '#059669' : '#D97706',
                    }}>{ktv}</div>
                    <Tag
                      color={ktvAdequate ? 'success' : 'warning'}
                      icon={ktvAdequate ? <CheckCircleFilled /> : <WarningFilled />}
                      style={{ marginTop: 6, fontSize: 12 }}
                    >
                      {ktvAdequate ? '达标 ≥ 1.2' : '不达标 < 1.2'}
                    </Tag>
                    {canAnomaly && isRealPatientId(selectedPatient) && !ktvAdequate ? (
                      <div style={{ marginTop: 8 }}>
                        <Button
                          type="link"
                          size="small"
                          onClick={() => {
                            setAnomalyCtx({ anomalyType: 'ktv_inadequate' });
                            setAnomalyOpen(true);
                          }}
                        >
                          分析
                        </Button>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div style={{ color: '#94A3B8', fontSize: 13, marginTop: 8 }}>
                    <InfoCircleFilled style={{ marginRight: 4 }} />
                    填写 BUN 后自动计算
                  </div>
                )}
              </div>

              {/* URR */}
              <div style={{
                padding: '14px 16px', borderRadius: 10, textAlign: 'center',
                background: urr === null
                  ? '#F8FAFC'
                  : urrAdequate ? 'linear-gradient(135deg,#ECFDF5,#D1FAE5)' : 'linear-gradient(135deg,#FFFBEB,#FEF3C7)',
                border: `2px solid ${urr === null ? '#E2E8F0' : urrAdequate ? '#34D399' : '#FCD34D'}`,
              }}>
                <div style={{ fontSize: 11, color: '#64748B', marginBottom: 4, fontWeight: 500 }}>
                  URR（尿素清除率）
                </div>
                {urr !== null ? (
                  <>
                    <div style={{
                      fontFamily: 'DM Mono, monospace', fontSize: 32, fontWeight: 700, lineHeight: 1.1,
                      color: urrAdequate ? '#059669' : '#D97706',
                    }}>{urr}%</div>
                    <Tag
                      color={urrAdequate ? 'success' : 'warning'}
                      icon={urrAdequate ? <CheckCircleFilled /> : <WarningFilled />}
                      style={{ marginTop: 6, fontSize: 12 }}
                    >
                      {urrAdequate ? '达标 ≥ 65%' : '不达标 < 65%'}
                    </Tag>
                    {canAnomaly && isRealPatientId(selectedPatient) && urr !== null && !urrAdequate ? (
                      <div style={{ marginTop: 8 }}>
                        <Button
                          type="link"
                          size="small"
                          onClick={() => {
                            setAnomalyCtx({ anomalyType: 'urr_inadequate' });
                            setAnomalyOpen(true);
                          }}
                        >
                          分析
                        </Button>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div style={{ color: '#94A3B8', fontSize: 13, marginTop: 8 }}>
                    <InfoCircleFilled style={{ marginRight: 4 }} />
                    填写 BUN 后自动计算
                  </div>
                )}
              </div>

              {/* 超滤量 */}
              <div style={{
                padding: '14px 16px', borderRadius: 10, textAlign: 'center',
                background: computedUF === null
                  ? '#F8FAFC'
                  : ufAlert ? 'linear-gradient(135deg,#FFF1F2,#FFE4E6)' : 'linear-gradient(135deg,#F0F9FF,#E0F2FE)',
                border: `2px solid ${computedUF === null ? '#E2E8F0' : ufAlert ? '#FB7185' : '#7DD3FC'}`,
              }}>
                <div style={{ fontSize: 11, color: '#64748B', marginBottom: 4, fontWeight: 500 }}>
                  实际超滤量
                </div>
                {computedUF !== null ? (
                  <>
                    <div style={{
                      fontFamily: 'DM Mono, monospace', fontSize: 28, fontWeight: 700, lineHeight: 1.1,
                      color: ufAlert ? '#BE123C' : '#0284C7',
                    }}>{computedUF} <span style={{ fontSize: 16 }}>mL</span></div>
                    <div style={{ marginTop: 4 }}>
                      {ufPercent && (
                        <Tag
                          color={ufAlert ? 'error' : 'processing'}
                          icon={ufAlert ? <WarningFilled /> : undefined}
                          style={{ fontSize: 12 }}
                        >
                          {ufPercent}% 干体重 {ufAlert ? '— 超限！' : ''}
                        </Tag>
                      )}
                    </div>
                    {ufAlert && (
                      <div style={{ marginTop: 6, fontSize: 11, color: '#BE123C', fontWeight: 500 }}>
                        超滤量超过干体重5%，需通知医生
                      </div>
                    )}
                    {canAnomaly && isRealPatientId(selectedPatient) && ufAlert ? (
                      <div style={{ marginTop: 8 }}>
                        <Button
                          type="link"
                          size="small"
                          onClick={() => {
                            setAnomalyCtx({ anomalyType: 'uf_exceed' });
                            setAnomalyOpen(true);
                          }}
                        >
                          分析
                        </Button>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div style={{ color: '#94A3B8', fontSize: 13, marginTop: 8 }}>
                    <InfoCircleFilled style={{ marginRight: 4 }} />
                    填写前后体重后自动计算
                  </div>
                )}
              </div>
            </div>

            {/* 备注 + 签名 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 20, alignItems: 'flex-start' }}>
              <Form.Item name="remark" label={<FieldLabel text="护士备注" />} style={{ marginBottom: 0 }}>
                <Input.TextArea rows={3} placeholder="记录本次透析特殊情况、护理观察、患者反馈等…" />
              </Form.Item>
              <div style={{ width: 280 }}>
                <Form.Item
                  label={<FieldLabel text="护士签名" required />}
                  name="nurse_record_sign"
                  rules={[{ required: true, message: '请填写或确认记录护士签名' }]}
                  style={{ marginBottom: 10 }}
                >
                  <Input placeholder="默认当前登录用户，可修改" prefix={<span style={{ color: '#7C3AED' }}>✍</span>} />
                </Form.Item>
                <Form.Item label={<FieldLabel text="记录日期" />} style={{ marginBottom: 0 }}>
                  <Input value={autoGeneratedDate} readOnly style={{ background: '#F8FAFC', color: '#475569' }} />
                </Form.Item>
              </div>
            </div>
          </SectionBody>
        </Section>

        {/* ══════════════ 并发症处理记录弹框 ══════════════ */}
        {treatmentModalTarget && (() => {
          const cfg = COMPLICATION_CONFIG[treatmentModalTarget];
          const comp = COMPLICATIONS.find(c => c.value === treatmentModalTarget);
          if (!cfg || !comp) return null;
          return (
            <Modal
              open
              title={
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {comp.emergency && <WarningFilled style={{ color: '#DC2626', fontSize: 16 }} />}
                  <span style={{ color: cfg.color, fontWeight: 700 }}>{cfg.title}</span>
                </div>
              }
              width={620}
              okText="保存处理记录"
              cancelText="取消"
              onOk={() => {
                treatmentForm.validateFields().then(values => {
                  setComplicationRecords(prev => ({ ...prev, [treatmentModalTarget]: values }));
                  setTreatmentModalTarget(null);
                  treatmentForm.resetFields();
                  message.success(`${comp.label}处理记录已保存`);
                  schedulePersistDialysisDraft();
                }).catch(() => {
                  message.warning('请填写必填项');
                });
              }}
              onCancel={() => setTreatmentModalTarget(null)}
              styles={{
                header: {
                  background: comp.emergency ? '#FFF1F2' : '#F0F9FF',
                  borderBottom: `2px solid ${comp.emergency ? '#FECDD3' : '#BFDBFE'}`,
                  paddingBottom: 12,
                },
              }}
            >
              {comp.emergency && (
                <Alert
                  type="error" showIcon
                  message="紧急并发症：请严格按应急流程操作，并立即通知值班医生！"
                  style={{ marginBottom: 14, fontSize: 12 }}
                />
              )}
              <Form form={treatmentForm} layout="vertical" size="middle">
                {cfg.fields.map(field => {
                  if (field.type === 'text') return (
                    <Form.Item
                      key={field.key} name={field.key} label={field.label}
                      rules={field.required ? [{ required: true, message: `请填写${field.label}` }] : []}
                      style={{ marginBottom: 12 }}
                    >
                      <Input placeholder={field.placeholder} />
                    </Form.Item>
                  );
                  if (field.type === 'number') return (
                    <Form.Item
                      key={field.key} name={field.key} label={field.label}
                      rules={field.required ? [{ required: true, message: `请填写${field.label}` }] : []}
                      style={{ marginBottom: 12 }}
                    >
                      <InputNumber
                        placeholder={field.placeholder}
                        style={{ width: '100%' }}
                        step={0.1} precision={1}
                      />
                    </Form.Item>
                  );
                  if (field.type === 'textarea') return (
                    <Form.Item
                      key={field.key} name={field.key} label={field.label}
                      rules={field.required ? [{ required: true, message: `请填写${field.label}` }] : []}
                      style={{ marginBottom: 12 }}
                    >
                      <Input.TextArea rows={2} placeholder={field.placeholder} />
                    </Form.Item>
                  );
                  if (field.type === 'select') return (
                    <Form.Item
                      key={field.key} name={field.key} label={field.label}
                      rules={field.required ? [{ required: true, message: `请选择${field.label}` }] : []}
                      style={{ marginBottom: 12 }}
                    >
                      <Select options={field.options} placeholder={`请选择${field.label}`} />
                    </Form.Item>
                  );
                  if (field.type === 'radio') return (
                    <Form.Item
                      key={field.key} name={field.key} label={field.label}
                      rules={field.required ? [{ required: true, message: `请选择${field.label}` }] : []}
                      style={{ marginBottom: 12 }}
                    >
                      <Radio.Group>
                        {field.options.map(o => <Radio key={o.value} value={o.value}>{o.label}</Radio>)}
                      </Radio.Group>
                    </Form.Item>
                  );
                  if (field.type === 'checkbox-group') return (
                    <Form.Item
                      key={field.key} name={field.key} label={field.label}
                      rules={field.required ? [{ required: true, message: `请至少选择一项${field.label}` }] : []}
                      style={{ marginBottom: 12 }}
                    >
                      <Form.Item noStyle shouldUpdate={(prev, curr) => prev[field.key] !== curr[field.key]}>
                        {() => {
                          return (
                            <Checkbox.Group
                              style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}
                              onChange={(vals) => {
                                const nextValues = vals as string[];
                                field.options.forEach((o) => {
                                  if (o.inputKey && !nextValues.includes(o.value)) {
                                    treatmentForm.setFieldValue(o.inputKey, undefined);
                                  }
                                });
                              }}
                            >
                              {field.options.map(o => {
                                const withInput = !!o.inputKey;
                                return (
                                  <div
                                    key={o.value}
                                    style={{
                                      marginInlineStart: 0,
                                      padding: withInput ? '3px 8px' : '3px 10px',
                                      border: '1px solid #E2E8F0',
                                      borderRadius: 5,
                                      fontSize: 12.5,
                                      background: '#FAFBFC',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: withInput ? 4 : 0,
                                    }}
                                  >
                                    <Checkbox value={o.value} style={{ marginInlineStart: 0 }}>
                                      {o.label}
                                    </Checkbox>
                                    {withInput && (
                                      <>
                                        <span>（</span>
                                        <Form.Item
                                          noStyle
                                          name={o.inputKey}
                                          rules={[
                                            ({ getFieldValue }) => ({
                                              validator(_rule, value) {
                                                const selected = (getFieldValue(field.key) as string[] | undefined) ?? [];
                                                if (!selected.includes(o.value)) return Promise.resolve();
                                                if (value === null || value === undefined || value === '') {
                                                  return Promise.reject(new Error(o.inputRequiredMessage || `请填写${o.label}剂量`));
                                                }
                                                return Promise.resolve();
                                              },
                                            }),
                                          ]}
                                        >
                                          <InputNumber
                                            min={o.inputMin}
                                            max={o.inputMax}
                                            step={o.inputStep ?? 1}
                                            precision={o.inputPrecision}
                                            placeholder={o.inputPlaceholder}
                                            style={{ width: 90 }}
                                            size="small"
                                            onFocus={() => {
                                              const selected = (treatmentForm.getFieldValue(field.key) as string[] | undefined) ?? [];
                                              if (!selected.includes(o.value)) {
                                                treatmentForm.setFieldValue(field.key, [...selected, o.value]);
                                              }
                                            }}
                                          />
                                        </Form.Item>
                                        <span>）{o.inputUnit ?? ''}</span>
                                      </>
                                    )}
                                  </div>
                                );
                              })}
                            </Checkbox.Group>
                          );
                        }}
                      </Form.Item>
                    </Form.Item>
                  );
                  return null;
                })}
              </Form>
            </Modal>
          );
        })()}

        {/* 底部操作栏 */}
        <div className="hd-form-footer" style={{ justifyContent: 'flex-end' }}>
          <div className="hd-form-footer__actions">
            {hasEmergency && (
              <span style={{ color: '#DC2626', fontSize: 13, fontWeight: 600 }}>
                <WarningFilled /> 存在紧急并发症，请确认已通知医生
              </span>
            )}
            <Button icon={<HistoryOutlined />} onClick={openHistoryQueryModal} size="large">
              历史记录查询
            </Button>
            <Button icon={<PrinterOutlined />} onClick={handlePrint} size="large">
              打印记录单
            </Button>
            <Button type="primary" icon={<SaveOutlined />} loading={loading} onClick={handleSubmit} size="large">
              保存透析记录
            </Button>
          </div>
        </div>
      </Form>
      <Modal
        title="历史透析记录查询"
        open={historyOpen}
        onCancel={() => setHistoryOpen(false)}
        footer={null}
        width={1120}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
          <div style={{ minWidth: 230, flex: '1 1 230px' }}>
            <div className="hd-toolbar-label" style={{ marginBottom: 6 }}>患者</div>
            <Select
              value={historyPatientId || undefined}
              onChange={(val) => setHistoryPatientId(val || '')}
              options={historyPatientOptions}
              loading={historyPatientLoading}
              placeholder="全部患者"
              allowClear
              showSearch
              optionFilterProp="label"
              style={{ width: '100%' }}
            />
          </div>
          <div style={{ minWidth: 280, flex: '1 1 280px' }}>
            <div className="hd-toolbar-label" style={{ marginBottom: 6 }}>透析日期范围</div>
            <DatePicker.RangePicker
              value={historyDateRange}
              onChange={(dates) => setHistoryDateRange((dates as [Dayjs | null, Dayjs | null] | null) ?? null)}
              style={{ width: '100%' }}
            />
          </div>
          <div style={{ minWidth: 140, flex: '0 0 140px' }}>
            <div className="hd-toolbar-label" style={{ marginBottom: 6 }}>班次</div>
            <Select
              value={historyShift}
              onChange={(val) => setHistoryShift(val)}
              options={[
                { value: 'all', label: '全部班次' },
                { value: 'morning', label: '早班' },
                { value: 'afternoon', label: '中班' },
                { value: 'evening', label: '晚班' },
              ]}
              style={{ width: '100%' }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
            <Button
              icon={<SearchOutlined />}
              type="primary"
              onClick={() => {
                void loadHistoryRecords({ page: 1 });
              }}
              loading={historyLoading}
            >
              查询
            </Button>
            <Button
              onClick={() => {
                const resetPatientId =
                  selectedPatient && isRealPatientId(selectedPatient) ? selectedPatient : '';
                setHistoryPatientId(resetPatientId);
                setHistoryShift('all');
                setHistoryDateRange(null);
                void loadHistoryRecords({
                  page: 1,
                  patientId: resetPatientId || undefined,
                  shift: 'all',
                  dateRange: null,
                });
              }}
            >
              重置
            </Button>
          </div>
        </div>

        <Table
          rowKey="id"
          size="small"
          loading={historyLoading}
          dataSource={historyRows}
          scroll={{ x: 980 }}
          locale={{ emptyText: '暂无符合条件的透析历史记录' }}
          pagination={{
            current: historyPage,
            pageSize: historyPageSize,
            total: historyTotal,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条`,
            onChange: (page, pageSize) => {
              void loadHistoryRecords({ page, pageSize });
            },
          }}
          columns={[
            {
              title: '透析日期',
              dataIndex: 'session_date',
              width: 130,
              render: (value: string) => {
                const parsed = toFixedDateFromAny(value)?.format('YYYY-MM-DD');
                if (parsed) return parsed;
                const fallback = String(value || '').slice(0, 10);
                return fallback || '—';
              },
            },
            {
              title: '患者',
              dataIndex: 'patient_name',
              width: 170,
              render: (value: string | undefined) => value || '—',
            },
            {
              title: '班次',
              dataIndex: 'shift',
              width: 90,
              render: (value: string) => <Tag color="blue" style={{ margin: 0 }}>{shiftLabelFromRecord(value)}</Tag>,
            },
            {
              title: '透前/透后体重',
              key: 'weights',
              width: 150,
              render: (_value: unknown, record: DialysisRecordListRow) =>
                `${record.pre_weight ?? '—'} / ${record.post_weight ?? '—'} kg`,
            },
            {
              title: '超滤量',
              dataIndex: 'uf_volume',
              width: 90,
              render: (value: number | null) => (value != null ? `${value} mL` : '—'),
            },
            {
              title: 'Kt/V',
              dataIndex: 'ktv',
              width: 80,
              render: (value: number | null) => (value != null ? value : '—'),
            },
            {
              title: '记录护士',
              dataIndex: 'nurse_name',
              width: 110,
              render: (value: string | undefined) => value || '—',
            },
            {
              title: '操作',
              key: 'actions',
              width: 190,
              fixed: 'right',
              render: (_value: unknown, record: DialysisRecordListRow) => (
                <Space size={6}>
                  <Button
                    type="link"
                    size="small"
                    onClick={() => {
                      void openHistoryRecord(record.id, false);
                    }}
                    loading={historyActionLoadingId === record.id}
                  >
                    打开记录
                  </Button>
                  <Button
                    type="link"
                    size="small"
                    onClick={() => {
                      void openHistoryRecord(record.id, true);
                    }}
                    loading={historyActionLoadingId === record.id}
                  >
                    打印
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </Modal>
      {anomalyCtx && selectedPatient && isRealPatientId(selectedPatient) ? (
        <AnomalyAnalysisModal
          open={anomalyOpen}
          onClose={() => setAnomalyOpen(false)}
          patientId={selectedPatient}
          anomalyType={anomalyCtx.anomalyType}
          contextId={anomalyCtx.contextId}
          patientLabel={selectedPatientDisplayLabel}
        />
      ) : null}
    </PageShell>
  );
}
