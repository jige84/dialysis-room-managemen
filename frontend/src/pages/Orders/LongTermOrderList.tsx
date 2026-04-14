/**
 * 长期医嘱单列表与管理页
 * 以患者为维度展示有效/已停止医嘱，支持开立/停止操作，对接 ordersApi。
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import dayjs from 'dayjs';
import {
  Card, Select, Button, Table, Tag, Modal, Form, Input, Space, message, Divider, List, Typography, Spin, Alert,
} from 'antd';
import { PlusOutlined, StopOutlined, ReloadOutlined, MinusCircleOutlined } from '@ant-design/icons';
import PageShell from '../../components/PageShell/PageShell';
import { patientsApi, type Patient } from '../../api/patients';
import ordersApi, {
  type LongTermOrder,
  type OrderGuidanceSuggestion,
  FREQ_LABELS,
  ORDER_TYPE_LABELS,
  EXEC_TIMING_LABELS,
} from '../../api/orders';
import { usePermission } from '../../utils/permission';
import {
  describeDialysisOrderFrequencyForSession,
  describeFrequencyDetailForOrder,
  frequencyDetailPlaceholder,
} from '../../utils/longTermOrderScheduleText';
import { HD_LONG_TERM_ORDER_SAVED_EVENT } from '../../constants/prescriptionSyncEvents';

/** 通知透析录入页重新拉取 prepare（ordersToday），与患者 ID 绑定避免串患者 */
function dispatchLongTermOrderSavedForDialysisSync(patientId: string) {
  window.dispatchEvent(
    new CustomEvent(HD_LONG_TERM_ORDER_SAVED_EVENT, {
      detail: { patientId, savedAt: new Date().toISOString() },
    }),
  );
}
import prescriptionsApi from '../../api/prescriptions';

interface ComboChildDraft {
  drug_name: string;
  doseNumber?: string | number;
  doseUnit?: string;
}

interface NewOrderDraft {
  key: string;
  drug: string;
  dose: string;
  route: string;
  freq: string;
  order_type: LongTermOrder['order_type'];
  frequency_detail?: string;
  /** 透析用药：与透析录入「今日医嘱执行确认」展示一致 */
  execute_timing?: LongTermOrder['execute_timing'];
  notes?: string;
  /** 组合子药品（与主药同用法/频次） */
  combo_children?: ComboChildDraft[];
}

const EXEC_TIMING_OPTIONS = [
  { value: 'pre_dialysis', label: EXEC_TIMING_LABELS.pre_dialysis },
  { value: 'during_dialysis', label: EXEC_TIMING_LABELS.during_dialysis },
  { value: 'post_dialysis', label: EXEC_TIMING_LABELS.post_dialysis },
  { value: 'anytime', label: EXEC_TIMING_LABELS.anytime },
];

function sortComboOrders<T extends { id: string; parent_order_id?: string | null; created_at?: string }>(
  rows: T[],
): T[] {
  return [...rows].sort((a, b) => {
    const ga = String(a.parent_order_id || a.id);
    const gb = String(b.parent_order_id || b.id);
    const c = ga.localeCompare(gb);
    if (c !== 0) return c;
    const ap = !!a.parent_order_id;
    const bp = !!b.parent_order_id;
    if (ap !== bp) return ap ? 1 : -1;
    return String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''));
  });
}

function normalizeComboChildren(raw: unknown): ComboChildDraft[] {
  if (!Array.isArray(raw)) return [];
  const out: ComboChildDraft[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const rec = row as { drug_name?: string; doseNumber?: string | number; doseUnit?: string };
    const drug_name = String(rec.drug_name ?? '').trim();
    if (!drug_name) continue;
    out.push({
      drug_name,
      doseNumber: rec.doseNumber,
      doseUnit: rec.doseUnit,
    });
  }
  return out;
}

function validateComboChildrenComplete(children: ComboChildDraft[]): boolean {
  for (const c of children) {
    if (c.doseNumber === undefined || c.doseNumber === '' || c.doseNumber === null) {
      message.warning(`子药品「${c.drug_name}」请填写剂量数值`);
      return false;
    }
    if (!String(c.doseUnit ?? '').trim()) {
      message.warning(`子药品「${c.drug_name}」请选择单位`);
      return false;
    }
  }
  return true;
}

const FREQ_OPTIONS = [
  { value: 'every_session', label: '每透析日' },
  { value: 'qd', label: 'qd（每日1次）' },
  { value: 'bid', label: 'bid（每日2次）' },
  { value: 'tid', label: 'tid（每日3次）' },
  { value: 'tiw', label: 'tiw（每周3次）' },
  { value: 'biw', label: 'biw（每周2次）' },
  { value: 'qw', label: 'qw（每周1次）' },
  { value: 'q2w', label: 'q2w（每2周1次）' },
  { value: 'qm', label: 'qm（每月1次）' },
];

const ORDER_TYPE_OPTIONS = [
  { value: 'dialysis_drug', label: '透析用药' },
  { value: 'interval_drug', label: '间期用药' },
  { value: 'treatment', label: '治疗' },
  { value: 'diet', label: '饮食' },
  { value: 'care', label: '护理' },
  { value: 'observation', label: '观察' },
];

/** 与下拉「其他」选项对应的 value，提交时替换为 route_other 文本 */
const ROUTE_OTHER_SENTINEL = '__route_other__';

const LONG_TERM_ROUTE_OPTIONS = [
  { value: '口服', label: '口服' },
  { value: '口服 随餐', label: '口服 随餐' },
  { value: '口服 睡前', label: '口服 睡前' },
  { value: '皮下注射', label: '皮下注射' },
  { value: '肌内注射', label: '肌内注射' },
  { value: '静脉注射', label: '静脉注射' },
  { value: '静脉滴注', label: '静脉滴注' },
  { value: '透析中静脉泵入', label: '透析中静脉泵入' },
  { value: '透析前静脉推注', label: '透析前静脉推注' },
  { value: '下机前注射', label: '下机前注射' },
  { value: ROUTE_OTHER_SENTINEL, label: '其他（手动输入）' },
];

function normalizeLongTermRoute(route: unknown, routeOther: unknown): string {
  if (route === ROUTE_OTHER_SENTINEL) {
    const t = typeof routeOther === 'string' ? routeOther.trim() : '';
    return t;
  }
  return typeof route === 'string' ? route.trim() : '';
}

export default function LongTermOrderListPage() {
  const { canPrescribe } = usePermission();

  const [patientOptions, setPatientOptions] = useState<{ value: string; label: string; info?: string }[]>([]);
  const [patientsLoading, setPatientsLoading] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<string | null>(null);

  const [activeOrders, setActiveOrders] = useState<LongTermOrder[]>([]);
  const [stoppedOrders, setStoppedOrders] = useState<LongTermOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);

  const [showNewModal, setShowNewModal] = useState(false);
  const [showStopModal, setShowStopModal] = useState(false);
  const [stopTarget, setStopTarget] = useState<LongTermOrder | null>(null);
  const [filterMode, setFilterMode] = useState<'active' | 'all'>('active');
  const [showStopped, setShowStopped] = useState(false);
  const [newForm] = Form.useForm();
  const [stopForm] = Form.useForm();
  const [draftOrders, setDraftOrders] = useState<NewOrderDraft[]>([]);
  const [submitting, setSubmitting] = useState(false);
  /** 与透析录入「今日医嘱执行确认」同源：用于透析用药频次旁注处方每周次数 */
  const [prescriptionSessionsPerWeek, setPrescriptionSessionsPerWeek] = useState<number | null>(null);

  const newRouteWatch = Form.useWatch('route', newForm);
  const orderTypeWatch = Form.useWatch('order_type', newForm) ?? 'dialysis_drug';
  const frequencyWatch = Form.useWatch('frequency', newForm) as string | undefined;

  const freqSelectOptions = useMemo(() => {
    if (orderTypeWatch === 'interval_drug') {
      return FREQ_OPTIONS.filter((o) => o.value !== 'every_session');
    }
    return FREQ_OPTIONS;
  }, [orderTypeWatch]);

  // 加载患者列表
  useEffect(() => {
    setPatientsLoading(true);
    patientsApi.list({ status: 'active', page: 1, page_size: 200 })
      .then(res => {
        const items = res.data.data?.list ?? [];
        const opts = items.map((p: Patient) => ({
          value: p.id,
          label: p.name,
          info: `${p.primary_diagnosis} · 透析龄${p.dialysis_age ?? '—'}`,
        }));
        setPatientOptions(opts);
        if (opts.length > 0) setSelectedPatient(opts[0].value);
      })
      .catch(() => message.error('加载患者列表失败'))
      .finally(() => setPatientsLoading(false));
  }, []);

  // 加载医嘱
  const loadOrders = useCallback((patientId: string) => {
    setOrdersLoading(true);
    Promise.all([
      ordersApi.getActive(patientId),
      ordersApi.getHistory(patientId),
    ])
      .then(([activeRes, historyRes]) => {
        setActiveOrders(activeRes.data.data ?? []);
        const all = historyRes.data.data ?? [];
        setStoppedOrders(all.filter(o => o.status === 'stopped'));
      })
      .catch(() => message.error('加载医嘱数据失败'))
      .finally(() => setOrdersLoading(false));
  }, []);

  useEffect(() => {
    if (selectedPatient) loadOrders(selectedPatient);
  }, [selectedPatient, loadOrders]);

  useEffect(() => {
    if (!selectedPatient) {
      setPrescriptionSessionsPerWeek(null);
      return;
    }
    let cancelled = false;
    prescriptionsApi
      .getCurrent(selectedPatient)
      .then((res) => {
        if (cancelled) return;
        const rx = res.data.data;
        const n = rx?.frequency_per_week;
        setPrescriptionSessionsPerWeek(
          n != null && Number.isFinite(Number(n)) && Number(n) > 0 ? Number(n) : null,
        );
      })
      .catch(() => {
        if (!cancelled) setPrescriptionSessionsPerWeek(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPatient]);

  const patientInfo = patientOptions.find(p => p.value === selectedPatient);

  const parentIdsWithChildren = useMemo(() => {
    const s = new Set<string>();
    activeOrders.forEach((o) => {
      if (o.parent_order_id) s.add(o.parent_order_id);
    });
    return s;
  }, [activeOrders]);

  // 表格列定义
  const activeColumns = [
    { title: '类型', dataIndex: 'order_type', width: 80,
      render: (v: string) => <Tag>{ORDER_TYPE_LABELS[v] || v}</Tag> },
    {
      title: '药品/项目',
      dataIndex: 'drug_name',
      render: (_: string, r: LongTermOrder) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
          {r.parent_order_id ? (
            <span style={{ color: '#94A3B8', fontFamily: 'monospace' }}>↳</span>
          ) : null}
          <span style={{ fontWeight: 600, color: '#0D1B3E' }}>{r.drug_name}</span>
          {!r.parent_order_id && parentIdsWithChildren.has(r.id) ? (
            <Tag color="cyan" style={{ fontSize: 11, margin: 0 }}>组合</Tag>
          ) : null}
        </span>
      ),
    },
    { title: '剂量', key: 'dose',
      render: (_: unknown, r: LongTermOrder) => <span className="num">{r.dose ?? ''} {r.dose_unit ?? ''}</span> },
    { title: '用法', dataIndex: 'route' },
    { title: '频次', dataIndex: 'frequency',
      render: (v: string) => <Tag color="blue" style={{ fontSize: 11 }}>{FREQ_LABELS[v] || v}</Tag> },
    {
      title: '具体执行',
      key: 'schedule',
      width: 220,
      render: (_: unknown, r: LongTermOrder) => {
        const schedule =
          r.order_type === 'dialysis_drug'
            ? describeDialysisOrderFrequencyForSession(
                r.frequency,
                r.frequency_detail,
                prescriptionSessionsPerWeek,
              )
            : describeFrequencyDetailForOrder(r.frequency, r.frequency_detail);
        if (r.order_type === 'dialysis_drug' && r.execute_timing) {
          return (
            <span style={{ fontSize: 12, color: '#475569', lineHeight: 1.45 }}>
              <span style={{ color: '#0D1B3E', fontWeight: 600 }}>
                {EXEC_TIMING_LABELS[r.execute_timing] ?? r.execute_timing}
              </span>
              <span style={{ margin: '0 4px', color: '#94A3B8' }}>·</span>
              {schedule}
            </span>
          );
        }
        return (
          <span style={{ fontSize: 12, color: '#475569', lineHeight: 1.45 }}>{schedule}</span>
        );
      },
    },
    { title: '开具医生', dataIndex: 'ordered_by_name' },
    {
      title: '开立时间',
      key: 'ordered_at',
      width: 152,
      render: (_: unknown, r: LongTermOrder) => {
        const t = r.ordered_at ? dayjs(r.ordered_at).format('YYYY-MM-DD HH:mm') : '';
        return <span className="num text-sm">{t || r.valid_from || '—'}</span>;
      },
    },
    {
      title: '状态',
      render: () => <span style={{ background: '#ECFDF5', color: '#059669', padding: '2px 8px', borderRadius: 20, fontSize: 12, fontWeight: 500 }}>有效</span>,
    },
    ...(canPrescribe ? [{
      title: '操作',
      render: (_: unknown, r: LongTermOrder) => (
        <Space size={4}>
          <Button size="small" danger icon={<StopOutlined />} onClick={() => { setStopTarget(r); setShowStopModal(true); }}>
            停止
          </Button>
        </Space>
      ),
    }] : []),
  ];

  const stoppedColumns = [
    {
      title: '药品/项目',
      dataIndex: 'drug_name',
      render: (_: string, r: LongTermOrder) => (
        <span style={{ fontWeight: 600, color: '#9CA3AF', textDecoration: 'line-through' }}>
          {r.parent_order_id ? '↳ ' : ''}{r.drug_name}
        </span>
      ),
    },
    { title: '剂量', key: 'dose',
      render: (_: unknown, r: LongTermOrder) => <span className="num text-muted">{r.dose ?? ''} {r.dose_unit ?? ''}</span> },
    { title: '用法', dataIndex: 'route', render: (v: string) => <span className="text-muted">{v}</span> },
    { title: '频次', dataIndex: 'frequency',
      render: (v: string) => <Tag color="default" style={{ fontSize: 11 }}>{FREQ_LABELS[v] || v}</Tag> },
    {
      title: '具体执行',
      key: 'schedule',
      width: 200,
      render: (_: unknown, r: LongTermOrder) => {
        const schedule =
          r.order_type === 'dialysis_drug'
            ? describeDialysisOrderFrequencyForSession(
                r.frequency,
                r.frequency_detail,
                prescriptionSessionsPerWeek,
              )
            : describeFrequencyDetailForOrder(r.frequency, r.frequency_detail);
        if (r.order_type === 'dialysis_drug' && r.execute_timing) {
          return (
            <span style={{ fontSize: 12, color: '#64748B', lineHeight: 1.45 }}>
              <span style={{ color: '#475569', fontWeight: 600 }}>
                {EXEC_TIMING_LABELS[r.execute_timing] ?? r.execute_timing}
              </span>
              <span style={{ margin: '0 4px', color: '#CBD5E1' }}>·</span>
              {schedule}
            </span>
          );
        }
        return (
          <span style={{ fontSize: 12, color: '#64748B', lineHeight: 1.45 }}>{schedule}</span>
        );
      },
    },
    { title: '停止日期', dataIndex: 'stopped_at',
      render: (v: string) => <span className="num text-sm text-muted">{v ? v.slice(0, 10) : ''}</span> },
    { title: '停止原因', dataIndex: 'stop_reason',
      render: (v: string) => <span className="text-sm text-muted">{v}</span> },
  ];

  // 添加到草稿
  const handleNewOrder = () => {
    newForm.validateFields().then((values) => {
      const combo_children = normalizeComboChildren(values.combo_children);
      if (!validateComboChildrenComplete(combo_children)) return;
      const draft: NewOrderDraft = {
        key: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        drug: values.drug_name,
        dose: values.doseNumber && values.doseUnit ? `${values.doseNumber} ${values.doseUnit}` : (values.dose || ''),
        route: normalizeLongTermRoute(values.route, values.route_other),
        freq: values.frequency,
        order_type: values.order_type,
        frequency_detail: typeof values.frequency_detail === 'string' ? values.frequency_detail.trim() : undefined,
        execute_timing: values.order_type === 'dialysis_drug' ? (values.execute_timing as LongTermOrder['execute_timing']) : undefined,
        notes: values.notes,
        combo_children: combo_children.length > 0 ? combo_children : undefined,
      };
      setDraftOrders((prev) => [...prev, draft]);
      newForm.resetFields();
      message.success('已添加到待开具列表，可继续录入');
    });
  };

  // 批量提交
  const handleConfirmAllNewOrders = async () => {
    if (!selectedPatient) return;
    const finalOrders = [...draftOrders];

    const hasForm = newForm.getFieldValue('drug_name');
    if (hasForm) {
      try {
        const values = await newForm.validateFields();
        const combo_children = normalizeComboChildren(values.combo_children);
        if (!validateComboChildrenComplete(combo_children)) return;
        finalOrders.push({
          key: `${Date.now()}`,
          drug: values.drug_name,
          dose: values.doseNumber && values.doseUnit ? `${values.doseNumber} ${values.doseUnit}` : '',
          route: normalizeLongTermRoute(values.route, values.route_other),
          freq: values.frequency,
          order_type: values.order_type,
          frequency_detail: typeof values.frequency_detail === 'string' ? values.frequency_detail.trim() : undefined,
          execute_timing: values.order_type === 'dialysis_drug' ? (values.execute_timing as LongTermOrder['execute_timing']) : undefined,
          notes: values.notes,
          combo_children: combo_children.length > 0 ? combo_children : undefined,
        });
      } catch { return; }
    }

    if (finalOrders.length === 0) {
      message.warning('请先录入至少一条长期医嘱');
      return;
    }

    setSubmitting(true);
    try {
      let lastGuidance: OrderGuidanceSuggestion[] = [];
      for (const draft of finalOrders) {
        const [doseVal, ...unitParts] = draft.dose.split(' ');
        const res = await ordersApi.create(selectedPatient, {
          order_type: draft.order_type ?? 'dialysis_drug',
          drug_name: draft.drug,
          dose: doseVal,
          dose_unit: unitParts.join(' ') || undefined,
          route: draft.route,
          frequency: draft.freq as LongTermOrder['frequency'],
          frequency_detail: draft.frequency_detail || undefined,
          /** 浏览器本地日历日，避免服务端 UTC 日期与临床「今日」不一致 */
          valid_from: dayjs().format('YYYY-MM-DD'),
          execute_timing:
            draft.order_type === 'dialysis_drug'
              ? (draft.execute_timing ?? 'during_dialysis')
              : undefined,
          notes: draft.notes,
          child_orders: (draft.combo_children ?? []).map((c) => ({
            drug_name: c.drug_name,
            dose: c.doseNumber != null && c.doseNumber !== '' ? String(c.doseNumber) : undefined,
            dose_unit: c.doseUnit?.trim() || undefined,
          })),
        });
        const payload = res.data.data;
        if (payload?.guidance_suggestions?.length) lastGuidance = payload.guidance_suggestions;
      }
      setShowNewModal(false);
      newForm.resetFields();
      setDraftOrders([]);
      message.success(`长期医嘱已批量开具，共 ${finalOrders.length} 条`);
      dispatchLongTermOrderSavedForDialysisSync(selectedPatient);
      loadOrders(selectedPatient);
      if (lastGuidance.length > 0) {
        Modal.info({
          title: '可选指导建议',
          width: 600,
          content: (
            <div>
              <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
                以下为规则与指南生成的参考建议，可选用；不会自动写入医嘱备注。
              </Typography.Paragraph>
              <List
                size="small"
                dataSource={lastGuidance}
                renderItem={(item) => (
                  <List.Item>
                    <div>
                      <div style={{ fontWeight: 500 }}>{item.text}</div>
                      {item.citation_excerpt ? (
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          引用摘要：{item.citation_excerpt.slice(0, 200)}
                          {item.citation_excerpt.length > 200 ? '…' : ''}
                        </Typography.Text>
                      ) : null}
                    </div>
                  </List.Item>
                )}
              />
            </div>
          ),
        });
      }
    } catch {
      message.error('医嘱开具失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  // 停止医嘱
  const handleStop = async () => {
    if (!stopTarget || !selectedPatient) return;
    try {
      const values = await stopForm.validateFields();
      setSubmitting(true);
      await ordersApi.stop(stopTarget.id, values.reason);
      setShowStopModal(false);
      stopForm.resetFields();
      setStopTarget(null);
      message.success('医嘱已停止');
      dispatchLongTermOrderSavedForDialysisSync(selectedPatient);
      loadOrders(selectedPatient);
    } catch {
      message.error('停止医嘱失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PageShell fullWidth>
      {/* 患者选择 */}
      <Card style={{ marginBottom: 20, border: '1px solid #DBEAFE' }}
        styles={{ body: { padding: '16px 20px' } }}>
        <div className="flex items-center gap-16 flex-wrap">
          <div>
            <div style={{ fontSize: 12, color: '#7B92BC', marginBottom: 4 }}>选择患者</div>
            <Select
              value={selectedPatient}
              onChange={setSelectedPatient}
              options={patientOptions}
              style={{ width: 220 }}
              showSearch
              loading={patientsLoading}
              filterOption={(input, opt) => (opt?.label as string ?? '').includes(input)}
              placeholder="搜索患者"
            />
          </div>
          {patientInfo && (
            <div className="flex items-center gap-8">
              <div className="hd-avatar hd-avatar-m">{patientInfo.label.charAt(0)}</div>
              <div>
                <div style={{ fontWeight: 700 }}>{patientInfo.label}</div>
                <div style={{ fontSize: 12, color: '#7B92BC' }}>{patientInfo.info}</div>
              </div>
            </div>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <Button size="small" type={filterMode === 'active' ? 'primary' : 'default'}
              onClick={() => setFilterMode('active')}>有效医嘱</Button>
            <Button size="small" type={filterMode === 'all' ? 'primary' : 'default'}
              onClick={() => { setFilterMode('all'); setShowStopped(true); }}>全部医嘱</Button>
            {canPrescribe && (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setShowNewModal(true)}>
                开具新医嘱
              </Button>
            )}
            <Button icon={<ReloadOutlined />} onClick={() => selectedPatient && loadOrders(selectedPatient)} />
          </div>
        </div>
      </Card>

      {/* 有效医嘱 */}
      <Spin spinning={ordersLoading}>
        <Card style={{ marginBottom: 16, border: '1px solid #DBEAFE' }}
          styles={{ header: { background: '#FAFCFF', borderBottom: '1px solid #DBEAFE' } }}
          title={<span style={{ fontWeight: 600 }}>✅ 有效医嘱 <span style={{ color: '#7B92BC', fontSize: 12, marginLeft: 8 }}>({activeOrders.length}条)</span></span>}>
          <Table rowKey="id" dataSource={sortComboOrders(activeOrders)} columns={activeColumns} size="small"
            pagination={false} locale={{ emptyText: '暂无有效医嘱' }} />
        </Card>

        {/* 已停止医嘱 */}
        {(filterMode === 'all' || showStopped) && stoppedOrders.length > 0 && (
          <Card style={{ border: '1px solid #DBEAFE', opacity: 0.85 }}
            styles={{ header: { background: '#F8FAFC', borderBottom: '1px solid #DBEAFE' } }}
            title={
              <div className="flex items-center gap-8">
                <span style={{ fontWeight: 600, color: '#9CA3AF' }}>
                  ⛔ 已停止医嘱 <span style={{ fontSize: 12, marginLeft: 8 }}>({stoppedOrders.length}条)</span>
                </span>
                <Button size="small" type="text" style={{ color: '#7B92BC' }}
                  onClick={() => setShowStopped(s => !s)}>
                  {showStopped ? '▲ 折叠' : '▼ 展开'}
                </Button>
              </div>
            }>
            {showStopped && (
              <Table rowKey="id" dataSource={sortComboOrders(stoppedOrders)} columns={stoppedColumns} size="small"
                pagination={false} />
            )}
          </Card>
        )}
      </Spin>

      {/* 开具新医嘱弹窗 */}
      <Modal
        title="开具长期医嘱"
        open={showNewModal}
        onCancel={() => { setShowNewModal(false); newForm.resetFields(); setDraftOrders([]); }}
        footer={[
          <Button key="cancel" onClick={() => { setShowNewModal(false); newForm.resetFields(); setDraftOrders([]); }}>取消</Button>,
          <Button key="add" type="dashed" onClick={handleNewOrder}>添加到列表，继续录入</Button>,
          <Button key="submit" type="primary" loading={submitting} onClick={handleConfirmAllNewOrders}>确认开具全部</Button>,
        ]}
        width={720}
      >
        <Divider style={{ margin: '12px 0', borderColor: '#DBEAFE' }} />
        <Form
          form={newForm}
          layout="vertical"
          size="middle"
          initialValues={{
            order_type: 'dialysis_drug',
            frequency: 'every_session',
            combo_children: [],
            execute_timing: 'during_dialysis',
          }}
        >
          <div className="grid-2" style={{ gap: 16 }}>
            <Form.Item label="医嘱类型" name="order_type" rules={[{ required: true }]}>
              <Select
                options={ORDER_TYPE_OPTIONS}
                onChange={(v: string) => {
                  if (v === 'interval_drug' && newForm.getFieldValue('frequency') === 'every_session') {
                    newForm.setFieldsValue({ frequency: 'qd' });
                  }
                  if (v !== 'interval_drug') {
                    newForm.setFieldValue('frequency_detail', undefined);
                  }
                }}
              />
            </Form.Item>
            <Form.Item label="药品/项目名称" name="drug_name" rules={[{ required: true, message: '请输入药品名称' }]}>
              <Input placeholder="如：重组人促红素注射液" />
            </Form.Item>
          </div>
          <div className="grid-2" style={{ gap: 16 }}>
            <Form.Item label="剂量" required>
              <Input.Group compact>
                <Form.Item name="doseNumber" noStyle rules={[{ required: true, message: '请输入剂量' }]}>
                  <Input style={{ width: '60%' }} placeholder="数值" />
                </Form.Item>
                <Form.Item name="doseUnit" noStyle rules={[{ required: true, message: '请选择单位' }]}>
                  <Select style={{ width: '40%' }} placeholder="单位"
                    options={[
                      { value: 'mg', label: 'mg' }, { value: 'g', label: 'g' },
                      { value: 'μg', label: 'μg' }, { value: 'IU', label: 'IU' },
                      { value: 'mL', label: 'mL' }, { value: '片', label: '片' },
                      { value: '粒', label: '粒' }, { value: '袋', label: '袋' },
                      { value: '支', label: '支' },
                    ]} />
                </Form.Item>
              </Input.Group>
            </Form.Item>
            <Form.Item label="用法" name="route" rules={[{ required: true, message: '请选择用法' }]}>
              <Select
                showSearch
                optionFilterProp="label"
                options={LONG_TERM_ROUTE_OPTIONS}
                onChange={(v: string) => {
                  if (v !== ROUTE_OTHER_SENTINEL) {
                    newForm.setFieldValue('route_other', undefined);
                  }
                }}
              />
            </Form.Item>
            {newRouteWatch === ROUTE_OTHER_SENTINEL ? (
              <Form.Item
                label="具体用法（手动输入）"
                name="route_other"
                rules={[{ required: true, whitespace: true, message: '请输入具体用法' }]}
              >
                <Input placeholder="请输入具体给药途径或说明" allowClear />
              </Form.Item>
            ) : null}
          </div>
          <Divider plain style={{ margin: '12px 0' }}>组合用药（可选）</Divider>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 10, fontSize: 12 }}>
            子药品与主药共用<strong>用法</strong>及下方<strong>执行频次、开具说明</strong>（间期用药亦共用「具体执行」）。例：氯化钠注射液（主）+ 蔗糖铁注射液（子）。
          </Typography.Paragraph>
          <Form.List name="combo_children">
            {(fields, { add, remove }) => (
              <div style={{ marginBottom: 12 }}>
                {fields.map((field, index) => (
                  <div
                    key={field.key}
                    style={{
                      display: 'flex',
                      gap: 8,
                      alignItems: 'flex-end',
                      flexWrap: 'wrap',
                      marginBottom: 8,
                    }}
                  >
                    <Form.Item
                      label={index === 0 ? '子药品名称' : undefined}
                      name={[field.name, 'drug_name']}
                      style={{ flex: '1 1 200px', marginBottom: 0 }}
                    >
                      <Input placeholder="如：蔗糖铁注射液" allowClear />
                    </Form.Item>
                    <Form.Item
                      label={index === 0 ? '子药品剂量' : undefined}
                      style={{ flex: '0 0 220px', marginBottom: 0 }}
                    >
                      <Input.Group compact style={{ width: '100%' }}>
                        <Form.Item name={[field.name, 'doseNumber']} noStyle>
                          <Input style={{ width: '50%' }} placeholder="数值" />
                        </Form.Item>
                        <Form.Item name={[field.name, 'doseUnit']} noStyle>
                          <Select
                            style={{ width: '50%' }}
                            placeholder="单位"
                            allowClear
                            options={[
                              { value: 'mg', label: 'mg' },
                              { value: 'g', label: 'g' },
                              { value: 'μg', label: 'μg' },
                              { value: 'IU', label: 'IU' },
                              { value: 'mL', label: 'mL' },
                              { value: '片', label: '片' },
                              { value: '支', label: '支' },
                            ]}
                          />
                        </Form.Item>
                      </Input.Group>
                    </Form.Item>
                    <Button
                      type="text"
                      danger
                      icon={<MinusCircleOutlined />}
                      onClick={() => remove(field.name)}
                      style={{ marginBottom: 4 }}
                    >
                      删除
                    </Button>
                  </div>
                ))}
                <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>
                  添加子药品
                </Button>
              </div>
            )}
          </Form.List>
          <Form.Item label="执行频次" name="frequency" rules={[{ required: true }]}>
            <Select options={freqSelectOptions} />
          </Form.Item>
          {orderTypeWatch === 'dialysis_drug' && (
            <Form.Item
              label="床旁执行时段"
              name="execute_timing"
              rules={[{ required: true, message: '请选择床旁核对时段（与透析录入页展示一致）' }]}
            >
              <Select options={EXEC_TIMING_OPTIONS} />
            </Form.Item>
          )}
          {orderTypeWatch === 'dialysis_drug' &&
            ['qw', 'q2w', 'qm', 'biw', 'tiw'].includes(String(frequencyWatch || '')) && (
            <Form.Item
              label="具体执行（周几或日期）"
              name="frequency_detail"
              extra={(
                <span style={{ fontSize: 12, color: '#64748B' }}>
                  提示：{frequencyDetailPlaceholder(frequencyWatch || 'qw')}
                </span>
              )}
            >
              <Input placeholder={frequencyDetailPlaceholder(frequencyWatch || 'qw')} allowClear />
            </Form.Item>
          )}
          {orderTypeWatch === 'interval_drug' && (
            <>
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 12 }}
                message="间期用药（非透析日）须约定具体执行时间"
                description={
                  <div style={{ fontSize: 12.5, lineHeight: 1.65 }}>
                    <div>请在下一栏填写与频次对应的<strong>固定执行时间</strong>：</div>
                    <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                      <li>按<strong>周几</strong>：填 0–6（0 周日 … 6 周六）；tiw 填 135 或 246；biw 填如 1,4</li>
                      <li>按<strong>每月日期</strong>：qm 填 1–31（表示每月几号）</li>
                      <li>口服时间等可在「开具说明」中补充（如餐后）</li>
                    </ul>
                  </div>
                }
              />
              <Form.Item
                label="具体执行（周几或日期）"
                name="frequency_detail"
                rules={[
                  {
                    required: true,
                    message: '请填写具体用药对应的周几或每月几日',
                  },
                  {
                    validator: (_, v) => {
                      if (typeof v === 'string' && v.trim().length > 0) return Promise.resolve();
                      if (v == null || v === '') {
                        return Promise.reject(new Error('间期用药须明确周几或日期'));
                      }
                      return Promise.resolve();
                    },
                  },
                ]}
                extra={(
                  <span style={{ fontSize: 12, color: '#64748B' }}>
                    提示：{frequencyDetailPlaceholder(frequencyWatch || 'qd')}
                  </span>
                )}
              >
                <Input placeholder={frequencyDetailPlaceholder(frequencyWatch || 'qd')} allowClear />
              </Form.Item>
            </>
          )}
          <Form.Item label="开具说明" name="notes">
            <Input.TextArea rows={2} placeholder="特殊说明或注意事项…" />
          </Form.Item>
        </Form>
        <div style={{ padding: '8px 0', fontSize: 12.5, color: '#7B92BC' }}>
          ⓘ 透析用药可在护士录入透析记录时进入「今日医嘱执行确认」；间期用药不在此确认，请务必在上方填写「具体执行（周几或日期）」以便床旁核对。
        </div>
        {draftOrders.length > 0 && (
          <>
            <Divider style={{ margin: '8px 0', borderColor: '#E5E7EB' }} />
            <Typography.Title level={5} style={{ fontSize: 13, marginBottom: 8 }}>
              待开具医嘱列表（本次批量）
            </Typography.Title>
            <List size="small" bordered dataSource={draftOrders}
              renderItem={item => (
                <List.Item>
                  <div>
                    <div style={{ fontWeight: 600, color: '#0D1B3E' }}>
                      <Tag style={{ marginRight: 8 }}>{ORDER_TYPE_LABELS[item.order_type]}</Tag>
                      {item.drug}
                    </div>
                    <div style={{ fontSize: 12.5, color: '#4B5563', marginTop: 4 }}>
                      {item.dose} · {item.route} · {FREQ_LABELS[item.freq] || item.freq}
                      {item.order_type === 'dialysis_drug' && item.execute_timing ? (
                        <span style={{ color: '#0D1B3E' }}>
                          {' · '}
                          {EXEC_TIMING_LABELS[item.execute_timing] ?? item.execute_timing}
                          {' · '}
                          {describeFrequencyDetailForOrder(item.freq, item.frequency_detail)}
                        </span>
                      ) : null}
                      {item.order_type === 'interval_drug' && (
                        <span style={{ color: '#0369A1' }}>
                          {' · 具体执行：'}
                          {describeFrequencyDetailForOrder(item.freq, item.frequency_detail)}
                        </span>
                      )}
                    </div>
                    {item.combo_children && item.combo_children.length > 0 && (
                      <div style={{ marginTop: 8, paddingLeft: 10, borderLeft: '3px solid #BAE6FD' }}>
                        {item.combo_children.map((c, i) => (
                          <div key={i} style={{ fontSize: 12.5, color: '#64748B' }}>
                            ↳ {c.drug_name}
                            {' '}
                            {c.doseNumber != null && c.doseNumber !== '' ? `${c.doseNumber} ${c.doseUnit ?? ''}` : ''}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </List.Item>
              )} />
          </>
        )}
      </Modal>

      {/* 停止医嘱弹窗 */}
      <Modal title="停止长期医嘱" open={showStopModal}
        onOk={handleStop} confirmLoading={submitting}
        onCancel={() => { setShowStopModal(false); setStopTarget(null); stopForm.resetFields(); }}
        okText="确认停止" okButtonProps={{ danger: true }} cancelText="取消" width={480}>
        {stopTarget && (
          <div>
            <div style={{ marginBottom: 16, padding: 12, background: '#FFF1F2', border: '1px solid #FECDD3', borderRadius: 6 }}>
              <div style={{ fontWeight: 600, color: '#0D1B3E' }}>{stopTarget.drug_name}</div>
              <div style={{ fontSize: 12.5, color: '#7B92BC', marginTop: 4 }}>
                {stopTarget.dose} {stopTarget.dose_unit} · {stopTarget.route} · {FREQ_LABELS[stopTarget.frequency] || stopTarget.frequency}
              </div>
              <div style={{ fontSize: 12, color: '#475569', marginTop: 8 }}>
                具体执行：{describeFrequencyDetailForOrder(stopTarget.frequency, stopTarget.frequency_detail)}
              </div>
            </div>
            <Form form={stopForm} layout="vertical">
              <Form.Item label="停止原因" name="reason" rules={[{ required: true, message: '请填写停止原因' }]}>
                <Input.TextArea rows={3} placeholder="请填写停止该医嘱的原因…" />
              </Form.Item>
            </Form>
          </div>
        )}
      </Modal>
    </PageShell>
  );
}
