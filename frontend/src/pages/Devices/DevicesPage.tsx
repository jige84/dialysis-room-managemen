/**
 * 透析机与耗材管理页
 * 对接 /api/devices：机器台账、维护、预警、耗材批次与出入库。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Card,
  Table,
  Button,
  Select,
  Input,
  Modal,
  Form,
  InputNumber,
  Tabs,
  message,
  Drawer,
  Tag,
  DatePicker,
  Space,
  Spin,
  Empty,
} from 'antd';
import { SearchOutlined, PlusOutlined, ToolOutlined, EyeOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import PageShell from '../../components/PageShell/PageShell';
import { useAuthStore } from '../../stores/authStore';
import {
  devicesApi,
  type MachineRow,
  type ConsumableStockRow,
  type OutboundLineRow,
  type MachineMaintenanceRow,
  type AlertRow,
  type WaterMachineRow,
  type WaterMaintenanceRow,
  type WaterQualityRecord,
  type WaterDailyInspectionRow,
} from '../../api/devices';
import { patientsApi, type Patient } from '../../api/patients';

const MACHINE_STATUS_UI: Record<string, { label: string; color: string; bg: string }> = {
  running: { label: '运行中', color: '#059669', bg: '#ECFDF5' },
  idle: { label: '空闲', color: '#7B92BC', bg: '#F1F5F9' },
  maintenance: { label: '维护中', color: '#D97706', bg: '#FFFBEB' },
  fault: { label: '故障', color: '#BE123C', bg: '#FFF1F2' },
  retired: { label: '停用', color: '#64748B', bg: '#F1F5F9' },
};

const ZONE_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  normal: { label: '普通区', color: '#0369A1', bg: '#E0F2FE' },
  hbv: { label: '乙肝区', color: '#92400E', bg: '#FFFBEB' },
  hcv: { label: '丙肝区', color: '#9F1239', bg: '#FFF1F2' },
};

// 前端展示中文分类，后台使用英文编码（受数据库 CHECK 约束）：
// backendCategory: dialyzer / blood_tubing / needle / catheter / other
const CONSUMABLE_CATEGORY_OPTIONS: { value: string; label: string; backendCategory: string }[] = [
  { value: 'dialyzer_main', label: '透析器', backendCategory: 'dialyzer' },
  { value: 'dialyzer_perf', label: '灌流器', backendCategory: 'dialyzer' },
  { value: 'dialyzer_filter', label: '血滤器', backendCategory: 'dialyzer' },
  { value: 'needle_blunt', label: '穿刺针（钝）', backendCategory: 'needle' },
  { value: 'needle_sharp', label: '穿刺针（锐）', backendCategory: 'needle' },
  { value: 'blood_tubing', label: '管路', backendCategory: 'blood_tubing' },
  { value: 'infusion_line', label: '补液管', backendCategory: 'other' },
  { value: 'perf_connector', label: '灌流连接管', backendCategory: 'catheter' },
  { value: 'other_custom', label: '其他', backendCategory: 'other' },
];

function resolveMachineUiStatus(m: MachineRow): keyof typeof MACHINE_STATUS_UI {
  if (m.status === 'maintenance') return 'maintenance';
  if (m.status === 'fault') return 'fault';
  if (m.status === 'retired') return 'retired';
  const today = Number(m.today_sessions ?? 0);
  if (today > 0) return 'running';
  return 'idle';
}

function stockLevel(cs: ConsumableStockRow): 'sufficient' | 'warning' | 'low' {
  if (cs.current_stock <= cs.alert_threshold) return 'low';
  if (cs.current_stock <= cs.alert_threshold * 1.2) return 'warning';
  return 'sufficient';
}

const STOCK_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  sufficient: { label: '充足', color: '#059669', bg: '#ECFDF5' },
  warning: { label: '偏低', color: '#D97706', bg: '#FFFBEB' },
  low: { label: '不足', color: '#BE123C', bg: '#FFF1F2' },
};

type DailyWaterMetricMode = 'normal' | 'abnormal' | 'manual';

const DAILY_WATER_METRIC_MODE_OPTIONS: { value: DailyWaterMetricMode; label: string }[] = [
  { value: 'normal', label: '正常' },
  { value: 'abnormal', label: '异常' },
  { value: 'manual', label: '手动输入数值' },
];

function buildDailyWaterMetricValue(
  mode: DailyWaterMetricMode | undefined,
  abnormalNote?: string,
  manualValue?: string,
): string | undefined {
  if (!mode) return undefined;
  if (mode === 'normal') return '正常';
  if (mode === 'abnormal') {
    const note = abnormalNote?.trim();
    return note ? `异常（${note}）` : undefined;
  }
  const value = manualValue?.trim();
  return value || undefined;
}

export default function DevicesPage() {
  const { hasRole } = useAuthStore();
  const canWriteDevice = hasRole(['admin', 'head_nurse']);
  const canInbound = hasRole(['admin', 'head_nurse', 'nurse']);
  const canDeleteDeviceAsset = hasRole(['admin', 'head_nurse', 'technician']);

  const [loading, setLoading] = useState(true);
  const [machines, setMachines] = useState<MachineRow[]>([]);
  const [consumables, setConsumables] = useState<ConsumableStockRow[]>([]);
  const [todaySummary, setTodaySummary] = useState<{ scheduled_patients: number; outbound_lines_today: number } | null>(
    null
  );

  const [search, setSearch] = useState('');
  const [zoneFilter, setZoneFilter] = useState('');

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMachine, setDrawerMachine] = useState<MachineRow | null>(null);
  const [drawerMaint, setDrawerMaint] = useState<MachineMaintenanceRow[]>([]);
  const [drawerAlerts, setDrawerAlerts] = useState<AlertRow[]>([]);
  const [drawerLoading, setDrawerLoading] = useState(false);

  const [showMachineModal, setShowMachineModal] = useState(false);
  const [showMaintModal, setShowMaintModal] = useState(false);
  const [showAlertModal, setShowAlertModal] = useState(false);
  const [maintTargetId, setMaintTargetId] = useState<string | null>(null);
  const [maintTargetKind, setMaintTargetKind] = useState<'machine' | 'water' | null>(null);
  const [showInboundModal, setShowInboundModal] = useState(false);
  const [machineForm] = Form.useForm();
  const [maintForm] = Form.useForm();
  const [alertForm] = Form.useForm();
  const [inboundForm] = Form.useForm();
  const [stockForm] = Form.useForm();
  const [dailyWaterForm] = Form.useForm();

  const [outboundLines, setOutboundLines] = useState<OutboundLineRow[]>([]);
  const [outboundLoading, setOutboundLoading] = useState(false);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [usagePatientId, setUsagePatientId] = useState<string | undefined>();
  const [usageRows, setUsageRows] = useState<OutboundLineRow[]>([]);
  const [showStockModal, setShowStockModal] = useState(false);
  const [inboundStockId, setInboundStockId] = useState<string | undefined>();
  const [stockCategoryLabel, setStockCategoryLabel] = useState<string | undefined>();
  const [activeMainTab, setActiveMainTab] = useState<'machines' | 'consumables' | 'water'>('machines');
  const [todayUsage, setTodayUsage] = useState<OutboundLineRow[]>([]);
  const [todayUsageLoading, setTodayUsageLoading] = useState(false);
  const [showWaterMachineModal, setShowWaterMachineModal] = useState(false);
  const [showWaterQualityModal, setShowWaterQualityModal] = useState(false);
  const [waterMachineForm] = Form.useForm();
  const [waterQualityForm] = Form.useForm();
  const [waterMachines, setWaterMachines] = useState<WaterMachineRow[]>([]);
  const [waterMachinesLoading, setWaterMachinesLoading] = useState(false);
  const [waterMaintRows, setWaterMaintRows] = useState<WaterMaintenanceRow[]>([]);
  const [waterDrawerOpen, setWaterDrawerOpen] = useState(false);
  const [waterDrawerMachine, setWaterDrawerMachine] = useState<WaterMachineRow | null>(null);
  const [waterDrawerLoading, setWaterDrawerLoading] = useState(false);
  const [waterQualityRows, setWaterQualityRows] = useState<WaterQualityRecord[]>([]);
  const [waterQualityLoading, setWaterQualityLoading] = useState(false);
  const [dailyInspectionRows, setDailyInspectionRows] = useState<WaterDailyInspectionRow[]>([]);
  const [dailyInspectionLoading, setDailyInspectionLoading] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [mRes, cRes, tRes] = await Promise.all([
        devicesApi.machines(),
        devicesApi.consumables(),
        devicesApi.todaySummary(),
      ]);
      setMachines(mRes.data.data ?? []);
      setConsumables(cRes.data.data ?? []);
      setTodaySummary(tRes.data.data ?? null);
    } catch {
      message.error('加载设备耗材数据失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTodayUsage = useCallback(async () => {
    setTodayUsageLoading(true);
    try {
      const todayStr = dayjs().format('YYYY-MM-DD');
      const res = await devicesApi.outboundLines({ start_date: todayStr, end_date: todayStr, page: 1 });
      setTodayUsage(res.data.data ?? []);
    } catch {
      message.error('加载当日耗材使用情况失败');
    } finally {
      setTodayUsageLoading(false);
    }
  }, []);

  const loadWaterMachines = useCallback(async () => {
    setWaterMachinesLoading(true);
    try {
      const res = await devicesApi.waterMachines();
      setWaterMachines(res.data.data ?? []);
    } catch {
      message.error('加载水机台账失败');
    } finally {
      setWaterMachinesLoading(false);
    }
  }, []);

  const loadWaterQuality = useCallback(
    async (params?: { start_date?: string; end_date?: string }) => {
      setWaterQualityLoading(true);
      try {
        const res = await devicesApi.waterQualityList(params);
        setWaterQualityRows(res.data.data ?? []);
      } catch {
        message.error('加载水质检测记录失败');
      } finally {
        setWaterQualityLoading(false);
      }
    },
    [],
  );

  const loadWaterDailyInspections = useCallback(async () => {
    setDailyInspectionLoading(true);
    try {
      const res = await devicesApi.waterDailyInspections({ page: 1, page_size: 100 });
      setDailyInspectionRows(res.data.data ?? []);
    } catch {
      message.error('加载水处理日常检测记录失败');
    } finally {
      setDailyInspectionLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const loadOutbound = useCallback(async () => {
    setOutboundLoading(true);
    try {
      const res = await devicesApi.outboundLines({ page: 1 });
      setOutboundLines(res.data.data ?? []);
    } catch {
      message.error('加载出库明细失败');
    } finally {
      setOutboundLoading(false);
    }
  }, []);

  const openDrawer = async (m: MachineRow) => {
    setDrawerMachine(m);
    setDrawerOpen(true);
    setDrawerLoading(true);
    try {
      const [mt, al] = await Promise.all([
        devicesApi.machineMaintenance(m.id),
        devicesApi.machineAlerts(m.id),
      ]);
      setDrawerMaint(mt.data.data ?? []);
      setDrawerAlerts(al.data.data ?? []);
    } catch {
      message.error('加载详情失败');
    } finally {
      setDrawerLoading(false);
    }
  };

  const handleDeleteMachine = (m: MachineRow) => {
    Modal.confirm({
      title: '确认删除透析机？',
      content: `删除后不可恢复：${m.machine_no}`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await devicesApi.deleteMachine(m.id);
          if (drawerMachine?.id === m.id) {
            setDrawerOpen(false);
            setDrawerMachine(null);
            setDrawerMaint([]);
            setDrawerAlerts([]);
          }
          message.success(`透析机 ${m.machine_no} 已删除`);
          await loadAll();
        } catch {
          /* request 已提示 */
        }
      },
    });
  };

  const handleDeleteConsumable = (r: ConsumableStockRow) => {
    Modal.confirm({
      title: '确认删除耗材目录？',
      content: `删除后不可恢复：${r.item_name}${r.specification ? `（${r.specification}）` : ''}`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await devicesApi.deleteConsumableStock(r.id);
          if (inboundStockId === r.id) {
            setShowInboundModal(false);
            inboundForm.resetFields();
            setInboundStockId(undefined);
          }
          message.success(`耗材目录 ${r.item_name} 已删除`);
          await loadAll();
        } catch {
          /* request 已提示 */
        }
      },
    });
  };

  const handleDeleteWaterMachine = (r: WaterMachineRow) => {
    Modal.confirm({
      title: '确认删除水机？',
      content: `删除后不可恢复：${r.machine_no}`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await devicesApi.deleteWaterMachine(r.id);
          if (waterDrawerMachine?.id === r.id) {
            setWaterDrawerOpen(false);
            setWaterDrawerMachine(null);
            setWaterMaintRows([]);
          }
          message.success(`水机 ${r.machine_no} 已删除`);
          await loadWaterMachines();
        } catch {
          /* request 已提示 */
        }
      },
    });
  };

  const filteredMachines = useMemo(() => {
    return machines.filter((m) => {
      if (search) {
        const q = search.trim();
        const hit =
          m.machine_no.includes(q) ||
          (m.model && m.model.includes(q)) ||
          (m.brand && m.brand.includes(q));
        if (!hit) return false;
      }
      if (zoneFilter && m.zone !== zoneFilter) return false;
      return true;
    });
  }, [machines, search, zoneFilter]);

  const maintenanceDueCount = machines.filter((m) => {
    if (!m.next_maintenance_due) return false;
    return dayjs(m.next_maintenance_due).diff(dayjs(), 'day') <= 30;
  }).length;

  const lowStockItems = consumables.filter((c) => stockLevel(c) !== 'sufficient');

  const machineColumns = [
    { title: '机器编号', dataIndex: 'machine_no', render: (v: string) => <span style={{ fontWeight: 600 }}>{v}</span> },
    {
      title: '品牌/型号',
      render: (_: unknown, r: MachineRow) => (
        <span>
          {r.brand || '—'} {r.model || ''}
        </span>
      ),
    },
    {
      title: '分区',
      render: (_: unknown, r: MachineRow) => {
        const z = ZONE_STYLE[r.zone] || ZONE_STYLE.normal;
        return (
          <span style={{ background: z.bg, color: z.color, padding: '2px 8px', borderRadius: 20, fontSize: 12 }}>
            {z.label}
          </span>
        );
      },
    },
    {
      title: '运行状态',
      render: (_: unknown, r: MachineRow) => {
        const key = resolveMachineUiStatus(r);
        const s = MACHINE_STATUS_UI[key];
        return (
          <span style={{ background: s.bg, color: s.color, padding: '3px 9px', borderRadius: 20, fontSize: 12, fontWeight: 500 }}>
            {s.label}
          </span>
        );
      },
    },
    {
      title: '累计次数 / 时长(天/年)',
      render: (_: unknown, r: MachineRow) => {
        const totalSessions = Number(r.total_sessions ?? 0);
        if (!r.purchase_date) {
          return (
            <span className="num text-sm">
              {totalSessions.toLocaleString()} / —
            </span>
          );
        }
        const daysSinceInstall = dayjs().diff(dayjs(r.purchase_date), 'day');
        const yearsSinceInstall = daysSinceInstall / 365;
        return (
          <span className="num text-sm">
            {totalSessions.toLocaleString()} / {daysSinceInstall} 天
            {yearsSinceInstall >= 0.1 ? `（约 ${yearsSinceInstall.toFixed(1)} 年）` : ''}
          </span>
        );
      },
    },
    {
      title: '今日场次',
      dataIndex: 'today_sessions',
      render: (v: unknown) => <span className="num">{Number(v ?? 0)}</span>,
    },
    {
      title: '细菌过滤器',
      render: (_: unknown, r: MachineRow) => {
        if (!r.bacterial_filter_installed_at) return <span className="text-muted">—</span>;
        const max = r.bacterial_filter_max_days ?? 90;
        const days = dayjs().diff(dayjs(r.bacterial_filter_installed_at), 'day');
        const left = max - days;
        const warn = left <= 14;
        return (
          <span className="num text-sm" style={{ color: warn ? '#D97706' : undefined }}>
            已用 {days} 天 / 周期 {max} 天
          </span>
        );
      },
    },
    {
      title: '透析液化验',
      dataIndex: 'last_dialysate_lab_at',
      render: (v: string | null | undefined) =>
        v ? <span className="num text-sm">{v}</span> : <span className="text-muted">—</span>,
    },
    {
      title: '维护',
      render: (_: unknown, r: MachineRow) => (
        <div className="num text-xs">
          <div>上次：{r.last_maintenance_date || '—'}</div>
          <div style={{ color: r.next_maintenance_due && dayjs(r.next_maintenance_due).diff(dayjs(), 'day') <= 30 ? '#D97706' : '#059669' }}>
            下次：{r.next_maintenance_due || '—'}
          </div>
        </div>
      ),
    },
    {
      title: '预警',
      dataIndex: 'active_alert_count',
      render: (v: number | undefined) => (
        <Tag color={v && v > 0 ? 'red' : 'green'}>{v ?? 0} 条未处理</Tag>
      ),
    },
    {
      title: '操作',
      render: (_: unknown, r: MachineRow) => (
        <Space>
          <Button size="small" icon={<EyeOutlined />} onClick={() => openDrawer(r)}>
            详情
          </Button>
          {canWriteDevice && (
            <Button
              size="small"
              icon={<ToolOutlined />}
              onClick={() => {
                setMaintTargetId(r.id);
                setMaintTargetKind('machine');
                maintForm.resetFields();
                setShowMaintModal(true);
              }}
            >
              维护
            </Button>
          )}
          {canDeleteDeviceAsset && (
            <Button size="small" danger onClick={() => handleDeleteMachine(r)}>
              删除
            </Button>
          )}
        </Space>
      ),
    },
  ];

  const overviewColumns = [
    {
      title: '耗材名称',
      dataIndex: 'item_name',
      render: (v: string) => <span style={{ fontWeight: 500 }}>{v}</span>,
    },
    { title: '规格', dataIndex: 'specification', render: (v: string | null) => v || '—' },
    { title: '单位', dataIndex: 'unit' },
    {
      title: '通量',
      render: (_: unknown, r: ConsumableStockRow) =>
        r.category === 'dialyzer' && r.dialyzer_flux ? (
          <Tag>{r.dialyzer_flux === 'high' ? '高通量' : '低通量'}</Tag>
        ) : (
          '—'
        ),
    },
    {
      title: '库存',
      render: (_: unknown, r: ConsumableStockRow) => {
        const lv = stockLevel(r);
        return (
          <span
            className="num"
            style={{
              fontWeight: 700,
              color: lv === 'low' ? '#BE123C' : lv === 'warning' ? '#D97706' : '#059669',
            }}
          >
            {r.current_stock}
          </span>
        );
      },
    },
    { title: '预警线', dataIndex: 'alert_threshold', render: (v: number) => <span className="num text-muted">{v}</span> },
    {
      title: '厂家',
      dataIndex: 'manufacturer',
      render: (v: string | null) => v || '—',
    },
    {
      title: '状态',
      render: (_: unknown, r: ConsumableStockRow) => {
        const lv = stockLevel(r);
        const s = STOCK_STATUS[lv];
        return (
          <span style={{ background: s.bg, color: s.color, padding: '3px 9px', borderRadius: 20, fontSize: 12, fontWeight: 500 }}>
            {s.label}
          </span>
        );
      },
    },
    {
      title: '操作',
      render: (_: unknown, r: ConsumableStockRow) =>
        canInbound || canDeleteDeviceAsset ? (
          <Space size="small">
            {canInbound && (
              <Button
                size="small"
                type="primary"
                onClick={() => {
                  inboundForm.resetFields();
                  setInboundStockId(r.id);
                  inboundForm.setFieldsValue({ stock_item_id: r.id });
                  setShowInboundModal(true);
                }}
              >
                入库
              </Button>
            )}
            {canDeleteDeviceAsset && (
              <Button size="small" danger onClick={() => handleDeleteConsumable(r)}>
                删除
              </Button>
            )}
          </Space>
        ) : null,
    },
  ];

  const outboundCols = [
    { title: '日期', dataIndex: 'outbound_date', width: 110 },
    { title: '耗材', dataIndex: 'item_name' },
    { title: '规格', dataIndex: 'specification', render: (v: string | null) => v || '—' },
    { title: '数量', dataIndex: 'quantity' },
    { title: '患者', dataIndex: 'patient_name' },
    { title: '操作人', dataIndex: 'operated_by_name', render: (v: string | null) => v || '—' },
  ];

  useEffect(() => {
    if (usagePatientId) {
      devicesApi
        .patientUsage(usagePatientId)
        .then((res) => setUsageRows(res.data.data ?? []))
        .catch(() => message.error('加载使用记录失败'));
    } else {
      setUsageRows([]);
    }
  }, [usagePatientId]);

  useEffect(() => {
    patientsApi
      .list({ page: 1, page_size: 200, status: 'active' })
      .then((res) => setPatients(res.data.data?.list ?? []))
      .catch(() => {});
  }, []);

  return (
    <PageShell fullWidth>
      <Spin spinning={loading}>
        {activeMainTab === 'machines' ? (
          <div className="grid-4" style={{ marginBottom: 20 }}>
            <div className="hd-stat-card teal">
              <div className="hd-stat-icon">⚙️</div>
              <div className="hd-stat-label">透析机总数</div>
              <div className="hd-stat-value num">{machines.length}</div>
              <div className="hd-stat-meta">分区台账</div>
            </div>
            <div className="hd-stat-card blue">
              <div className="hd-stat-icon">✅</div>
              <div className="hd-stat-label">正常运行（当日有场次）</div>
              <div className="hd-stat-value num">
                {machines.filter((m) => resolveMachineUiStatus(m) === 'running').length}
              </div>
              <div className="hd-stat-meta">今日可用</div>
            </div>
            <div className="hd-stat-card amber">
              <div className="hd-stat-icon">🔧</div>
              <div className="hd-stat-label">30天内到期维护</div>
              <div className="hd-stat-value num" style={{ color: maintenanceDueCount > 0 ? '#D97706' : '#059669' }}>
                {maintenanceDueCount}
              </div>
              <div className="hd-stat-meta">需安排维护</div>
            </div>
            <div className="hd-stat-card red">
              <div className="hd-stat-icon">📦</div>
              <div className="hd-stat-label">耗材库存预警</div>
              <div className="hd-stat-value num" style={{ color: lowStockItems.length > 0 ? '#BE123C' : '#059669' }}>
                {lowStockItems.length}
              </div>
              <div className="hd-stat-meta">
                今日排班 {todaySummary?.scheduled_patients ?? '—'} 人 · 出库记录{' '}
                {todaySummary?.outbound_lines_today ?? '—'} 条
              </div>
            </div>
          </div>
        ) : activeMainTab === 'consumables' ? (
          <div className="grid-4" style={{ marginBottom: 20 }}>
            <div className="hd-stat-card teal">
              <div className="hd-stat-icon">📦</div>
              <div className="hd-stat-label">耗材目录总数</div>
              <div className="hd-stat-value num">{consumables.length}</div>
              <div className="hd-stat-meta">按品种统计</div>
            </div>
            <div className="hd-stat-card red">
              <div className="hd-stat-icon">⚠️</div>
              <div className="hd-stat-label">库存预警</div>
              <div className="hd-stat-value num" style={{ color: lowStockItems.length > 0 ? '#BE123C' : '#059669' }}>
                {lowStockItems.length}
              </div>
              <div className="hd-stat-meta">低于预警线的耗材种类</div>
            </div>
            <div className="hd-stat-card amber">
              <div className="hd-stat-icon">⏱</div>
              <div className="hd-stat-label">今日出库记录</div>
              <div className="hd-stat-value num">{todaySummary?.outbound_lines_today ?? 0}</div>
              <div className="hd-stat-meta">含透析自动出库</div>
            </div>
            <div className="hd-stat-card blue">
              <div className="hd-stat-icon">👥</div>
              <div className="hd-stat-label">今日使用患者数</div>
              <div className="hd-stat-value num">
                {todayUsage.length > 0 ? new Set(todayUsage.map((u) => u.patient_name)).size : 0}
              </div>
              <div className="hd-stat-meta">基于当日出库记录</div>
            </div>
          </div>
        ) : (
          <div className="grid-4" style={{ marginBottom: 20 }}>
            <div className="hd-stat-card teal">
              <div className="hd-stat-icon">💧</div>
              <div className="hd-stat-label">水机总数</div>
              <div className="hd-stat-value num">{waterMachines.length}</div>
              <div className="hd-stat-meta">RO 机与透析液配制装置</div>
            </div>
            <div className="hd-stat-card blue">
              <div className="hd-stat-icon">✅</div>
              <div className="hd-stat-label">运行中水机</div>
              <div className="hd-stat-value num">
                {waterMachines.filter((m) => m.status === 'active').length}
              </div>
              <div className="hd-stat-meta">状态为运行/在用</div>
            </div>
            <div className="hd-stat-card amber">
              <div className="hd-stat-icon">🧼</div>
              <div className="hd-stat-label">7天内需消毒/维护</div>
              <div className="hd-stat-value num">
                {
                  waterMachines.filter((m) => {
                    if (!m.next_disinfection_due) return false;
                    const days = dayjs(m.next_disinfection_due).diff(dayjs(), 'day');
                    return days >= 0 && days <= 7;
                  }).length
                }
              </div>
              <div className="hd-stat-meta">按下次消毒到期计算</div>
            </div>
            <div className="hd-stat-card red">
              <div className="hd-stat-icon">🧪</div>
              <div className="hd-stat-label">最近水质异常次数</div>
              <div className="hd-stat-value num">
                {waterQualityRows.filter((r) => r.result && r.result !== 'qualified').length}
              </div>
              <div className="hd-stat-meta">基于当前筛选范围</div>
            </div>
          </div>
        )}

        <Tabs
          defaultActiveKey="machines"
          activeKey={activeMainTab}
          onChange={(k) => {
            const key = (k as 'machines' | 'consumables' | 'water');
            setActiveMainTab(key);
            if (key === 'consumables') {
              loadTodayUsage();
            } else if (key === 'water') {
              loadWaterMachines();
              loadWaterQuality();
              loadWaterDailyInspections();
            }
          }}
          items={[
            {
              key: 'machines',
              label: '透析机管理',
              children: (
                <div>
                  <div className="flex gap-8 items-center" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
                    <Input
                      prefix={<SearchOutlined style={{ color: '#7B92BC' }} />}
                      placeholder="搜索机器编号/品牌/型号…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      style={{ width: 220, borderColor: '#DBEAFE' }}
                      allowClear
                    />
                    <Select
                      placeholder="全部分区"
                      value={zoneFilter || undefined}
                      onChange={(v) => setZoneFilter(v || '')}
                      style={{ width: 130 }}
                      allowClear
                      options={[
                        { value: 'normal', label: '普通区' },
                        { value: 'hbv', label: '乙肝区' },
                        { value: 'hcv', label: '丙肝区' },
                      ]}
                    />
                    {canWriteDevice && (
                      <div style={{ marginLeft: 'auto' }}>
                        <Button
                          type="primary"
                          icon={<PlusOutlined />}
                          onClick={() => {
                            machineForm.resetFields();
                            setShowMachineModal(true);
                          }}
                        >
                          登记新机器
                        </Button>
                      </div>
                    )}
                  </div>
                  <Card style={{ border: '1px solid #DBEAFE' }} styles={{ body: { padding: 0 } }}>
                    <Table
                      dataSource={filteredMachines}
                      rowKey="id"
                      columns={machineColumns}
                      size="small"
                      pagination={{ pageSize: 10, showTotal: (t) => `共 ${t} 台` }}
                      locale={{ emptyText: <Empty description="暂无透析机数据" /> }}
                    />
                  </Card>
                </div>
              ),
            },
            {
              key: 'consumables',
              label: '耗材管理',
              children: (
                <div>
                  <Card style={{ marginBottom: 16, border: '1px solid #DBEAFE' }}>
                    <div style={{ marginBottom: 8, fontWeight: 500 }}>当日患者耗材使用一览</div>
                    <Table
                      dataSource={todayUsage}
                      rowKey="id"
                      columns={outboundCols}
                      size="small"
                      loading={todayUsageLoading}
                      pagination={{ pageSize: 10 }}
                      locale={{
                        emptyText: <Empty description="当日暂无耗材出库记录" />,
                      }}
                    />
                  </Card>
                  {lowStockItems.length > 0 && (
                    <div className="hd-alert-item danger" style={{ marginBottom: 16 }}>
                      <span className="hd-alert-icon">📦</span>
                      <div className="hd-alert-content">
                        <div className="hd-alert-title">{lowStockItems.length} 项耗材库存不足或偏低，需及时补货</div>
                        <div className="hd-alert-desc">{lowStockItems.map((i) => i.item_name).join('、')}</div>
                      </div>
                    </div>
                  )}
                  <Tabs
                    items={[
                      {
                        key: 'overview',
                        label: '库存总览',
                        children: (
                          <Card style={{ border: '1px solid #DBEAFE' }} styles={{ body: { padding: 0 } }}>
                            {canInbound && (
                              <div style={{ padding: 12, display: 'flex', justifyContent: 'flex-end' }}>
                                <Button
                                  type="primary"
                                  icon={<PlusOutlined />}
                                  size="small"
                                  onClick={() => {
                                    stockForm.resetFields();
                                    setStockCategoryLabel(undefined);
                                    setShowStockModal(true);
                                  }}
                                >
                                  新建耗材目录
                                </Button>
                              </div>
                            )}
                            <Table
                              dataSource={consumables}
                              rowKey="id"
                              columns={overviewColumns}
                              size="small"
                              pagination={false}
                              locale={{ emptyText: <Empty description="暂无耗材" /> }}
                            />
                          </Card>
                        ),
                      },
                      {
                        key: 'outbound',
                        label: '出库明细',
                        children: (
                          <Card style={{ border: '1px solid #DBEAFE' }} styles={{ body: { padding: 0 } }}>
                            <div style={{ padding: 12 }}>
                              <Button size="small" onClick={loadOutbound} loading={outboundLoading}>
                                刷新
                              </Button>
                            </div>
                            <Table
                              dataSource={outboundLines}
                              rowKey="id"
                              columns={outboundCols}
                              size="small"
                              loading={outboundLoading}
                              pagination={{ pageSize: 15 }}
                              locale={{ emptyText: <Empty description="暂无出库记录，透析保存后将自动出库" /> }}
                            />
                          </Card>
                        ),
                      },
                      {
                        key: 'usage',
                        label: '患者使用记录',
                        children: (
                          <Card>
                            <Space style={{ marginBottom: 16 }}>
                              <span>选择患者：</span>
                              <Select
                                showSearch
                                optionFilterProp="label"
                                placeholder="搜索患者"
                                style={{ width: 280 }}
                                allowClear
                                options={patients.map((p) => ({ value: p.id, label: p.name }))}
                                value={usagePatientId}
                                onChange={setUsagePatientId}
                              />
                            </Space>
                            <Table
                              dataSource={usageRows}
                              rowKey="id"
                              columns={outboundCols}
                              size="small"
                              pagination={{ pageSize: 10 }}
                              locale={{ emptyText: usagePatientId ? '暂无记录' : '请先选择患者' }}
                            />
                          </Card>
                        ),
                      },
                    ]}
                  />
                </div>
              ),
            },
            {
              key: 'water',
              label: '水机管理',
              children: (
                <div>
                  <Card
                    style={{ border: '1px solid #DBEAFE', marginBottom: 16 }}
                    loading={waterMachinesLoading}
                    extra={
                      canWriteDevice && (
                        <Button
                          type="primary"
                          icon={<PlusOutlined />}
                          size="small"
                          onClick={() => {
                            waterMachineForm.resetFields();
                            setShowWaterMachineModal(true);
                          }}
                        >
                          登记新水机
                        </Button>
                      )
                    }
                  >
                    <Table
                      dataSource={waterMachines}
                      rowKey="id"
                      size="small"
                      columns={[
                        {
                          title: '水机编号',
                          dataIndex: 'machine_no',
                          render: (v: string) => <span style={{ fontWeight: 600 }}>{v}</span>,
                        },
                        { title: '型号', dataIndex: 'model', render: (v: string | null) => v || '—' },
                        { title: '品牌', dataIndex: 'brand', render: (v: string | null) => v || '—' },
                        { title: '位置', dataIndex: 'location', render: (v: string | null) => v || '—' },
                        {
                          title: '状态',
                          dataIndex: 'status',
                          render: (v: string) => {
                            const map: Record<string, { label: string; color: string }> = {
                              active: { label: '运行', color: 'green' },
                              maintenance: { label: '维护', color: 'orange' },
                              fault: { label: '故障', color: 'red' },
                              retired: { label: '停用', color: 'default' },
                            };
                            const cfg = map[v] || map.active;
                            return <Tag color={cfg.color}>{cfg.label}</Tag>;
                          },
                        },
                        {
                          title: '最近消毒/到期',
                          render: (_: unknown, r: WaterMachineRow) => (
                            <div className="num text-xs">
                              <div>上次：{r.last_disinfection_at || '—'}</div>
                              <div>下次：{r.next_disinfection_due || '—'}</div>
                            </div>
                          ),
                        },
                        {
                          title: '最近水质结果',
                          render: (_: unknown, r: WaterMachineRow) => (
                            <span
                              className="num text-xs"
                              style={{ color: r.last_water_test_result && r.last_water_test_result !== 'qualified' ? '#BE123C' : '#059669' }}
                            >
                              {r.last_water_test_date
                                ? `${r.last_water_test_date} · ${r.last_water_test_result || '—'}`
                                : '—'}
                            </span>
                          ),
                        },
                        {
                          title: '操作',
                          render: (_: unknown, r: WaterMachineRow) => (
                            <Space size="small">
                              <Button
                                size="small"
                                onClick={async () => {
                                  setWaterDrawerMachine(r);
                                  setWaterDrawerOpen(true);
                                  setWaterDrawerLoading(true);
                                  try {
                                    const maintRes = await devicesApi.waterMachineMaintenance(r.id);
                                    setWaterMaintRows(maintRes.data.data ?? []);
                                  } catch {
                                    message.error('加载水机维护记录失败');
                                  } finally {
                                    setWaterDrawerLoading(false);
                                  }
                                }}
                              >
                                详情/维护
                              </Button>
                              {canDeleteDeviceAsset && (
                                <Button size="small" danger onClick={() => handleDeleteWaterMachine(r)}>
                                  删除
                                </Button>
                              )}
                            </Space>
                          ),
                        },
                      ]}
                      pagination={{ pageSize: 8, showTotal: (t) => `共 ${t} 台水机` }}
                      locale={{ emptyText: <Empty description="暂无水机台账" /> }}
                    />
                  </Card>

                  <Card
                    title="水处理系统日常检测记录"
                    style={{ border: '1px solid #DBEAFE', marginBottom: 16 }}
                  >
                    <Form
                      form={dailyWaterForm}
                      layout="vertical"
                      size="middle"
                      onFinish={async (v) => {
                        const hardness = buildDailyWaterMetricValue(
                          v.hardness_mode as DailyWaterMetricMode | undefined,
                          v.hardness_abnormal_note,
                          v.hardness_manual_value,
                        );
                        const totalChlorine = buildDailyWaterMetricValue(
                          v.total_chlorine_mode as DailyWaterMetricMode | undefined,
                          v.total_chlorine_abnormal_note,
                          v.total_chlorine_manual_value,
                        );
                        try {
                          await devicesApi.createWaterDailyInspection({
                            water_machine_id: v.water_machine_id,
                            check_date: v.check_date
                              ? dayjs(v.check_date).format('YYYY-MM-DD')
                              : dayjs().format('YYYY-MM-DD'),
                            hardness,
                            total_chlorine: totalChlorine,
                            tap_pressure: v.tap_pressure,
                            sand_delta_p: v.sand_delta_p,
                            resin_delta_p: v.resin_delta_p,
                            carbon_delta_p: v.carbon_delta_p,
                            ro_in_pressure: v.ro_in_pressure,
                            ro_out_pressure: v.ro_out_pressure,
                            feed_conductivity: v.feed_conductivity,
                            product_conductivity: v.product_conductivity,
                            product_flow: v.product_flow,
                            drain_flow: v.drain_flow,
                            feed_temp: v.feed_temp,
                            operator_name: v.operator,
                            notes: v.notes,
                          });
                          message.success('日常检测已保存');
                          dailyWaterForm.resetFields();
                          dailyWaterForm.setFieldsValue({
                            check_date: dayjs(),
                            hardness_mode: 'normal',
                            total_chlorine_mode: 'normal',
                          });
                          await loadWaterDailyInspections();
                        } catch {
                          /* request 已提示 */
                        }
                      }}
                    >
                      <div className="grid-4" style={{ gap: 16 }}>
                        <Form.Item label="关联水机（可选）" name="water_machine_id">
                          <Select
                            allowClear
                            placeholder="选择水机"
                            options={waterMachines.map((m) => ({ value: m.id, label: m.machine_no }))}
                          />
                        </Form.Item>
                        <Form.Item label="检测日期" name="check_date" initialValue={dayjs()}>
                          <DatePicker style={{ width: '100%' }} />
                        </Form.Item>
                        <Form.Item label="硬度 (mg/L)" required>
                          <div style={{ display: 'grid', gap: 8 }}>
                            <Form.Item
                              name="hardness_mode"
                              initialValue="normal"
                              style={{ marginBottom: 0 }}
                            >
                              <Select
                                options={DAILY_WATER_METRIC_MODE_OPTIONS}
                                onChange={() =>
                                  dailyWaterForm.setFieldsValue({
                                    hardness_abnormal_note: undefined,
                                    hardness_manual_value: undefined,
                                  })
                                }
                              />
                            </Form.Item>
                            <Form.Item noStyle shouldUpdate={(prev, curr) => prev.hardness_mode !== curr.hardness_mode}>
                              {({ getFieldValue }) => {
                                const mode = getFieldValue('hardness_mode') as DailyWaterMetricMode | undefined;
                                if (mode === 'abnormal') {
                                  return (
                                    <Form.Item
                                      name="hardness_abnormal_note"
                                      rules={[{ required: true, message: '请选择异常时请填写说明' }]}
                                      style={{ marginBottom: 0 }}
                                    >
                                      <Input placeholder="填写硬度异常说明" />
                                    </Form.Item>
                                  );
                                }
                                if (mode === 'manual') {
                                  return (
                                    <Form.Item
                                      name="hardness_manual_value"
                                      rules={[
                                        { required: true, message: '请填写硬度数值' },
                                        {
                                          validator: (_rule, value?: string) =>
                                            value && value.trim() !== '' && !Number.isNaN(Number(value))
                                              ? Promise.resolve()
                                              : Promise.reject(new Error('请输入有效数字')),
                                        },
                                      ]}
                                      style={{ marginBottom: 0 }}
                                    >
                                      <Input placeholder="请输入数值，如 1.2" />
                                    </Form.Item>
                                  );
                                }
                                return null;
                              }}
                            </Form.Item>
                          </div>
                        </Form.Item>
                        <Form.Item label="总氯 (mg/L)" required>
                          <div style={{ display: 'grid', gap: 8 }}>
                            <Form.Item
                              name="total_chlorine_mode"
                              initialValue="normal"
                              style={{ marginBottom: 0 }}
                            >
                              <Select
                                options={DAILY_WATER_METRIC_MODE_OPTIONS}
                                onChange={() =>
                                  dailyWaterForm.setFieldsValue({
                                    total_chlorine_abnormal_note: undefined,
                                    total_chlorine_manual_value: undefined,
                                  })
                                }
                              />
                            </Form.Item>
                            <Form.Item
                              noStyle
                              shouldUpdate={(prev, curr) => prev.total_chlorine_mode !== curr.total_chlorine_mode}
                            >
                              {({ getFieldValue }) => {
                                const mode = getFieldValue('total_chlorine_mode') as DailyWaterMetricMode | undefined;
                                if (mode === 'abnormal') {
                                  return (
                                    <Form.Item
                                      name="total_chlorine_abnormal_note"
                                      rules={[{ required: true, message: '请选择异常时请填写说明' }]}
                                      style={{ marginBottom: 0 }}
                                    >
                                      <Input placeholder="填写总氯异常说明" />
                                    </Form.Item>
                                  );
                                }
                                if (mode === 'manual') {
                                  return (
                                    <Form.Item
                                      name="total_chlorine_manual_value"
                                      rules={[
                                        { required: true, message: '请填写总氯数值' },
                                        {
                                          validator: (_rule, value?: string) =>
                                            value && value.trim() !== '' && !Number.isNaN(Number(value))
                                              ? Promise.resolve()
                                              : Promise.reject(new Error('请输入有效数字')),
                                        },
                                      ]}
                                      style={{ marginBottom: 0 }}
                                    >
                                      <Input placeholder="请输入数值，如 0.1" />
                                    </Form.Item>
                                  );
                                }
                                return null;
                              }}
                            </Form.Item>
                          </div>
                        </Form.Item>
                        <Form.Item label="自来水压力 (MPa)" name="tap_pressure">
                          <Input />
                        </Form.Item>
                      </div>
                      <div className="grid-3" style={{ gap: 16 }}>
                        <Form.Item label="砂滤罐压差 (MPa)" name="sand_delta_p">
                          <Input />
                        </Form.Item>
                        <Form.Item label="树脂罐压差 (MPa)" name="resin_delta_p">
                          <Input />
                        </Form.Item>
                        <Form.Item label="活性炭罐压差 (MPa)" name="carbon_delta_p">
                          <Input />
                        </Form.Item>
                      </div>
                      <div className="grid-4" style={{ gap: 16 }}>
                        <Form.Item label="高压泵进水压 (MPa)" name="ro_in_pressure">
                          <Input />
                        </Form.Item>
                        <Form.Item label="高压泵出水压 (MPa)" name="ro_out_pressure">
                          <Input />
                        </Form.Item>
                        <Form.Item label="进水电导率 (μS/cm)" name="feed_conductivity">
                          <Input />
                        </Form.Item>
                        <Form.Item label="产水电导率 (μS/cm)" name="product_conductivity">
                          <Input />
                        </Form.Item>
                      </div>
                      <div className="grid-3" style={{ gap: 16 }}>
                        <Form.Item label="产水量 (L/h)" name="product_flow">
                          <Input />
                        </Form.Item>
                        <Form.Item label="排水量 (L/h)" name="drain_flow">
                          <Input />
                        </Form.Item>
                        <Form.Item label="进水温度 (℃)" name="feed_temp">
                          <Input />
                        </Form.Item>
                      </div>
                      <div className="grid-2" style={{ gap: 16 }}>
                        <Form.Item label="记录人" name="operator">
                          <Input />
                        </Form.Item>
                        <Form.Item label="备注" name="notes">
                          <Input />
                        </Form.Item>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <Button type="primary" htmlType="submit" disabled={!canInbound}>
                          保存当日记录
                        </Button>
                      </div>
                    </Form>

                    <Table
                      style={{ marginTop: 16 }}
                      dataSource={dailyInspectionRows}
                      rowKey="id"
                      size="small"
                      loading={dailyInspectionLoading}
                      pagination={{ pageSize: 10 }}
                      locale={{ emptyText: <Empty description="暂无日常检测记录" /> }}
                      columns={[
                        {
                          title: '水机',
                          dataIndex: 'water_machine_no',
                          width: 100,
                          render: (v: string | null | undefined) => v || '—',
                        },
                        { title: '日期', dataIndex: 'check_date' },
                        { title: '硬度', dataIndex: 'hardness' },
                        { title: '总氯', dataIndex: 'total_chlorine' },
                        { title: '自来水压', dataIndex: 'tap_pressure' },
                        { title: '砂滤压差', dataIndex: 'sand_delta_p' },
                        { title: '树脂压差', dataIndex: 'resin_delta_p' },
                        { title: '活性炭压差', dataIndex: 'carbon_delta_p' },
                        { title: '进水电导', dataIndex: 'feed_conductivity' },
                        { title: '产水电导', dataIndex: 'product_conductivity' },
                        { title: '产水量', dataIndex: 'product_flow' },
                        { title: '排水量', dataIndex: 'drain_flow' },
                        { title: '进水温度', dataIndex: 'feed_temp' },
                        {
                          title: '记录人',
                          dataIndex: 'operator_name',
                          render: (v: string | null | undefined) => v || '—',
                        },
                      ]}
                    />
                  </Card>

                  <Card
                    title="水质检测记录"
                    style={{ border: '1px solid #DBEAFE', marginBottom: 16 }}
                    extra={
                      canInbound && (
                        <Button
                          type="primary"
                          size="small"
                          onClick={() => {
                            waterQualityForm.resetFields();
                            waterQualityForm.setFieldsValue({
                              test_date: dayjs(),
                              metric_kind: 'bacteria',
                              result: 'qualified',
                            });
                            setShowWaterQualityModal(true);
                          }}
                        >
                          登记水质检测
                        </Button>
                      )
                    }
                  >
                    <Table
                      dataSource={waterQualityRows}
                      rowKey="id"
                      size="small"
                      loading={waterQualityLoading}
                      pagination={{ pageSize: 10 }}
                      columns={[
                        { title: '检测日期', dataIndex: 'test_date' },
                        {
                          title: '关联水机',
                          dataIndex: 'water_machine_no',
                          width: 110,
                          render: (v: string | null | undefined) => v || '—',
                        },
                        { title: '类型', dataIndex: 'test_type', render: (v: string | null) => v || '—' },
                        { title: '采样点', dataIndex: 'sample_point', render: (v: string | null) => v || '—' },
                        {
                          title: '细菌 (cfu/mL)',
                          dataIndex: 'bacteria_count',
                          render: (v: number | null | undefined) => (v != null ? v : '—'),
                        },
                        {
                          title: '内毒素 (EU/mL)',
                          dataIndex: 'endotoxin_value',
                          render: (v: number | null | undefined) => (v != null ? v : '—'),
                        },
                        {
                          title: '结果',
                          dataIndex: 'result',
                          render: (v: string | null | undefined) => {
                            if (v == null || v === '') return '—';
                            return v !== 'qualified' ? <Tag color="red">不合格</Tag> : <Tag color="green">合格</Tag>;
                          },
                        },
                        {
                          title: '检测人',
                          dataIndex: 'tested_by_name',
                          render: (v: string | null | undefined) => v || '—',
                        },
                      ]}
                      locale={{ emptyText: <Empty description="暂无水质检测记录" /> }}
                    />
                  </Card>
                </div>
              ),
            },
          ]}
        />
      </Spin>

      <Drawer
        title={drawerMachine ? `透析机 ${drawerMachine.machine_no}` : '详情'}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={480}
      >
        {drawerMachine && (
          <Spin spinning={drawerLoading}>
            <p>
              <strong>序列号：</strong>
              {drawerMachine.serial_no || '—'}
            </p>
            <p>
              <strong>装机日期：</strong>
              {drawerMachine.purchase_date || '—'}
            </p>
            <p>
              <strong>备注：</strong>
              {drawerMachine.notes || '—'}
            </p>
            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h4 style={{ margin: 0 }}>异常预警</h4>
              {canWriteDevice && (
                <Button
                  size="small"
                  type="primary"
                  onClick={() => {
                    alertForm.resetFields();
                    alertForm.setFieldsValue({
                      title: `${drawerMachine.machine_no} 异常报警`,
                    });
                    setShowAlertModal(true);
                  }}
                >
                  登记异常报警
                </Button>
              )}
            </div>
            {drawerAlerts.length === 0 ? (
              <Empty description="暂无关联预警" />
            ) : (
              <ul style={{ paddingLeft: 18 }}>
                {drawerAlerts.map((a) => (
                  <li key={a.id} style={{ marginBottom: 8 }}>
                    <Tag color={a.severity === 'emergency' || a.severity === 'critical' ? 'red' : a.severity === 'warning' ? 'orange' : 'blue'}>
                      {{
                        emergency: 'emergency',
                        critical: 'critical',
                        warning: 'warning',
                        info: 'info',
                      }[a.severity || 'warning']}
                    </Tag>{' '}
                    {a.title} — {dayjs(a.created_at).format('YYYY-MM-DD HH:mm')}
                  </li>
                ))}
              </ul>
            )}
            <h4 style={{ marginTop: 16 }}>维护记录</h4>
            {drawerMaint.length === 0 ? (
              <Empty description="暂无维护记录" />
            ) : (
              <ul style={{ paddingLeft: 18 }}>
                {drawerMaint.map((m) => (
                  <li key={m.id} style={{ marginBottom: 8 }}>
                    <div className="num text-sm">
                      {m.maintenance_date} · {m.maintenance_type}
                    </div>
                    <div>{m.content}</div>
                  </li>
                ))}
              </ul>
            )}
          </Spin>
        )}
      </Drawer>

      <Modal
        title="登记设备异常报警"
        open={showAlertModal}
        onOk={() => {
          if (!drawerMachine) {
            setShowAlertModal(false);
            return;
          }
          alertForm.validateFields().then(async (v) => {
            try {
              await devicesApi.createMachineAlert(drawerMachine.id, {
                alert_type: v.alert_type,
                severity: v.severity,
                title: v.title,
                message: v.message,
              });
              message.success('异常报警已登记');
              setShowAlertModal(false);
              alertForm.resetFields();
              try {
                const res = await devicesApi.machineAlerts(drawerMachine.id);
                setDrawerAlerts(res.data.data ?? []);
              } catch {
                /* ignore */
              }
            } catch {
              /* request 已提示 */
            }
          });
        }}
        onCancel={() => {
          setShowAlertModal(false);
          alertForm.resetFields();
        }}
        okText="保存"
        width={520}
      >
        <Form form={alertForm} layout="vertical" size="middle">
          <Form.Item label="报警类型" name="alert_type">
            <Select
              allowClear
              options={[
                { value: 'machine_alarm', label: '设备报警' },
                { value: 'water_alarm', label: '水处理报警' },
                { value: 'disinfection_alarm', label: '消毒相关报警' },
              ]}
            />
          </Form.Item>
          <Form.Item label="严重程度" name="severity" initialValue="warning">
            <Select
              options={[
                { value: 'info', label: '一般' },
                { value: 'warning', label: '警告' },
                { value: 'critical', label: '严重' },
                { value: 'emergency', label: '危急' },
              ]}
            />
          </Form.Item>
          <Form.Item label="标题" name="title" rules={[{ required: true, message: '请输入标题' }]}>
            <Input />
          </Form.Item>
          <Form.Item label="报警内容" name="message" rules={[{ required: true, message: '请输入报警内容' }]}>
            <Input.TextArea rows={3} placeholder="如：本次运行中出现E1报警，已按规程处理" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="登记水质检测"
        open={showWaterQualityModal}
        onOk={() => {
          waterQualityForm.validateFields().then(async (v) => {
            try {
              const testDate = v.test_date
                ? dayjs(v.test_date).format('YYYY-MM-DD')
                : dayjs().format('YYYY-MM-DD');
              await devicesApi.createWaterQuality({
                test_date: testDate,
                water_machine_id: v.water_machine_id,
                sample_point: '产水点',
                result: v.result,
                ...(v.metric_kind === 'bacteria'
                  ? { bacteria_count: v.metric_value }
                  : { endotoxin_value: v.metric_value }),
              });
              message.success('水质检测已登记');
              setShowWaterQualityModal(false);
              waterQualityForm.resetFields();
              await Promise.all([loadWaterMachines(), loadWaterQuality()]);
            } catch {
              /* request 已提示 */
            }
          });
        }}
        onCancel={() => {
          setShowWaterQualityModal(false);
          waterQualityForm.resetFields();
        }}
        okText="保存"
        width={480}
      >
        <Form form={waterQualityForm} layout="vertical" size="middle">
          <Form.Item label="关联水机" name="water_machine_id" rules={[{ required: true, message: '请选择水机' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="选择水机"
              options={waterMachines.map((m) => ({ value: m.id, label: m.machine_no }))}
            />
          </Form.Item>
          <Form.Item label="检测日期" name="test_date" rules={[{ required: true, message: '请选择日期' }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="检测项目" name="metric_kind" initialValue="bacteria">
            <Select
              options={[
                { value: 'bacteria', label: '细菌（cfu/mL）' },
                { value: 'endotoxin', label: '内毒素（EU/mL）' },
              ]}
            />
          </Form.Item>
          <Form.Item
            label="检测值"
            name="metric_value"
            rules={[
              { required: true, message: '请输入检测值' },
              {
                type: 'number',
                min: 0,
                message: '检测值须为非负数',
              },
            ]}
          >
            <InputNumber min={0} step={0.001} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="判定" name="result" rules={[{ required: true }]} initialValue="qualified">
            <Select
              options={[
                { value: 'qualified', label: '合格' },
                { value: 'unqualified', label: '不合格' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="登记新水机"
        open={showWaterMachineModal}
        onOk={() => {
          waterMachineForm.validateFields().then(async (v) => {
            try {
              await devicesApi.createWaterMachine({
                machine_no: v.machine_no,
                model: v.model,
                brand: v.brand,
                location: v.location,
                status: v.status,
                last_disinfection_at: v.last_disinfection_at
                  ? dayjs(v.last_disinfection_at).format('YYYY-MM-DD')
                  : undefined,
                next_disinfection_due: v.next_disinfection_due
                  ? dayjs(v.next_disinfection_due).format('YYYY-MM-DD')
                  : undefined,
                notes: v.notes,
              });
              message.success('水机已登记');
              setShowWaterMachineModal(false);
              waterMachineForm.resetFields();
              loadWaterMachines();
            } catch {
              /* request 已提示 */
            }
          });
        }}
        onCancel={() => {
          setShowWaterMachineModal(false);
          waterMachineForm.resetFields();
        }}
        okText="保存"
        width={520}
      >
        <Form form={waterMachineForm} layout="vertical" size="middle">
          <Form.Item label="水机编号" name="machine_no" rules={[{ required: true, message: '必填' }]}>
            <Input placeholder="如 RO-01、WM-02" />
          </Form.Item>
          <div className="grid-2" style={{ gap: 16 }}>
            <Form.Item label="品牌" name="brand">
              <Input />
            </Form.Item>
            <Form.Item label="型号" name="model">
              <Input />
            </Form.Item>
          </div>
          <Form.Item label="安装位置" name="location">
            <Input placeholder="如：透析室水处理间" />
          </Form.Item>
          <Form.Item label="运行状态" name="status" initialValue="active">
            <Select
              options={[
                { value: 'active', label: '运行中' },
                { value: 'maintenance', label: '维护中' },
                { value: 'fault', label: '故障' },
                { value: 'retired', label: '停用' },
              ]}
            />
          </Form.Item>
          <div className="grid-2" style={{ gap: 16 }}>
            <Form.Item label="上次消毒日期" name="last_disinfection_at">
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="下次消毒到期" name="next_disinfection_due">
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <Form.Item label="备注" name="notes">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={waterDrawerMachine ? `水机 ${waterDrawerMachine.machine_no}` : '水机详情'}
        open={waterDrawerOpen}        width={480}
        onClose={() => {
          setWaterDrawerOpen(false);
          setWaterDrawerMachine(null);
          setWaterMaintRows([]);
        }}
      >
        {waterDrawerMachine && (
          <Spin spinning={waterDrawerLoading}>
            <p>
              <strong>型号：</strong>
              {waterDrawerMachine.model || '—'}
            </p>
            <p>
              <strong>品牌：</strong>
              {waterDrawerMachine.brand || '—'}
            </p>
            <p>
              <strong>位置：</strong>
              {waterDrawerMachine.location || '—'}
            </p>
            <p>
              <strong>备注：</strong>
              {waterDrawerMachine.notes || '—'}
            </p>
            <h4 style={{ marginTop: 16 }}>维护 / 消毒记录</h4>
            {canInbound && (
              <Button
                size="small"
                type="primary"
                style={{ marginBottom: 12 }}
                onClick={() => {
                  maintForm.resetFields();
                  maintForm.setFieldsValue({
                    maintenance_type: 'routine',
                    maintenance_date: dayjs(),
                  });
                  setMaintTargetKind('water');
                  setShowMaintModal(true);
                  setMaintTargetId(waterDrawerMachine.id);
                }}
              >
                新增维护/消毒记录
              </Button>
            )}
            {waterMaintRows.length === 0 ? (
              <Empty description="暂无维护记录" />
            ) : (
              <ul style={{ paddingLeft: 18 }}>
                {waterMaintRows.map((m) => (
                  <li key={m.id} style={{ marginBottom: 8 }}>
                    <div className="num text-sm">
                      {m.maintenance_date} · {m.maintenance_type}
                    </div>
                    <div>{m.content}</div>
                  </li>
                ))}
              </ul>
            )}
          </Spin>
        )}
      </Drawer>

      <Modal
        title="新建耗材目录"
        open={showStockModal}
        onOk={() => {
          stockForm.validateFields().then(async (v) => {
            const categoryOpt = CONSUMABLE_CATEGORY_OPTIONS.find((o) => o.value === v.category_ui);
            const backendCategory = categoryOpt?.backendCategory ?? 'other';
            const dialyzerFlux = v.dialyzer_flux as 'high' | 'low' | undefined;
            let itemName: string = v.item_name;
            if (!itemName && (stockCategoryLabel === '穿刺针（钝）' || stockCategoryLabel === '穿刺针（锐）') && v.gauge) {
              itemName = v.gauge;
            }
            try {
              await devicesApi.createConsumableStock({
                item_name: itemName,
                category: backendCategory,
                specification: itemName,
                unit: v.unit,
                dialyzer_flux: dialyzerFlux,
                manufacturer: v.manufacturer,
                storage_location: v.storage_location,
                alert_threshold: v.alert_threshold,
              });
              message.success('耗材目录已创建');
              setShowStockModal(false);
              stockForm.resetFields();
              loadAll();
            } catch {
              /* request 已提示 */
            }
          });
        }}
        onCancel={() => {
          setShowStockModal(false);
          stockForm.resetFields();
        }}
        okText="保存"
        width={520}
      >
        <Form form={stockForm} layout="vertical" size="middle">
          <Form.Item
            label="耗材目录"
            name="category_ui"
            rules={[{ required: true, message: '请选择耗材目录' }]}
            extra="必填，固定为透析器、血滤器、穿刺针等大类，用于后续筛选统计。"
          >
            <Select
              placeholder="选择耗材目录"
              options={CONSUMABLE_CATEGORY_OPTIONS}
              onChange={(_, option) => {
                const opt = option as { value: string; label: string };
                setStockCategoryLabel(opt.label);
              }}
            />
          </Form.Item>
          {stockCategoryLabel !== '穿刺针（钝）' && stockCategoryLabel !== '穿刺针（锐）' && (
            <Form.Item
              label="型号"
              name="item_name"
              rules={[{ required: true, message: '请输入型号' }]}
              extra="必填，建议与外包装型号保持一致，如 FX80、HF16 等。"
            >
              <Input placeholder="如：FX80 / HF16 等" />
            </Form.Item>
          )}
          {(stockCategoryLabel === '透析器' || stockCategoryLabel === '血滤器') && (
            <>
              <Form.Item
                label="膜面积 (㎡)"
                name="membrane_area"
                rules={[{ required: true, message: '请输入膜面积' }]}
              >
                <Input placeholder="如：1.8" />
              </Form.Item>
              <Form.Item
                label="通量"
                name="dialyzer_flux"
                rules={[{ required: true, message: '请选择通量' }]}
              >
                <Select
                  placeholder="选择通量"
                  options={[
                    { value: 'high', label: '高通量' },
                    { value: 'low', label: '低通量' },
                  ]}
                />
              </Form.Item>
            </>
          )}
          {stockCategoryLabel === '灌流器' && (
            <Form.Item
              label="灌装量 (mL)"
              name="fill_volume"
              rules={[{ required: true, message: '请输入灌装量' }]}
            >
              <Input placeholder="如：500" />
            </Form.Item>
          )}
          {(stockCategoryLabel === '穿刺针（钝）' || stockCategoryLabel === '穿刺针（锐）') && (
            <Form.Item
              label="针规"
              name="gauge"
              rules={[{ required: true, message: '请选择针规' }]}
            >
              <Select
                placeholder="选择针规"
                options={[
                  { value: '16G', label: '16G' },
                  { value: '17G', label: '17G' },
                ]}
              />
            </Form.Item>
          )}
          <div className="grid-2" style={{ gap: 16 }}>
            <Form.Item
              label="单位"
              name="unit"
              rules={[{ required: true, message: '请选择单位' }]}
              extra="必填，通常为 个 / 支 / 套 / 袋 / 瓶 / 盒。"
            >
              <Select
                placeholder="选择单位"
                options={[
                  { value: '个', label: '个' },
                  { value: '支', label: '支' },
                  { value: '套', label: '套' },
                  { value: '袋', label: '袋' },
                  { value: '瓶', label: '瓶' },
                  { value: '盒', label: '盒' },
                ]}
              />
            </Form.Item>
            <Form.Item label="预警库存" name="alert_threshold" initialValue={10}>
              <InputNumber min={0} style={{ width: '100%' }} placeholder="达到该数量时触发库存预警" />
            </Form.Item>
          </div>
          <Form.Item
            label="厂家"
            name="manufacturer"
            extra="选填，生产企业名称，便于追溯。"
          >
            <Input placeholder="如：费森尤斯 / 贝朗 等" />
          </Form.Item>
          <Form.Item
            label="存放位置"
            name="storage_location"
            extra="选填，耗材在库房中的默认位置，便于查找。"
          >
            <Input placeholder="如：耗材柜 A 层" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="登记新透析机"
        open={showMachineModal}
        onOk={() => {
          machineForm.validateFields().then(async (v) => {
            try {
              await devicesApi.createMachine({
                machine_no: v.machine_no,
                brand: v.brand,
                model: v.model,
                zone: v.zone,
                serial_no: v.serial_no,
                purchase_date: v.purchase_date ? dayjs(v.purchase_date).format('YYYY-MM-DD') : undefined,
                bacterial_filter_installed_at: v.bacterial_filter_installed_at
                  ? dayjs(v.bacterial_filter_installed_at).format('YYYY-MM-DD')
                  : undefined,
                bacterial_filter_max_days: v.bacterial_filter_max_days,
                last_dialysate_lab_at: v.last_dialysate_lab_at
                  ? dayjs(v.last_dialysate_lab_at).format('YYYY-MM-DD')
                  : undefined,
                notes: v.notes,
              });
              message.success('已登记');
              setShowMachineModal(false);
              machineForm.resetFields();
              loadAll();
            } catch {
              /* request 已提示 */
            }
          });
        }}
        onCancel={() => {
          setShowMachineModal(false);
          machineForm.resetFields();
        }}
        okText="保存"
        width={560}
      >
        <Form form={machineForm} layout="vertical" size="middle">
          <Form.Item label="机器编号" name="machine_no" rules={[{ required: true, message: '必填' }]}>
            <Input placeholder="如 1号机、HBV-01" />
          </Form.Item>
          <div className="grid-2" style={{ gap: 16 }}>
            <Form.Item label="品牌" name="brand">
              <Input />
            </Form.Item>
            <Form.Item label="型号" name="model">
              <Input />
            </Form.Item>
          </div>
          <Form.Item label="分区" name="zone" initialValue="normal">
            <Select
              options={[
                { value: 'normal', label: '普通区' },
                { value: 'hbv', label: '乙肝区' },
                { value: 'hcv', label: '丙肝区' },
              ]}
            />
          </Form.Item>
          <div className="grid-2" style={{ gap: 16 }}>
            <Form.Item label="序列号" name="serial_no">
              <Input />
            </Form.Item>
            <Form.Item label="装机日期" name="purchase_date">
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <div className="grid-2" style={{ gap: 16 }}>
            <Form.Item label="细菌过滤器安装日" name="bacterial_filter_installed_at">
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="更换周期(天)" name="bacterial_filter_max_days" initialValue={90}>
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <Form.Item label="透析液化验最近日期" name="last_dialysate_lab_at">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="备注" name="notes">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="记录设备维护"
        open={showMaintModal}
        onOk={() => {
          maintForm.validateFields().then(async (v) => {
            if (!maintTargetId) return;
            try {
              const payload = {
                maintenance_type: v.maintenance_type,
                maintenance_date: dayjs(v.maintenance_date).format('YYYY-MM-DD'),
                next_due: v.next_due ? dayjs(v.next_due).format('YYYY-MM-DD') : undefined,
                content: v.content,
                result: v.result,
                notes: v.notes,
              };
              if (maintTargetKind === 'water') {
                await devicesApi.addWaterMachineMaintenance(maintTargetId, payload);
              } else {
                await devicesApi.addMachineMaintenance(maintTargetId, payload);
              }
              message.success(maintTargetKind === 'water' ? '水机维护记录已保存' : '维护记录已保存');
              setShowMaintModal(false);
              maintForm.resetFields();
              setMaintTargetKind(null);
              loadAll();
              if (maintTargetKind === 'water') {
                loadWaterMachines();
                if (waterDrawerMachine?.id === maintTargetId) {
                  try {
                    const res = await devicesApi.waterMachineMaintenance(maintTargetId);
                    setWaterMaintRows(res.data.data ?? []);
                  } catch {
                    /* ignore */
                  }
                }
              }
            } catch {
              /* */
            }
          });
        }}
        onCancel={() => {
          setShowMaintModal(false);
          maintForm.resetFields();
          setMaintTargetKind(null);
        }}
        okText="保存"
        width={520}
      >
        <Form form={maintForm} layout="vertical" size="middle">
          <Form.Item label="维护类型" name="maintenance_type" rules={[{ required: true }]} initialValue="routine">
            <Select
              options={[
                { value: 'routine', label: '预防性维护' },
                { value: 'repair', label: '故障修复' },
                { value: 'disinfect', label: '消毒' },
                { value: 'calibration', label: '校准' },
                { value: 'bacterial_filter', label: '细菌过滤器更换' },
              ]}
            />
          </Form.Item>
          <div className="grid-2" style={{ gap: 16 }}>
            <Form.Item label="维护日期" name="maintenance_date" rules={[{ required: true }]} initialValue={dayjs()}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="下次到期" name="next_due">
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <Form.Item label="维护内容" name="content" rules={[{ required: true }]}>
            <Input.TextArea rows={3} placeholder="描述维护内容、更换部件等" />
          </Form.Item>
          <Form.Item label="结果" name="result">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="耗材入库"
        open={showInboundModal}
        onOk={() => {
          inboundForm.validateFields().then(async (v) => {
            try {
              await devicesApi.inbound({
                stock_item_id: inboundStockId!,
                quantity: v.quantity,
                lot_no: v.lot_no,
                expiry_date: v.expiry_date ? dayjs(v.expiry_date).format('YYYY-MM-DD') : undefined,
                notes: v.notes,
              });
              message.success('入库成功');
              setShowInboundModal(false);
              inboundForm.resetFields();
              setInboundStockId(undefined);
              loadAll();
            } catch {
              /* */
            }
          });
        }}
        onCancel={() => {
          setShowInboundModal(false);
          inboundForm.resetFields();
          setInboundStockId(undefined);
        }}
        okText="确认入库"
        width={520}
      >
        <Form form={inboundForm} layout="vertical" size="middle">
          <div className="grid-2" style={{ gap: 16 }}>
            <Form.Item label="数量" name="quantity" rules={[{ required: true }]}>
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="批号" name="lot_no" rules={[{ required: true }]}>
              <Input placeholder="产品批号" />
            </Form.Item>
          </div>
          <Form.Item label="效期" name="expiry_date">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          {inboundStockId && (
            <Form.Item label="耗材基础信息">
              <div style={{ fontSize: 13, color: '#475569' }}>
                {(() => {
                  const item = consumables.find((c) => c.id === inboundStockId);
                  if (!item) return null;
                  return (
                    <>
                      <div>
                        品名：{item.item_name}（{item.category}）
                      </div>
                      <div>规格型号：{item.specification || '—'}</div>
                      <div>单位：{item.unit}</div>
                      <div>厂家：{item.manufacturer || '—'}</div>
                    </>
                  );
                })()}
              </div>
            </Form.Item>
          )}
          <Form.Item label="备注" name="notes">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </PageShell>
  );
}
