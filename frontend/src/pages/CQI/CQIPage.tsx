/**
 * CQI（持续质量改进）记录页 — PDCA 全流程字段，对接 cqi API。
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Card,
  Button,
  Select,
  Modal,
  Form,
  Input,
  DatePicker,
  message,
  Progress,
  Tabs,
  Table,
  Tag,
  Spin,
  Empty,
  Checkbox,
  Collapse,
  Divider,
} from 'antd';
import { PlusOutlined, BugOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useLocation } from 'react-router-dom';
import PageShell from '../../components/PageShell/PageShell';
import {
  cqiApi,
  type CqiRecord,
  type CqiStatus,
  type DefectReport,
  type DefectEventType,
  type CqiUserOption,
} from '../../api/cqi';
import { usePermission } from '../../utils/permission';

const STATUS_CFG: Record<CqiStatus, { label: string; color: string; bg: string }> = {
  ongoing: { label: '进行中', color: '#0369A1', bg: '#E0F2FE' },
  completed: { label: '已完成', color: '#059669', bg: '#ECFDF5' },
  overdue: { label: '已超期', color: '#BE123C', bg: '#FFF1F2' },
  planning: { label: '计划中', color: '#7C3AED', bg: '#FAF5FF' },
};

/** 与需求 3.13.1 改进项目下拉一致 */
const CATEGORIES = [
  '血管通路',
  '透析充分性',
  '感染控制',
  '并发症管理',
  '护患比',
  '其他',
];

const ROLE_LABEL: Record<string, string> = {
  admin: '管理',
  doctor: '医师',
  head_nurse: '护士长',
  nurse: '护士',
  quality: '质控',
  qc: '质控',
};

const DEFECT_TYPES: { value: DefectEventType; label: string }[] = [
  { value: 'operation_error', label: '操作差错' },
  { value: 'equipment_failure', label: '设备故障' },
  { value: 'infection_event', label: '感染事件' },
  { value: 'medication_error', label: '用药错误' },
  { value: 'other', label: '其他' },
];

type LocationDraft = {
  problem_found?: string;
  measures?: string;
  title?: string;
};

function roleShort(role: string): string {
  return ROLE_LABEL[role] ?? role;
}

export default function CQIPage() {
  const location = useLocation();
  const { canEditCqi, canReportDefect } = usePermission();
  const [tab, setTab] = useState<'cqi' | 'defects'>('cqi');

  const [list, setList] = useState<CqiRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<CqiStatus | ''>('');

  const [selected, setSelected] = useState<CqiRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [showNewModal, setShowNewModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [saving, setSaving] = useState(false);

  const [userOptions, setUserOptions] = useState<CqiUserOption[]>([]);

  const [defects, setDefects] = useState<DefectReport[]>([]);
  const [defectLoading, setDefectLoading] = useState(false);
  const [defectModal, setDefectModal] = useState(false);

  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const [defectForm] = Form.useForm();

  const userSelectOptions = useMemo(
    () =>
      userOptions.map((u) => ({
        value: u.id,
        label: `${u.real_name}（${roleShort(u.role)}）`,
      })),
    [userOptions],
  );

  const loadUserOptions = useCallback(async () => {
    if (!canEditCqi) return;
    try {
      const res = await cqiApi.userOptions();
      setUserOptions(res.data.data ?? []);
    } catch {
      setUserOptions([]);
    }
  }, [canEditCqi]);

  useEffect(() => {
    void loadUserOptions();
  }, [loadUserOptions]);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await cqiApi.list({
        page,
        page_size: pageSize,
        status: statusFilter || undefined,
      });
      const payload = res.data.data;
      setList(payload?.data ?? []);
      setTotal(payload?.total ?? 0);
    } catch {
      setList([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, statusFilter]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const loadDefects = useCallback(async () => {
    setDefectLoading(true);
    try {
      const res = await cqiApi.listDefects();
      setDefects(res.data.data ?? []);
    } catch {
      setDefects([]);
    } finally {
      setDefectLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'defects') loadDefects();
  }, [tab, loadDefects]);

  useEffect(() => {
    const st = location.state as { cqiDraft?: LocationDraft } | null;
    const d = st?.cqiDraft;
    if (d && (d.problem_found || d.measures || d.title)) {
      form.setFieldsValue({
        title: d.title || '',
        problem_found: d.problem_found || '',
        measures: d.measures || '',
      });
      setShowNewModal(true);
      window.history.replaceState({}, document.title);
    }
  }, [location.state, form]);

  const openDetail = async (row: CqiRecord) => {
    setSelected(row);
    setDetailLoading(true);
    try {
      const res = await cqiApi.get(row.id);
      const r = res.data.data;
      if (r) setSelected(r);
    } catch {
      message.error('加载详情失败');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleCreate = async () => {
    const v = await form.validateFields();
    setSaving(true);
    try {
      await cqiApi.create({
        project_type: v.category,
        title: v.title,
        problem_found: v.problem_found,
        measures: v.measures,
        start_date: v.startDate ? dayjs(v.startDate).format('YYYY-MM-DD') : undefined,
        target_description: v.goal || undefined,
        target_value: v.target_value != null ? Number(v.target_value) : undefined,
        target_unit: v.target_unit || undefined,
        notes: v.leaderNote || undefined,
        status: v.initialStatus || 'ongoing',
        leader_id: v.leader_id || undefined,
        root_cause: v.root_cause || undefined,
        participants: Array.isArray(v.participants) ? v.participants : [],
        review_date: v.review_date ? dayjs(v.review_date).format('YYYY-MM-DD') : undefined,
      });
      message.success('CQI 项目已创建');
      setShowNewModal(false);
      form.resetFields();
      loadList();
    } catch {
      /* 校验或接口错误已提示 */
    } finally {
      setSaving(false);
    }
  };

  const openEdit = () => {
    if (!selected) return;
    editForm.setFieldsValue({
      status: selected.status,
      problem_found: selected.problem_found,
      root_cause: selected.root_cause,
      target_description: selected.target_description,
      target_value: selected.target_value != null ? Number(selected.target_value) : undefined,
      target_unit: selected.target_unit,
      measures: selected.measures,
      leader_id: selected.leader_id,
      participants: selected.participants ?? [],
      review_date: selected.review_date ? dayjs(selected.review_date) : undefined,
      implementation_notes: selected.implementation_notes,
      implementation_date: selected.implementation_date ? dayjs(selected.implementation_date) : undefined,
      outcome: selected.outcome,
      effect_description: selected.effect_description,
      actual_value: selected.actual_value != null ? Number(selected.actual_value) : undefined,
      is_goal_achieved: selected.is_goal_achieved,
      summary: selected.summary,
      actual_end_date: selected.actual_end_date ? dayjs(selected.actual_end_date) : undefined,
      director_sign_id: selected.director_sign_id,
      director_sign_date: selected.director_sign_date ? dayjs(selected.director_sign_date) : undefined,
      notes: selected.notes,
    });
    setShowEditModal(true);
  };

  const handleUpdate = async () => {
    if (!selected) return;
    const v = await editForm.validateFields();
    setSaving(true);
    try {
      await cqiApi.update(selected.id, {
        status: v.status,
        problem_found: v.problem_found,
        root_cause: v.root_cause,
        target_description: v.target_description,
        target_value: v.target_value != null && v.target_value !== '' ? Number(v.target_value) : null,
        target_unit: v.target_unit,
        measures: v.measures,
        leader_id: v.leader_id ?? null,
        participants: Array.isArray(v.participants) ? v.participants : [],
        review_date: v.review_date ? dayjs(v.review_date).format('YYYY-MM-DD') : null,
        implementation_notes: v.implementation_notes,
        implementation_date: v.implementation_date
          ? dayjs(v.implementation_date).format('YYYY-MM-DD')
          : null,
        outcome: v.outcome,
        effect_description: v.effect_description,
        actual_value: v.actual_value != null && v.actual_value !== '' ? Number(v.actual_value) : null,
        is_goal_achieved: v.is_goal_achieved ?? null,
        summary: v.summary,
        actual_end_date: v.actual_end_date
          ? dayjs(v.actual_end_date).format('YYYY-MM-DD')
          : undefined,
        director_sign_id: v.director_sign_id ?? null,
        director_sign_date: v.director_sign_date
          ? dayjs(v.director_sign_date).format('YYYY-MM-DD')
          : null,
        notes: v.notes,
      });
      message.success('已保存');
      setShowEditModal(false);
      setSelected(null);
      loadList();
    } catch {
      /* */
    } finally {
      setSaving(false);
    }
  };

  const handleDefectSubmit = async () => {
    const v = await defectForm.validateFields();
    setSaving(true);
    try {
      await cqiApi.createDefect({
        event_time: dayjs(v.event_time).toISOString(),
        event_type: v.event_type,
        severity: v.severity || 'minor',
        description: v.description,
        immediate_action: v.immediate_action,
        anonymous: v.anonymous,
      });
      message.success('缺陷已上报');
      setDefectModal(false);
      defectForm.resetFields();
      loadDefects();
    } catch {
      /* */
    } finally {
      setSaving(false);
    }
  };

  const ongoingCount = list.filter((p) => p.status === 'ongoing').length;
  const completedCount = list.filter((p) => p.status === 'completed').length;
  const planningCount = list.filter((p) => p.status === 'planning').length;

  const defectColumns: ColumnsType<DefectReport> = [
    {
      title: '事件时间',
      dataIndex: 'event_time',
      width: 170,
      render: (t: string) => dayjs(t).format('YYYY-MM-DD HH:mm'),
    },
    { title: '类型', dataIndex: 'event_type', width: 120 },
    {
      title: '严重程度',
      dataIndex: 'severity',
      width: 90,
      render: (s: string) => (
        <Tag color={s === 'serious' ? 'red' : s === 'moderate' ? 'orange' : 'default'}>{s}</Tag>
      ),
    },
    {
      title: '描述',
      dataIndex: 'description',
      ellipsis: true,
    },
    { title: '上报人', dataIndex: 'reported_by_name', width: 100 },
  ];

  const detailCollapseItems = selected
    ? [
        {
          key: 'p',
          label: 'P 计划：问题与目标',
          children: (
            <div style={{ fontSize: 13, color: '#3D5280', lineHeight: 1.75 }}>
              <p>
                <strong>问题：</strong>
                {selected.problem_found}
              </p>
              {selected.root_cause ? (
                <p>
                  <strong>原因分析：</strong>
                  {selected.root_cause}
                </p>
              ) : null}
              <p>
                <strong>预期目标：</strong>
                {selected.target_description || '—'}
                {selected.target_value != null && (
                  <span>
                    {' '}
                    （目标值 {String(selected.target_value)}
                    {selected.target_unit ? ` ${selected.target_unit}` : ''}）
                  </span>
                )}
              </p>
              <p>
                <strong>改进措施：</strong>
                <span style={{ whiteSpace: 'pre-line' }}>{selected.measures}</span>
              </p>
              <p>
                <strong>质控小组负责人：</strong>
                {selected.leader_name || '—'}
              </p>
              <p>
                <strong>参与人员：</strong>
                {selected.participant_users?.length
                  ? selected.participant_users.map((u) => u.real_name).join('、')
                  : '—'}
              </p>
              {selected.review_date ? (
                <p>
                  <strong>计划复盘日：</strong>
                  {selected.review_date}
                </p>
              ) : null}
            </div>
          ),
        },
        {
          key: 'd',
          label: 'D 实施',
          children: (
            <div style={{ fontSize: 13, color: '#3D5280', lineHeight: 1.75 }}>
              <p>
                <strong>实施记录：</strong>
                {selected.implementation_notes || '—'}
              </p>
              {selected.implementation_date ? (
                <p>
                  <strong>实施节点日期：</strong>
                  {selected.implementation_date}
                </p>
              ) : null}
            </div>
          ),
        },
        {
          key: 'c',
          label: 'C 评估',
          children: (
            <div style={{ fontSize: 13, color: '#3D5280', lineHeight: 1.75 }}>
              <p>
                <strong>结果评价：</strong>
                {selected.outcome || '—'}
              </p>
              <p>
                <strong>改进效果：</strong>
                {selected.effect_description || '—'}
              </p>
              <p>
                <strong>实际值：</strong>
                {selected.actual_value != null ? String(selected.actual_value) : '—'}
              </p>
              <p>
                <strong>是否达标：</strong>
                {selected.is_goal_achieved === true
                  ? '是'
                  : selected.is_goal_achieved === false
                    ? '否'
                    : '—'}
              </p>
            </div>
          ),
        },
        {
          key: 'a',
          label: 'A 处理与确认',
          children: (
            <div style={{ fontSize: 13, color: '#3D5280', lineHeight: 1.75 }}>
              <p>
                <strong>标准化总结：</strong>
                {selected.summary || '—'}
              </p>
              <p>
                <strong>科主任签名：</strong>
                {selected.director_sign_name || '—'}{' '}
                {selected.director_sign_date ? `（${selected.director_sign_date}）` : ''}
              </p>
              {selected.actual_end_date ? (
                <p>
                  <strong>实际结束日期：</strong>
                  {selected.actual_end_date}
                </p>
              ) : null}
              {selected.notes ? (
                <p>
                  <strong>备注：</strong>
                  {selected.notes}
                </p>
              ) : null}
            </div>
          ),
        },
      ]
    : [];

  return (
    <PageShell fullWidth>
      <Tabs
        activeKey={tab}
        onChange={(k) => setTab(k as 'cqi' | 'defects')}
        items={[
          { key: 'cqi', label: 'CQI 改进项目' },
          { key: 'defects', label: <span><BugOutlined /> 缺陷 / 不良事件</span> },
        ]}
        style={{ marginBottom: 16 }}
      />

      {tab === 'cqi' && (
        <>
          <div className="grid-4" style={{ marginBottom: 20 }}>
            <div className="hd-stat-card teal">
              <div className="hd-stat-icon">🔄</div>
              <div className="hd-stat-label">改进项目总数</div>
              <div className="hd-stat-value num">{total}</div>
              <div className="hd-stat-meta">当前列表</div>
            </div>
            <div className="hd-stat-card blue">
              <div className="hd-stat-icon">⚡</div>
              <div className="hd-stat-label">进行中</div>
              <div className="hd-stat-value num" style={{ color: '#0369A1' }}>
                {ongoingCount}
              </div>
              <div className="hd-stat-meta">本页统计</div>
            </div>
            <div className="hd-stat-card teal">
              <div className="hd-stat-icon">✅</div>
              <div className="hd-stat-label">已完成</div>
              <div className="hd-stat-value num" style={{ color: '#059669' }}>
                {completedCount}
              </div>
              <div className="hd-stat-meta">本页统计</div>
            </div>
            <div className="hd-stat-card blue">
              <div className="hd-stat-icon">📋</div>
              <div className="hd-stat-label">计划中</div>
              <div className="hd-stat-value num" style={{ color: '#7C3AED' }}>
                {planningCount}
              </div>
              <div className="hd-stat-meta">本页统计</div>
            </div>
          </div>

          <div className="flex gap-8 items-center" style={{ marginBottom: 16 }}>
            <Select
              placeholder="全部状态"
              value={statusFilter || undefined}
              onChange={(v) => {
                setStatusFilter(v || '');
                setPage(1);
              }}
              style={{ width: 130 }}
              allowClear
              options={Object.entries(STATUS_CFG).map(([k, v]) => ({ value: k, label: v.label }))}
            />
            <div style={{ marginLeft: 'auto' }}>
              {canEditCqi && (
                <Button type="primary" icon={<PlusOutlined />} onClick={() => setShowNewModal(true)}>
                  新建改进计划
                </Button>
              )}
            </div>
          </div>

          <Spin spinning={loading}>
            {list.length === 0 && !loading ? (
              <Empty description="暂无 CQI 记录" />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {list.map((plan) => {
                  const s = STATUS_CFG[plan.status] ?? STATUS_CFG.ongoing;
                  const progressGuess =
                    plan.status === 'completed'
                      ? 100
                      : plan.status === 'planning'
                        ? 0
                        : plan.status === 'overdue'
                          ? 30
                          : 50;
                  return (
                    <Card
                      key={plan.id}
                      style={{ border: '1px solid #DBEAFE', cursor: 'pointer', transition: 'box-shadow 0.2s' }}
                      styles={{ body: { padding: '16px 20px' } }}
                      onClick={() => openDetail(plan)}
                      hoverable
                    >
                      <div className="flex items-start gap-16">
                        <div style={{ flex: 1 }}>
                          <div className="flex items-center gap-8" style={{ marginBottom: 8 }}>
                            <span style={{ fontWeight: 600, fontSize: 15, color: '#0D1B3E' }}>
                              {plan.title}
                            </span>
                            <span
                              style={{
                                background: s.bg,
                                color: s.color,
                                padding: '2px 9px',
                                borderRadius: 20,
                                fontSize: 12,
                                fontWeight: 500,
                              }}
                            >
                              {s.label}
                            </span>
                            <span
                              style={{
                                background: '#EEF2FF',
                                color: '#4338CA',
                                padding: '2px 8px',
                                borderRadius: 20,
                                fontSize: 12,
                              }}
                            >
                              {plan.project_type}
                            </span>
                          </div>
                          <div style={{ fontSize: 13, color: '#3D5280', marginBottom: 8 }}>
                            <strong>问题：</strong>
                            {plan.problem_found}
                          </div>
                          <div style={{ fontSize: 13, color: '#3D5280', marginBottom: 12 }}>
                            <strong>目标：</strong>
                            {plan.target_description || '—'}
                          </div>
                          <div className="flex items-center gap-16">
                            <span style={{ fontSize: 12, color: '#7B92BC' }}>
                              创建：{plan.created_by_name || '—'}
                            </span>
                            <span style={{ fontSize: 12, color: '#7B92BC' }}>
                              开始：{plan.start_date}
                            </span>
                          </div>
                        </div>
                        <div style={{ width: 120, textAlign: 'center', flexShrink: 0 }}>
                          <div style={{ fontSize: 12, color: '#7B92BC', marginBottom: 6 }}>参考进度</div>
                          <Progress
                            type="circle"
                            percent={progressGuess}
                            size={80}
                            strokeColor={s.color}
                            format={(p) => (
                              <span style={{ fontSize: 14, fontWeight: 700, color: s.color }}>{p}%</span>
                            )}
                          />
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </Spin>

          {total > pageSize && (
            <div style={{ marginTop: 16, textAlign: 'right' }}>
              <Button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                上一页
              </Button>
              <span style={{ margin: '0 12px' }}>
                {page} / {Math.ceil(total / pageSize) || 1}
              </span>
              <Button disabled={page * pageSize >= total} onClick={() => setPage((p) => p + 1)}>
                下一页
              </Button>
            </div>
          )}
        </>
      )}

      {tab === 'defects' && (
        <Card>
          <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'flex-end' }}>
            {canReportDefect && (
              <Button type="primary" onClick={() => setDefectModal(true)}>
                上报缺陷 / 不良事件
              </Button>
            )}
          </div>
          <Spin spinning={defectLoading}>
            <Table rowKey="id" columns={defectColumns} dataSource={defects} pagination={false} />
          </Spin>
        </Card>
      )}

      <Modal
        title={selected?.title}
        open={!!selected}
        onCancel={() => setSelected(null)}
        footer={[
          <Button key="close" onClick={() => setSelected(null)}>
            关闭
          </Button>,
          ...(canEditCqi
            ? [
                <Button key="edit" type="primary" onClick={openEdit}>
                  编辑（PDCA）
                </Button>,
              ]
            : []),
        ]}
        width={760}
      >
        <Spin spinning={detailLoading}>
          {selected && (
            <div>
              <div style={{ marginBottom: 12, fontSize: 12, color: '#64748B' }}>
                状态：<Tag>{STATUS_CFG[selected.status]?.label ?? selected.status}</Tag>
                <span style={{ marginLeft: 12 }}>创建人：{selected.created_by_name || '—'}</span>
              </div>
              <Collapse items={detailCollapseItems} defaultActiveKey={['p', 'd', 'c', 'a']} />
            </div>
          )}
        </Spin>
      </Modal>

      <Modal
        title="编辑 CQI（PDCA）"
        open={showEditModal}
        onOk={handleUpdate}
        onCancel={() => setShowEditModal(false)}
        confirmLoading={saving}
        okText="保存"
        width={640}
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
      >
        <Form form={editForm} layout="vertical" size="middle">
          <Divider titlePlacement="left">P 计划</Divider>
          <Form.Item name="problem_found" label="发现的问题" rules={[{ required: true }]}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="root_cause" label="原因分析">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="target_description" label="预期目标（文字）">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item label="目标值 / 单位">
            <div className="flex gap-8">
              <Form.Item name="target_value" noStyle>
                <Input type="number" placeholder="数值" style={{ width: 140 }} />
              </Form.Item>
              <Form.Item name="target_unit" noStyle>
                <Input placeholder="单位，如 %" style={{ width: 120 }} />
              </Form.Item>
            </div>
          </Form.Item>
          <Form.Item name="measures" label="改进措施" rules={[{ required: true }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="leader_id" label="质控小组负责人">
            <Select allowClear options={userSelectOptions} placeholder="默认当前创建人" showSearch optionFilterProp="label" />
          </Form.Item>
          <Form.Item name="participants" label="参与人员">
            <Select mode="multiple" options={userSelectOptions} placeholder="多选" showSearch optionFilterProp="label" />
          </Form.Item>
          <Form.Item name="review_date" label="计划复盘日">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>

          <Divider titlePlacement="left">D 实施</Divider>
          <Form.Item name="implementation_notes" label="实施记录">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="implementation_date" label="实施节点日期">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>

          <Divider titlePlacement="left">C 评估</Divider>
          <Form.Item name="outcome" label="结果评价">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="effect_description" label="改进效果说明">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="actual_value" label="实际值">
            <Input type="number" />
          </Form.Item>
          <Form.Item name="is_goal_achieved" label="是否达标" valuePropName="checked">
            <Checkbox />
          </Form.Item>

          <Divider titlePlacement="left">A 处理</Divider>
          <Form.Item name="summary" label="标准化总结">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="status" label="状态" rules={[{ required: true }]}>
            <Select options={Object.entries(STATUS_CFG).map(([k, v]) => ({ value: k, label: v.label }))} />
          </Form.Item>
          <Form.Item name="actual_end_date" label="实际结束日期">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="director_sign_id" label="科主任签名（选用户）">
            <Select allowClear options={userSelectOptions} showSearch optionFilterProp="label" />
          </Form.Item>
          <Form.Item name="director_sign_date" label="科主任签名日期">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="新建 CQI 改进计划"
        open={showNewModal}
        onOk={handleCreate}
        onCancel={() => {
          setShowNewModal(false);
          form.resetFields();
        }}
        confirmLoading={saving}
        okText="创建计划"
        cancelText="取消"
        width={640}
      >
        <Form form={form} layout="vertical" size="middle" style={{ marginTop: 16 }}>
          <Form.Item label="计划标题" name="title" rules={[{ required: true }]}>
            <Input placeholder="如：提升 Kt/V 达标率" />
          </Form.Item>
          <Form.Item label="改进项目" name="category" rules={[{ required: true }]}>
            <Select options={CATEGORIES.map((c) => ({ value: c, label: c }))} />
          </Form.Item>
          <Form.Item label="开始日期" name="startDate" rules={[{ required: true }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="初始状态" name="initialStatus" initialValue="ongoing">
            <Select options={Object.entries(STATUS_CFG).map(([k, v]) => ({ value: k, label: v.label }))} />
          </Form.Item>
          <Form.Item label="质控小组负责人" name="leader_id">
            <Select allowClear options={userSelectOptions} showSearch optionFilterProp="label" />
          </Form.Item>
          <Form.Item label="参与人员" name="participants">
            <Select mode="multiple" options={userSelectOptions} showSearch optionFilterProp="label" />
          </Form.Item>
          <Form.Item label="发现的问题" name="problem_found" rules={[{ required: true }]}>
            <Input.TextArea rows={2} placeholder="描述质量问题" />
          </Form.Item>
          <Form.Item label="原因分析" name="root_cause">
            <Input.TextArea rows={2} placeholder="鱼骨图 / 5-Why 等简要记录" />
          </Form.Item>
          <Form.Item label="预期目标" name="goal">
            <Input.TextArea rows={2} placeholder="可量化目标（文字）" />
          </Form.Item>
          <Form.Item label="目标值 / 单位">
            <div className="flex gap-8">
              <Form.Item name="target_value" noStyle>
                <Input type="number" placeholder="数值" style={{ width: 140 }} />
              </Form.Item>
              <Form.Item name="target_unit" noStyle>
                <Input placeholder="单位" style={{ width: 120 }} />
              </Form.Item>
            </div>
          </Form.Item>
          <Form.Item label="计划复盘日" name="review_date">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="改进措施" name="measures" rules={[{ required: true }]}>
            <Input.TextArea rows={4} placeholder="具体改进措施与分工" />
          </Form.Item>
          <Form.Item label="备注" name="leaderNote">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="上报缺陷 / 不良事件"
        open={defectModal}
        onOk={handleDefectSubmit}
        onCancel={() => {
          setDefectModal(false);
          defectForm.resetFields();
        }}
        confirmLoading={saving}
        width={520}
      >
        <Form form={defectForm} layout="vertical">
          <Form.Item name="event_time" label="事件时间" rules={[{ required: true }]}>
            <DatePicker showTime style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="event_type" label="事件类型" rules={[{ required: true }]}>
            <Select options={DEFECT_TYPES} />
          </Form.Item>
          <Form.Item name="severity" label="严重程度" initialValue="minor">
            <Select
              options={[
                { value: 'minor', label: '轻微' },
                { value: 'moderate', label: '中等' },
                { value: 'serious', label: '严重' },
              ]}
            />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} placeholder="事件经过（可填「待补充」）" />
          </Form.Item>
          <Form.Item name="immediate_action" label="即时处理">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="anonymous" valuePropName="checked" initialValue={false}>
            <Checkbox>匿名上报（后台仍记录操作账号）</Checkbox>
          </Form.Item>
        </Form>
      </Modal>
    </PageShell>
  );
}
