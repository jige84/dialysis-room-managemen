/**
 * 检验结果列表与录入页
 * 主要作用：维护患者化验指标，供透析充分性与贫血等模块引用。
 * 主要功能：按患者/类别分组展示或明细表；手动分组录入；化验单 OCR；对接 labs API。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Card,
  Select,
  Button,
  Table,
  Input,
  Tooltip,
  Modal,
  Form,
  DatePicker,
  message,
  Space,
  Spin,
  Collapse,
  Segmented,
  Typography,
  Tag,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  SearchOutlined,
  PlusOutlined,
  ScanOutlined,
  AppstoreOutlined,
  UnorderedListOutlined,
  MinusCircleOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import PageShell from '../../components/PageShell/PageShell';
import { PageEmpty } from '../../components/PageStates/PageStates';
import LabOcrModal from '../../components/LabOcrModal/LabOcrModal';
import labsApi, {
  LAB_TYPE_LABELS,
  type LabMonthCompletion,
  type LabResultListRow,
  type LabReviewDueSoonRow,
} from '../../api/labs';
import AnomalyAnalysisModal from '../../components/AnomalyAnalysisModal/AnomalyAnalysisModal';
import type { AnomalyType } from '../../utils/anomalyAnalysis';
import { patientsApi, type Patient } from '../../api/patients';
import { useAuthStore } from '../../stores/authStore';
import {
  analyzeLabValue,
  formatReferenceRange,
  getCategoryForTestType,
  type LabStatusUi,
} from '../../utils/labReportOcr';

const { Text } = Typography;

const STATUS_CONFIG: Record<string, { label: string; className: string; tagColor: string; tagBg: string }> = {
  normal: { label: '正常', className: 'lab-normal', tagColor: '#059669', tagBg: '#ECFDF5' },
  high: { label: '偏高', className: 'lab-high', tagColor: '#D97706', tagBg: '#FFFBEB' },
  low: { label: '偏低', className: 'lab-low', tagColor: '#4338CA', tagBg: '#EEF2FF' },
  critical: { label: '危急值', className: 'lab-critical', tagColor: '#BE123C', tagBg: '#FFF1F2' },
};

const CATEGORIES = ['全部类别', '电解质', '贫血', 'CKD-MBD', '营养', '生化', '传染病筛查', '其他'];

/** 化验类别展示顺序（与筛选、分组一致） */
const CATEGORY_ORDER = ['电解质', '贫血', 'CKD-MBD', '营养', '生化', '传染病筛查', '其他'] as const;

function buildLabTypeGroupedSelectOptions() {
  const byCat = new Map<string, { label: string; value: string }[]>();
  for (const [value, label] of Object.entries(LAB_TYPE_LABELS)) {
    const cat = getCategoryForTestType(value);
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat)!.push({ value, label });
  }
  for (const arr of byCat.values()) {
    arr.sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
  }
  const sections: { label: string; options: { label: string; value: string }[] }[] = [];
  for (const cat of CATEGORY_ORDER) {
    const opts = byCat.get(cat);
    if (opts?.length) sections.push({ label: cat, options: opts });
  }
  for (const [cat, opts] of byCat) {
    if (!CATEGORY_ORDER.includes(cat as (typeof CATEGORY_ORDER)[number])) {
      sections.push({ label: cat, options: opts });
    }
  }
  return sections;
}

const LAB_TYPE_GROUPED_OPTIONS = buildLabTypeGroupedSelectOptions();

const DEFAULT_REVIEW_CYCLE_DAYS = 90;
const LAB_REVIEW_CYCLE_DAYS_UI: Record<string, number> = {
  hb: 30,
  hct: 30,
  k: 30,
  na: 30,
  ca: 30,
  p: 30,
  hco3: 30,
  ipth: 90,
  alb: 90,
  b2mg: 180,
  sf: 90,
  tsat: 90,
  bun: 90,
  cr: 90,
  // 传染病筛查：每6个月复查一次（约180天）
  hbsag: 180,
  hcv: 180,
  hiv: 180,
  tp: 180,
};

function getDueDayjsForRow(r: LabResultListRow): dayjs.Dayjs {
  if (r.next_review_date) return dayjs(r.next_review_date);
  const cycleDays = LAB_REVIEW_CYCLE_DAYS_UI[r.test_type] ?? DEFAULT_REVIEW_CYCLE_DAYS;
  const base = r.test_date ? dayjs(r.test_date) : dayjs();
  if (!base.isValid()) return dayjs();
  return base.add(cycleDays, 'day');
}

interface PatientCategoryGroup {
  patientId: string;
  patientName: string;
  patientGender: string;
  categories: { name: string; rows: LabResultListRow[] }[];
}

function groupByPatientAndCategory(rows: LabResultListRow[]): PatientCategoryGroup[] {
  const pmap = new Map<
    string,
    { patientName: string; patientGender: string; list: LabResultListRow[] }
  >();
  for (const r of rows) {
    const cur = pmap.get(r.patient_id);
    if (cur) {
      cur.list.push(r);
    } else {
      pmap.set(r.patient_id, {
        patientName: r.patient_name,
        patientGender: r.patient_gender,
        list: [r],
      });
    }
  }
  const out: PatientCategoryGroup[] = [];
  for (const [patientId, meta] of pmap) {
    const catMap = new Map<string, LabResultListRow[]>();
    for (const row of meta.list) {
      const c = getCategoryForTestType(row.test_type);
      if (!catMap.has(c)) catMap.set(c, []);
      catMap.get(c)!.push(row);
    }
    const categories: { name: string; rows: LabResultListRow[] }[] = [];
    for (const name of CATEGORY_ORDER) {
      const chunk = catMap.get(name);
      if (chunk?.length) {
        chunk.sort((a, b) => String(b.test_date).localeCompare(String(a.test_date)));
        categories.push({ name, rows: chunk });
        catMap.delete(name);
      }
    }
    for (const [name, chunk] of catMap) {
      chunk.sort((a, b) => String(b.test_date).localeCompare(String(a.test_date)));
      categories.push({ name, rows: chunk });
    }
    out.push({
      patientId,
      patientName: meta.patientName,
      patientGender: meta.patientGender,
      categories,
    });
  }
  out.sort((a, b) => {
    const ac = a.categories.some((c) => c.rows.some((r) => rowToUiStatus(r) === 'critical')) ? 1 : 0;
    const bc = b.categories.some((c) => c.rows.some((r) => rowToUiStatus(r) === 'critical')) ? 1 : 0;
    if (bc !== ac) return bc - ac;
    return a.patientName.localeCompare(b.patientName, 'zh-CN');
  });
  return out;
}

function rowToUiStatus(r: LabResultListRow): LabStatusUi {
  const n = Number(r.value);
  const { status } = analyzeLabValue(r.test_type, n);
  return status;
}

function makeLabColumns(opts: {
  showPatient: boolean;
  showCategory: boolean;
  canSetRecheck: boolean;
  onOpenRecheck: (r: LabResultListRow) => void;
  onAnomalyAnalyze?: (r: LabResultListRow, anomalyType: AnomalyType) => void;
}): ColumnsType<LabResultListRow> {
  const patientCol: ColumnsType<LabResultListRow>[0] = {
    title: '患者',
    width: 140,
    render: (_: unknown, r: LabResultListRow) => (
      <div className="flex items-center gap-8">
        <div
          className={`hd-avatar ${r.patient_gender === 'F' ? 'hd-avatar-f' : 'hd-avatar-m'}`}
          style={{ width: 30, height: 30, fontSize: 12 }}
        >
          {r.patient_name.charAt(0)}
        </div>
        <span style={{ fontWeight: 600 }}>{r.patient_name}</span>
      </div>
    ),
  };
  const categoryCol: ColumnsType<LabResultListRow>[0] = {
    title: '类别',
    width: 100,
    render: (_: unknown, r: LabResultListRow) => {
      const cat = getCategoryForTestType(r.test_type);
      return (
        <span
          style={{
            background: '#EEF2FF',
            color: '#4338CA',
            padding: '2px 8px',
            borderRadius: 20,
            fontSize: 11.5,
          }}
        >
          {cat}
        </span>
      );
    },
  };
  const rest: ColumnsType<LabResultListRow> = [
    {
      title: '检测日期',
      width: 112,
      dataIndex: 'test_date',
      render: (v: string) => (
        <span className="num text-sm">{v ? String(v).slice(0, 10) : '—'}</span>
      ),
    },
    ...(opts.showCategory ? [categoryCol] : []),
    {
      title: '检验项目',
      width: opts.showPatient ? undefined : 140,
      render: (_: unknown, r: LabResultListRow) => (
        <span style={{ fontWeight: 500 }}>{LAB_TYPE_LABELS[r.test_type] ?? r.test_type}</span>
      ),
    },
    {
      title: '结果值',
      width: 120,
      render: (_: unknown, r: LabResultListRow) => {
        const ui = rowToUiStatus(r);
        const s = STATUS_CONFIG[ui];
        return (
          <Tooltip title={ui === 'critical' ? '危急值，需立即处理' : ''}>
            <span className={`num ${s.className}`}>
              {r.value} {r.unit}
              {ui === 'critical' && ' ⚡'}
            </span>
          </Tooltip>
        );
      },
    },
    {
      title: '参考范围',
      render: (_: unknown, r: LabResultListRow) => (
        <span className="text-sm text-muted">{formatReferenceRange(r.test_type)}</span>
      ),
    },
    {
      title: '状态',
      width: 88,
      render: (_: unknown, r: LabResultListRow) => {
        const ui = rowToUiStatus(r);
        const s = STATUS_CONFIG[ui];
        return (
          <span
            style={{
              background: s.tagBg,
              color: s.tagColor,
              padding: '3px 9px',
              borderRadius: 20,
              fontSize: 12,
              fontWeight: 500,
            }}
          >
            {s.label}
          </span>
        );
      },
    },
    {
      title: '下次复查',
      width: 96,
      render: (_: unknown, r: LabResultListRow) => {
        const ui = rowToUiStatus(r);
        const due = getDueDayjsForRow(r);
        const date = due?.format('YYYY-MM-DD');
        const showBtn = opts.canSetRecheck;
        return (
          <Space size={8}>
            <span
              className="num text-sm"
              style={{
                color: ui === 'critical' ? '#BE123C' : date ? '#D97706' : undefined,
              }}
            >
              {date ?? '—'}
            </span>
            {showBtn ? (
              <Button
                type="link"
                size="small"
                onClick={() => opts.onOpenRecheck(r)}
                style={{ paddingInline: 0 }}
              >
                设定
              </Button>
            ) : null}
          </Space>
        );
      },
    },
  ];
  if (opts.onAnomalyAnalyze) {
    rest.push({
      title: '分析',
      width: 72,
      render: (_: unknown, r: LabResultListRow) => {
        const ui = rowToUiStatus(r);
        const abnormal = r.is_critical || r.is_abnormal || ui === 'critical' || ui === 'high' || ui === 'low';
        if (!abnormal) return <span className="text-muted">—</span>;
        const at: AnomalyType = r.is_critical || ui === 'critical' ? 'lab_critical' : 'lab_abnormal';
        return (
          <Button type="link" size="small" onClick={() => opts.onAnomalyAnalyze?.(r, at)}>
            分析
          </Button>
        );
      },
    });
  }
  if (opts.showPatient) {
    return [patientCol, ...rest];
  }
  return rest;
}

export default function LabResultListPage() {
  const hasLabWrite = useAuthStore((s) => s.hasRole(['admin', 'doctor', 'head_nurse']));
  const canSetRecheckByRole = useAuthStore((s) => s.hasRole(['admin', 'doctor']));
  const canSetRecheck = canSetRecheckByRole;
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [list, setList] = useState<LabResultListRow[]>([]);
  const recordsRef = useRef<HTMLDivElement | null>(null);

  // 统计卡弹窗数据
  const [dueSoonOpen, setDueSoonOpen] = useState(false);
  const [dueSoonLoading, setDueSoonLoading] = useState(false);
  const [dueSoonRows, setDueSoonRows] = useState<LabReviewDueSoonRow[]>([]);
  const [dueSoonCount, setDueSoonCount] = useState(0);

  const [monthCompletionOpen, setMonthCompletionOpen] = useState(false);
  const [monthCompletionLoading, setMonthCompletionLoading] = useState(false);
  const [monthCompletion, setMonthCompletion] = useState<LabMonthCompletion | null>(null);

  const [recheckOpen, setRecheckOpen] = useState(false);
  const [recheckSaving, setRecheckSaving] = useState(false);
  const [recheckTarget, setRecheckTarget] = useState<{
    patient_id: string;
    test_type: string;
    next_review_date?: string;
  } | null>(null);
  const [recheckDate, setRecheckDate] = useState<dayjs.Dayjs | null>(null);

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('全部类别');
  const [statusFilter, setStatusFilter] = useState('');
  const [recordScope, setRecordScope] = useState<'recent7' | 'all'>('recent7');
  const [showModal, setShowModal] = useState(false);
  const [showOcr, setShowOcr] = useState(false);
  const [viewMode, setViewMode] = useState<'grouped' | 'table'>('grouped');
  const [form] = Form.useForm();
  const [patientOptions, setPatientOptions] = useState<Patient[]>([]);
  const [saving, setSaving] = useState(false);

  const [anomalyOpen, setAnomalyOpen] = useState(false);
  const [anomalyCtx, setAnomalyCtx] = useState<{
    patientId: string;
    anomalyType: AnomalyType;
    contextId?: string;
    patientName?: string;
  } | null>(null);

  const openAnomaly = useCallback((r: LabResultListRow, anomalyType: AnomalyType) => {
    setAnomalyCtx({
      patientId: r.patient_id,
      anomalyType,
      contextId: r.id,
      patientName: r.patient_name,
    });
    setAnomalyOpen(true);
  }, []);

  const loadPatients = useCallback(async () => {
    try {
      const res = await patientsApi.list({ page: 1, page_size: 500, status: 'active' });
      const rows = res.data?.data?.list;
      if (Array.isArray(rows)) setPatientOptions(rows);
    } catch {
      message.error('加载患者列表失败');
    }
  }, []);

  useEffect(() => {
    void loadPatients();
  }, [loadPatients]);

  const loadLabRecords = useCallback(async (scope: 'recent7' | 'all') => {
    setLoading(true);
    try {
      if (scope === 'all') {
        const res = await labsApi.listGlobal({ page: 1, page_size: 1000 });
        const rows = res.data?.data?.list;
        setList(Array.isArray(rows) ? rows : []);
        return;
      }

      const res = await labsApi.listRecent({ days: 7, page: 1, page_size: 1000 });
      const rows = res.data?.data;
      setList(Array.isArray(rows) ? rows : []);
    } catch {
      message.error(scope === 'all' ? '加载历史检验结果失败' : '加载近7天检验结果失败');
      setList([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLabRecords(recordScope);
  }, [loadLabRecords, recordScope]);

  const loadDueSoonMeta = useCallback(async () => {
    setDueSoonLoading(true);
    try {
      const res = await labsApi.getReviewDueSoon({ days: 7 });
      const rows = res.data?.data;
      const list = Array.isArray(rows) ? rows : [];
      setDueSoonRows(list);
      setDueSoonCount(list.length);
    } catch {
      setDueSoonRows([]);
      setDueSoonCount(0);
      message.error('加载到期提醒失败');
    } finally {
      setDueSoonLoading(false);
    }
  }, []);

  const loadMonthCompletionMeta = useCallback(async () => {
    setMonthCompletionLoading(true);
    try {
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;
      const res = await labsApi.getMonthCompletion({ year, month });
      const obj = res.data?.data;
      if (obj) setMonthCompletion(obj);
      else setMonthCompletion(null);
    } catch {
      setMonthCompletion(null);
      message.error('加载当月化验完成率失败');
    } finally {
      setMonthCompletionLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDueSoonMeta();
    void loadMonthCompletionMeta();
  }, [loadDueSoonMeta, loadMonthCompletionMeta]);

  const openRecheckModal = useCallback(
    (r: LabResultListRow) => {
      const due = getDueDayjsForRow(r);
      setRecheckTarget({
        patient_id: r.patient_id,
        test_type: r.test_type,
        next_review_date: r.next_review_date ?? due.format('YYYY-MM-DD'),
      });
      setRecheckDate(due);
      setRecheckOpen(true);
    },
    [],
  );

  const saveRecheckModal = useCallback(async () => {
    if (!recheckTarget || !recheckDate) return;
    setRecheckSaving(true);
    try {
      await labsApi.setRecheckDue({
        patient_id: recheckTarget.patient_id,
        test_type: recheckTarget.test_type,
        due_date: recheckDate.format('YYYY-MM-DD'),
      });
      message.success('复查时间已更新');
      setRecheckOpen(false);
      setRecheckTarget(null);

      await loadLabRecords(recordScope);
    } catch {
      message.error('设置复查时间失败');
    } finally {
      setRecheckSaving(false);
    }
  }, [loadLabRecords, recordScope, recheckDate, recheckTarget]);

  useEffect(() => {
    if (!showModal) return;
    form.setFieldsValue({
      patient_id: undefined,
      test_date: dayjs(),
      items: [{ test_type: undefined, value: undefined, unit: undefined }],
    });
  }, [showModal, form]);

  const rowsFiltered = list.filter((r) => {
    const cat = getCategoryForTestType(r.test_type);
    if (category !== '全部类别' && cat !== category) return false;

    const kw = search.trim();
    if (kw && !r.patient_name.includes(kw)) return false;

    const ui = rowToUiStatus(r);
    if (statusFilter === 'critical') return ui === 'critical';
    if (statusFilter === 'abnormal') return ui === 'high' || ui === 'low';
    if (statusFilter === 'normal') return ui === 'normal';
    return true;
  });

  const criticalCount = rowsFiltered.filter((r) => rowToUiStatus(r) === 'critical').length;
  const abnormalCount = rowsFiltered.filter((r) => {
    const ui = rowToUiStatus(r);
    return ui === 'high' || ui === 'low';
  }).length;

  const firstCritical = rowsFiltered.find((r) => rowToUiStatus(r) === 'critical');

  const completionRateText = monthCompletion
    ? `${(monthCompletion.completion_rate * 100).toFixed(1)}%`
    : '—';
  const uncompletedCount = monthCompletion?.uncompleted_patients.length ?? 0;

  const handleCriticalNavigate = () => {
    navigate('/alerts?level=critical&status=active');
  };

  const handleDueSoonOpen = async () => {
    setDueSoonOpen(true);
    await loadDueSoonMeta();
  };

  const handleMonthCompletionOpen = async () => {
    setMonthCompletionOpen(true);
    await loadMonthCompletionMeta();
  };

  const columnsFull = useMemo(
    () =>
      makeLabColumns({
        showPatient: true,
        showCategory: true,
        canSetRecheck,
        onOpenRecheck: openRecheckModal,
        onAnomalyAnalyze: hasLabWrite ? openAnomaly : undefined,
      }),
    [canSetRecheck, openRecheckModal, hasLabWrite, openAnomaly],
  );
  const columnsGrouped = useMemo(
    () =>
      makeLabColumns({
        showPatient: false,
        showCategory: false,
        canSetRecheck,
        onOpenRecheck: openRecheckModal,
        onAnomalyAnalyze: hasLabWrite ? openAnomaly : undefined,
      }),
    [canSetRecheck, openRecheckModal, hasLabWrite, openAnomaly],
  );
  const groupedPatients = useMemo(() => groupByPatientAndCategory(rowsFiltered), [rowsFiltered]);

  const defaultExpandedPatientKeys = useMemo(() => {
    const crit = groupedPatients
      .filter((g) => g.categories.some((c) => c.rows.some((row) => rowToUiStatus(row) === 'critical')))
      .map((g) => g.patientId);
    if (crit.length) return crit;
    if (groupedPatients[0]) return [groupedPatients[0].patientId];
    return [];
  }, [groupedPatients]);

  const handleManualSave = async () => {
    await form.validateFields(['patient_id', 'test_date']);
    const pid = form.getFieldValue('patient_id') as string;
    const testDate = form.getFieldValue('test_date') as dayjs.Dayjs;
    const rawRows = (form.getFieldValue('items') ?? []) as {
      test_type?: string;
      value?: string | number;
      unit?: string;
    }[];

    const messages: string[] = [];
    const filled: { test_type: string; value: number; unit: string }[] = [];

    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i];
      const hasType = !!row?.test_type;
      const rawVal = row?.value;
      const hasVal =
        rawVal !== undefined &&
        rawVal !== null &&
        String(rawVal).trim() !== '';
      if (!hasType && !hasVal) continue;
      if (hasType && !hasVal) {
        messages.push(`第 ${i + 1} 行：已选择项目，请填写结果值`);
        continue;
      }
      if (!hasType && hasVal) {
        messages.push(`第 ${i + 1} 行：已填写结果，请选择检验项目`);
        continue;
      }
      const num = parseFloat(String(rawVal).trim());
      if (Number.isNaN(num)) {
        messages.push(`第 ${i + 1} 行：结果值不是有效数字`);
        continue;
      }
      filled.push({
        test_type: row.test_type as string,
        value: num,
        unit: typeof row.unit === 'string' ? row.unit.trim() : '',
      });
    }

    if (messages.length > 0) {
      message.error(messages[0]);
      return;
    }
    if (filled.length === 0) {
      message.warning('请至少录入一条有效的检验项目（项目 + 结果值）');
      return;
    }
    const types = filled.map((r) => r.test_type);
    if (new Set(types).size !== types.length) {
      message.error('同一检验项目不能重复，请删除或合并重复行');
      return;
    }

    const dateStr = testDate.format('YYYY-MM-DD');
    setSaving(true);
    try {
      await labsApi.add(
        pid,
        filled.map((item) => ({
          test_type: item.test_type,
          value: item.value,
          unit: item.unit,
          test_date: dateStr,
        }))
      );
      message.success(`已保存 ${filled.length} 条检验结果`);
      setShowModal(false);
      form.resetFields();
      await loadLabRecords(recordScope);
    } catch {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleAbnormalNavigate = () => {
    setSearch('');
    setCategory('全部类别');
    setStatusFilter('abnormal');
    setViewMode('table');
    setTimeout(() => recordsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };

  return (
    <PageShell
      fullWidth
      subtitle="近一周化验结果总览（按患者/类别分组）；异常指标支持医生设定下次复查时间。"
    >
      <div className="grid-4" style={{ marginBottom: 16 }}>
        <div
          className="hd-stat-card red"
          role="button"
          tabIndex={0}
          onClick={handleCriticalNavigate}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') handleCriticalNavigate();
          }}
          style={{ cursor: 'pointer' }}
          aria-label="查看危急值预警"
        >
          <div className="hd-stat-icon">⚡</div>
          <div className="hd-stat-label">危急值</div>
          <div className="hd-stat-value num" style={{ color: '#BE123C' }}>
            {criticalCount}
          </div>
          <div className="hd-stat-meta">需立即处理</div>
        </div>
        <div
          className="hd-stat-card amber"
          role="button"
          tabIndex={0}
          onClick={handleAbnormalNavigate}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') handleAbnormalNavigate();
          }}
          style={{ cursor: 'pointer' }}
          aria-label="查看异常指标"
        >
          <div className="hd-stat-icon">⚠️</div>
          <div className="hd-stat-label">异常指标</div>
          <div className="hd-stat-value num" style={{ color: '#D97706' }}>
            {abnormalCount}
          </div>
          <div className="hd-stat-meta">包含偏高/偏低</div>
        </div>
        <div
          className="hd-stat-card teal"
          role="button"
          tabIndex={0}
          onClick={() => void handleDueSoonOpen()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') void handleDueSoonOpen();
          }}
          style={{ cursor: 'pointer' }}
          aria-label="查看到期提醒名单"
        >
          <div className="hd-stat-icon">🧪</div>
          <div className="hd-stat-label">到期提醒（近7天）</div>
          <div className="hd-stat-value num">
            {dueSoonLoading ? '...' : dueSoonCount}
          </div>
          <div className="hd-stat-meta">到期/即将到期人员</div>
        </div>
        <div
          className="hd-stat-card blue"
          role="button"
          tabIndex={0}
          onClick={() => void handleMonthCompletionOpen()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') void handleMonthCompletionOpen();
          }}
          style={{ cursor: 'pointer' }}
          aria-label="查看未化验人员名单"
        >
          <div className="hd-stat-icon">📅</div>
          <div className="hd-stat-label">当月化验完成率</div>
          <div className="hd-stat-value num">{monthCompletionLoading ? '...' : completionRateText}</div>
          <div className="hd-stat-meta">未化验 {monthCompletionLoading ? '—' : uncompletedCount} 人</div>
        </div>
      </div>

      <Card
        title="录入方式"
        style={{ marginBottom: 16, border: '1px solid #DBEAFE' }}
        styles={{ body: { padding: 16 } }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 16,
          }}
        >
          <div
            style={{
              border: '1px solid #E0E7FF',
              borderRadius: 8,
              padding: '14px 16px',
              background: 'linear-gradient(180deg, #FAFBFF 0%, #fff 100%)',
            }}
          >
            <Text strong style={{ fontSize: 15 }}>手动录入</Text>
            <div className="text-muted" style={{ marginTop: 8, fontSize: 13, lineHeight: 1.55 }}>
              选择患者与检测日期后，可添加多行检验项目并一次保存；项目下拉按类别分组。
            </div>
            <div style={{ marginTop: 14 }}>
              {hasLabWrite ? (
                <Button type="primary" icon={<PlusOutlined />} block onClick={() => setShowModal(true)}>
                  打开手动录入
                </Button>
              ) : (
                <Text type="secondary">当前账号无检验录入权限</Text>
              )}
            </div>
          </div>
          <div
            style={{
              border: '1px solid #E0E7FF',
              borderRadius: 8,
              padding: '14px 16px',
              background: 'linear-gradient(180deg, #FAFBFF 0%, #fff 100%)',
            }}
          >
            <Text strong style={{ fontSize: 15 }}>拍照识别录入</Text>
            <div className="text-muted" style={{ marginTop: 8, fontSize: 13, lineHeight: 1.55 }}>
              上传化验单照片，识别后逐项核对再保存；适合同一张报告上多项指标一次处理。
            </div>
            <div style={{ marginTop: 14 }}>
              {hasLabWrite ? (
                <Button type="primary" icon={<ScanOutlined />} block onClick={() => setShowOcr(true)}>
                  打开拍照识别
                </Button>
              ) : (
                <Text type="secondary">当前账号无检验录入权限</Text>
              )}
            </div>
          </div>
        </div>
      </Card>

      <div className="flex gap-8 items-center" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        <Input
          prefix={<SearchOutlined style={{ color: '#7B92BC' }} />}
          placeholder="搜索患者姓名…"
          value={search}
          onChange={(e) => {
            const next = e.target.value;
            setSearch(next);
          }}
          style={{ width: 240, borderColor: '#DBEAFE' }}
          allowClear
        />
        <Select
          value={category}
          onChange={setCategory}
          style={{ width: 130 }}
          options={CATEGORIES.map((c) => ({ value: c, label: c }))}
        />
        <Select
          placeholder="全部状态"
          value={statusFilter || undefined}
          onChange={(v) => setStatusFilter(v || '')}
          style={{ width: 140 }}
          allowClear
          options={[
            { value: 'normal', label: '正常' },
            { value: 'abnormal', label: '异常' },
            { value: 'critical', label: '危急值' },
          ]}
        />
        <Select
          value={recordScope}
          onChange={(value) => setRecordScope(value)}
          style={{ width: 160 }}
          options={[
            { value: 'recent7', label: '近7天记录' },
            { value: 'all', label: '全部历史' },
          ]}
        />
        <div style={{ marginLeft: 'auto' }}>
          <Segmented
            value={viewMode}
            onChange={(v) => setViewMode(v as 'grouped' | 'table')}
            options={[
              {
                value: 'grouped',
                icon: <AppstoreOutlined />,
                label: '按患者分组',
              },
              {
                value: 'table',
                icon: <UnorderedListOutlined />,
                label: '明细表',
              },
            ]}
          />
        </div>
      </div>

      {criticalCount > 0 && firstCritical && (
        <div className="hd-alert-item danger" style={{ marginBottom: 16 }}>
          <span className="hd-alert-icon">⚡</span>
          <div className="hd-alert-content">
            <div className="hd-alert-title">存在 {criticalCount} 项危急值，需立即处理！</div>
            <div className="hd-alert-desc">
              {firstCritical.patient_name} {LAB_TYPE_LABELS[firstCritical.test_type]} = {firstCritical.value}{' '}
              {firstCritical.unit}
            </div>
          </div>
          <Button danger size="small">
            立即处理
          </Button>
        </div>
      )}

      <div ref={recordsRef}>
        <Card
          title={recordScope === 'all' ? '检验记录（全部历史）' : '检验记录（近7天）'}
          style={{ border: '1px solid #DBEAFE' }}
          styles={{ body: { padding: viewMode === 'grouped' ? 16 : 0 } }}
        >
          <Spin spinning={loading}>
          {viewMode === 'grouped' ? (
            <>
              {groupedPatients.length === 0 ? (
                <PageEmpty description={recordScope === 'all' ? '暂无符合条件的历史检验记录' : '暂无符合条件的近7天检验记录'} />
              ) : (
                <Collapse
                  bordered
                  expandIconPosition="end"
                  defaultActiveKey={defaultExpandedPatientKeys}
                  items={groupedPatients.map((pg) => {
                    const totalItems = pg.categories.reduce((n, c) => n + c.rows.length, 0);
                    const hasCritical = pg.categories.some((c) => c.rows.some((row) => rowToUiStatus(row) === 'critical'));
                    const innerKeys = pg.categories.map((c) => `${pg.patientId}__${c.name}`);
                    return {
                      key: pg.patientId,
                      label: (
                        <div
                          className="flex items-center gap-12"
                          style={{ flexWrap: 'wrap', justifyContent: 'space-between', width: '100%', paddingRight: 8 }}
                        >
                          <Space size={10}>
                            <div
                              className={`hd-avatar ${pg.patientGender === 'F' ? 'hd-avatar-f' : 'hd-avatar-m'}`}
                              style={{ width: 32, height: 32, fontSize: 13 }}
                            >
                              {pg.patientName.charAt(0)}
                            </div>
                            <Text strong style={{ fontSize: 15 }}>{pg.patientName}</Text>
                          </Space>
                          <Space size={8}>
                            {hasCritical ? <Tag color="error">含危急值</Tag> : null}
                            <Tag color="processing">{totalItems} 项</Tag>
                          </Space>
                        </div>
                      ),
                      children: (
                        <Collapse
                          ghost
                          size="small"
                          defaultActiveKey={innerKeys}
                          items={pg.categories.map((cat) => ({
                            key: `${pg.patientId}__${cat.name}`,
                            label: (
                              <Space>
                                <Text strong style={{ color: '#4338CA' }}>{cat.name}</Text>
                                <Tag style={{ marginInlineEnd: 0 }}>{cat.rows.length} 项</Tag>
                              </Space>
                            ),
                            children: (
                              <div className="hd-table-responsive">
                                <Table<LabResultListRow>
                                  dataSource={cat.rows}
                                  rowKey={(r) => r.id}
                                  columns={columnsGrouped}
                                  size="small"
                                  pagination={false}
                                  rowClassName={(r) => {
                                    const ui = rowToUiStatus(r);
                                    return ui === 'critical' ? 'row-hcv' : ui === 'high' ? 'row-hbv' : '';
                                  }}
                                />
                              </div>
                            ),
                          }))}
                        />
                      ),
                    };
                  })}
                />
              )}
            </>
          ) : (
            <div className="hd-table-responsive">
              <Table<LabResultListRow>
                dataSource={rowsFiltered}
                rowKey={(r) => r.id}
                columns={columnsFull}
                size="small"
                locale={{ emptyText: <PageEmpty description={recordScope === 'all' ? '暂无符合条件的历史检验记录' : '暂无符合条件的近7天检验记录'} /> }}
                pagination={false}
                rowClassName={(r) => {
                  const ui = rowToUiStatus(r);
                  return ui === 'critical' ? 'row-hcv' : ui === 'high' ? 'row-hbv' : '';
                }}
              />
            </div>
          )}
          </Spin>
        </Card>
      </div>

      <Modal
        title="设置下次复查时间"
        open={recheckOpen}
        onCancel={() => {
          setRecheckOpen(false);
          setRecheckTarget(null);
        }}
        onOk={() => void saveRecheckModal()}
        okText="保存"
        confirmLoading={recheckSaving}
        destroyOnClose
        width={560}
      >
        {recheckTarget ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div
              style={{
                border: '1px solid #DBEAFE',
                background: '#F8FAFF',
                padding: 12,
                borderRadius: 8,
              }}
            >
              <div style={{ fontWeight: 700, color: '#0D1B3E', marginBottom: 6 }}>
                {LAB_TYPE_LABELS[recheckTarget.test_type] ?? recheckTarget.test_type}
              </div>
              <div className="text-muted" style={{ fontSize: 13.5, lineHeight: 1.7 }}>
                当前参考范围：{formatReferenceRange(recheckTarget.test_type)}
              </div>
              <div className="text-muted" style={{ fontSize: 13.5, lineHeight: 1.7 }}>
                当前计划：{recheckTarget.next_review_date ?? '—'}
              </div>
            </div>

            <div>
              <div style={{ fontWeight: 600, color: '#0D1B3E', marginBottom: 8 }}>下次复查日期</div>
              <DatePicker
                style={{ width: '100%' }}
                value={recheckDate}
                onChange={(v) => setRecheckDate(v)}
              />
              <div className="text-muted" style={{ marginTop: 8, fontSize: 12.5, lineHeight: 1.6 }}>
                设定后将覆盖系统默认复查周期，并在列表的“下次复查”列中回显。
              </div>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        title="到期提醒（近7天）"
        open={dueSoonOpen}
        onCancel={() => setDueSoonOpen(false)}
        footer={null}
        width={820}
        destroyOnClose
      >
        <Spin spinning={dueSoonLoading}>
          <Table<LabReviewDueSoonRow>
            dataSource={dueSoonRows}
            rowKey={(r) => `${r.patient_id}__${r.test_type}__${r.due_date}`}
            size="small"
            pagination={false}
            columns={[
              {
                title: '患者',
                dataIndex: 'patient_name',
                key: 'patient_name',
                width: 180,
              },
              {
                title: '项目',
                dataIndex: 'test_type',
                key: 'test_type',
                width: 140,
                render: (v: string) => LAB_TYPE_LABELS[v] ?? v,
              },
              {
                title: '上次检测',
                dataIndex: 'test_date',
                key: 'test_date',
                width: 120,
                render: (v: string) => (v ? String(v).slice(0, 10) : '—'),
              },
              {
                title: '到期日期',
                dataIndex: 'due_date',
                key: 'due_date',
                width: 120,
                render: (v: string) => (v ? String(v).slice(0, 10) : '—'),
              },
            ]}
            locale={{ emptyText: <PageEmpty description="暂无到期提醒" /> }}
          />
        </Spin>
      </Modal>

      <Modal
        title="当月化验完成率"
        open={monthCompletionOpen}
        onCancel={() => setMonthCompletionOpen(false)}
        footer={null}
        width={760}
        destroyOnClose
      >
        <div style={{ marginBottom: 12 }}>
          <div className="text-muted" style={{ fontSize: 13.5, marginBottom: 4 }}>
            完成率：<b>{completionRateText}</b>
          </div>
          <div className="text-muted" style={{ fontSize: 13.5 }}>
            未化验人员：<b>{monthCompletion?.uncompleted_patients.length ?? 0}</b> 人
          </div>
        </div>
        <Spin spinning={monthCompletionLoading}>
          <Table<{ patient_id: string; patient_name: string }>
            dataSource={monthCompletion?.uncompleted_patients ?? []}
            rowKey={(r) => r.patient_id}
            size="small"
            pagination={false}
            columns={[
              {
                title: '患者',
                dataIndex: 'patient_name',
                key: 'patient_name',
              },
            ]}
            locale={{ emptyText: <PageEmpty description="当月已全部完成" /> }}
          />
        </Spin>
      </Modal>

      <Modal
        title="录入检验结果（可多条）"
        open={showModal}
        onOk={() => void handleManualSave()}
        onCancel={() => {
          setShowModal(false);
          form.resetFields();
        }}
        okText="保存全部"
        cancelText="取消"
        width={760}
        confirmLoading={saving}
        destroyOnClose
      >
        <Form form={form} layout="vertical" size="middle" style={{ marginTop: 8 }}>
          <div className="grid-2" style={{ gap: 16 }}>
            <Form.Item label="患者" name="patient_id" rules={[{ required: true, message: '请选择患者' }]}>
              <Select
                placeholder="选择患者"
                showSearch
                optionFilterProp="label"
                options={patientOptions.map((p) => ({
                  value: p.id,
                  label: `${p.name}（${p.gender === 'F' ? '女' : '男'}）`,
                }))}
              />
            </Form.Item>
            <Form.Item label="检测日期" name="test_date" rules={[{ required: true, message: '请选择日期' }]}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </div>

          <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
            下方每一行一项指标；空行在保存时会被忽略。同一项目请勿重复添加多行。
          </Text>

          <Form.List name="items" initialValue={[{}]}>
            {(fields, { add, remove }) => (
              <div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(160px, 1fr) 120px 120px 40px',
                    gap: 8,
                    alignItems: 'center',
                    marginBottom: 6,
                    padding: '0 4px',
                  }}
                >
                  <span className="text-muted" style={{ fontSize: 12 }}>
                    检验项目
                  </span>
                  <span className="text-muted" style={{ fontSize: 12 }}>
                    结果值
                  </span>
                  <span className="text-muted" style={{ fontSize: 12 }}>
                    单位（可选）
                  </span>
                  <span />
                </div>
                {fields.map((field) => (
                  <div
                    key={field.key}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(160px, 1fr) 120px 120px 40px',
                      gap: 8,
                      alignItems: 'flex-start',
                      marginBottom: 8,
                    }}
                  >
                    <Form.Item name={[field.name, 'test_type']} style={{ marginBottom: 0 }}>
                      <Select
                        placeholder="按类别选项目"
                        options={LAB_TYPE_GROUPED_OPTIONS}
                        showSearch
                        optionFilterProp="label"
                        allowClear
                      />
                    </Form.Item>
                    <Form.Item name={[field.name, 'value']} style={{ marginBottom: 0 }}>
                      <Input placeholder="如 5.8" inputMode="decimal" />
                    </Form.Item>
                    <Form.Item name={[field.name, 'unit']} style={{ marginBottom: 0 }}>
                      <Input placeholder="默认单位" />
                    </Form.Item>
                    <Button
                      type="text"
                      danger
                      icon={<MinusCircleOutlined />}
                      aria-label="删除本行"
                      disabled={fields.length <= 1}
                      onClick={() => remove(field.name)}
                      style={{ marginTop: 4 }}
                    />
                  </div>
                ))}
                <Button
                  type="dashed"
                  onClick={() => add({ test_type: undefined, value: undefined, unit: undefined })}
                  block
                  icon={<PlusOutlined />}
                  style={{ marginTop: 4 }}
                >
                  添加一行
                </Button>
              </div>
            )}
          </Form.List>
        </Form>
      </Modal>

      {anomalyCtx ? (
        <AnomalyAnalysisModal
          open={anomalyOpen}
          onClose={() => setAnomalyOpen(false)}
          patientId={anomalyCtx.patientId}
          anomalyType={anomalyCtx.anomalyType}
          contextId={anomalyCtx.contextId}
          patientLabel={anomalyCtx.patientName}
        />
      ) : null}

      <LabOcrModal
        open={showOcr}
        onClose={() => setShowOcr(false)}
        onSaved={async () => {
          setShowOcr(false);
          message.success('化验单识别结果已保存');
          await loadLabRecords(recordScope);
        }}
      />
    </PageShell>
  );
}
