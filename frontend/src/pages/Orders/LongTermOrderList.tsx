/**
 * 长期医嘱单列表与管理页
 * 以患者为维度展示有效/已停止医嘱，支持开立/停止操作，对接 ordersApi。
 */
import { useState, useEffect, useCallback } from 'react';
import { Card, Select, Button, Table, Tag, Modal, Form, Input, Space, message, Divider, List, Typography, Spin } from 'antd';
import { PlusOutlined, StopOutlined, ReloadOutlined } from '@ant-design/icons';
import PageShell from '../../components/PageShell/PageShell';
import { patientsApi, type Patient } from '../../api/patients';
import ordersApi, { type LongTermOrder, FREQ_LABELS, ORDER_TYPE_LABELS } from '../../api/orders';
import { usePermission } from '../../utils/permission';

interface NewOrderDraft {
  key: string;
  drug: string;
  dose: string;
  route: string;
  freq: string;
  notes?: string;
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

  const patientInfo = patientOptions.find(p => p.value === selectedPatient);

  // 表格列定义
  const activeColumns = [
    { title: '类型', dataIndex: 'order_type', width: 80,
      render: (v: string) => <Tag>{ORDER_TYPE_LABELS[v] || v}</Tag> },
    { title: '药品/项目', dataIndex: 'drug_name',
      render: (v: string) => <span style={{ fontWeight: 600, color: '#0D1B3E' }}>{v}</span> },
    { title: '剂量', key: 'dose',
      render: (_: unknown, r: LongTermOrder) => <span className="num">{r.dose ?? ''} {r.dose_unit ?? ''}</span> },
    { title: '用法', dataIndex: 'route' },
    { title: '频次', dataIndex: 'frequency',
      render: (v: string) => <Tag color="blue" style={{ fontSize: 11 }}>{FREQ_LABELS[v] || v}</Tag> },
    { title: '开具医生', dataIndex: 'ordered_by_name' },
    { title: '开具日期', dataIndex: 'valid_from',
      render: (v: string) => <span className="num text-sm">{v}</span> },
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
    { title: '药品/项目', dataIndex: 'drug_name',
      render: (v: string) => <span style={{ fontWeight: 600, color: '#9CA3AF', textDecoration: 'line-through' }}>{v}</span> },
    { title: '剂量', key: 'dose',
      render: (_: unknown, r: LongTermOrder) => <span className="num text-muted">{r.dose ?? ''} {r.dose_unit ?? ''}</span> },
    { title: '用法', dataIndex: 'route', render: (v: string) => <span className="text-muted">{v}</span> },
    { title: '频次', dataIndex: 'frequency',
      render: (v: string) => <Tag color="default" style={{ fontSize: 11 }}>{FREQ_LABELS[v] || v}</Tag> },
    { title: '停止日期', dataIndex: 'stopped_at',
      render: (v: string) => <span className="num text-sm text-muted">{v ? v.slice(0, 10) : ''}</span> },
    { title: '停止原因', dataIndex: 'stop_reason',
      render: (v: string) => <span className="text-sm text-muted">{v}</span> },
  ];

  // 添加到草稿
  const handleNewOrder = () => {
    newForm.validateFields().then(values => {
      const draft: NewOrderDraft = {
        key: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        drug: values.drug_name,
        dose: values.doseNumber && values.doseUnit ? `${values.doseNumber} ${values.doseUnit}` : (values.dose || ''),
        route: values.route,
        freq: values.frequency,
        notes: values.notes,
      };
      setDraftOrders(prev => [...prev, draft]);
      newForm.resetFields();
      message.success('已添加到待开具列表，可继续录入');
    });
  };

  // 批量提交
  const handleConfirmAllNewOrders = async () => {
    if (!selectedPatient) return;
    let finalOrders = [...draftOrders];

    const hasForm = newForm.getFieldValue('drug_name');
    if (hasForm) {
      try {
        const values = await newForm.validateFields();
        finalOrders.push({
          key: `${Date.now()}`,
          drug: values.drug_name,
          dose: values.doseNumber && values.doseUnit ? `${values.doseNumber} ${values.doseUnit}` : '',
          route: values.route,
          freq: values.frequency,
          notes: values.notes,
        });
      } catch { return; }
    }

    if (finalOrders.length === 0) {
      message.warning('请先录入至少一条长期医嘱');
      return;
    }

    setSubmitting(true);
    try {
      for (const draft of finalOrders) {
        const [doseVal, ...unitParts] = draft.dose.split(' ');
        await ordersApi.create(selectedPatient, {
          order_type: 'dialysis_drug',
          drug_name: draft.drug,
          dose: doseVal,
          dose_unit: unitParts.join(' ') || undefined,
          route: draft.route,
          frequency: draft.freq as LongTermOrder['frequency'],
          notes: draft.notes,
        });
      }
      setShowNewModal(false);
      newForm.resetFields();
      setDraftOrders([]);
      message.success(`长期医嘱已批量开具，共 ${finalOrders.length} 条`);
      loadOrders(selectedPatient);
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
          <Table rowKey="id" dataSource={activeOrders} columns={activeColumns} size="small"
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
              <Table rowKey="id" dataSource={stoppedOrders} columns={stoppedColumns} size="small"
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
        <Form form={newForm} layout="vertical" size="middle">
          <div className="grid-2" style={{ gap: 16 }}>
            <Form.Item label="医嘱类型" name="order_type" initialValue="dialysis_drug" rules={[{ required: true }]}>
              <Select options={ORDER_TYPE_OPTIONS} />
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
            <Form.Item label="用法" name="route" rules={[{ required: true }]}>
              <Select showSearch optionFilterProp="label" options={[
                { value: '口服', label: '口服' },
                { value: '口服 随餐', label: '口服 随餐' },
                { value: '口服 睡前', label: '口服 睡前' },
                { value: '皮下注射', label: '皮下注射' },
                { value: '肌内注射', label: '肌内注射' },
                { value: '静脉注射', label: '静脉注射' },
                { value: '静脉滴注', label: '静脉滴注' },
                { value: '透析中静脉泵入', label: '透析中静脉泵入' },
                { value: '透析前静脉推注', label: '透析前静脉推注' },
              ]} />
            </Form.Item>
          </div>
          <Form.Item label="执行频次" name="frequency" rules={[{ required: true }]}>
            <Select options={FREQ_OPTIONS} />
          </Form.Item>
          <Form.Item label="开具说明" name="notes">
            <Input.TextArea rows={2} placeholder="特殊说明或注意事项…" />
          </Form.Item>
        </Form>
        <div style={{ padding: '8px 0', fontSize: 12.5, color: '#7B92BC' }}>
          ⓘ 医嘱将在下次护士录入透析记录时自动显示。
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
                    <div style={{ fontWeight: 600, color: '#0D1B3E' }}>{item.drug}</div>
                    <div style={{ fontSize: 12.5, color: '#4B5563' }}>{item.dose} · {item.route} · {FREQ_LABELS[item.freq] || item.freq}</div>
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
