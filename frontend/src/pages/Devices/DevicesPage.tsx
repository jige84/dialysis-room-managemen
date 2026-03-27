import { useState } from 'react';
import { Card, Table, Button, Select, Input, Modal, Form, InputNumber, Tabs, message } from 'antd';
import { SearchOutlined, PlusOutlined, ToolOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import PageShell from '../../components/PageShell/PageShell';

const MACHINES = [
  { key: '1',  no: '1号机',    brand: 'B.Braun',  model: 'Dialog+',  zone: 'normal', status: 'running',    lastMaint: '2026-02-15', nextMaint: '2026-05-15', sessions: 1248, compliant: true },
  { key: '2',  no: '2号机',    brand: 'B.Braun',  model: 'Dialog+',  zone: 'normal', status: 'running',    lastMaint: '2026-02-15', nextMaint: '2026-05-15', sessions: 1312, compliant: true },
  { key: '3',  no: '3号机',    brand: 'B.Braun',  model: 'Dialog+',  zone: 'normal', status: 'running',    lastMaint: '2026-02-10', nextMaint: '2026-05-10', sessions: 967,  compliant: true },
  { key: '4',  no: '4号机',    brand: 'B.Braun',  model: 'Dialog+',  zone: 'normal', status: 'running',    lastMaint: '2026-01-20', nextMaint: '2026-04-20', sessions: 1105, compliant: false },
  { key: '5',  no: '5号机',    brand: 'B.Braun',  model: 'Dialog+',  zone: 'normal', status: 'running',    lastMaint: '2026-02-28', nextMaint: '2026-05-28', sessions: 1440, compliant: true },
  { key: '6',  no: '6号机',    brand: 'Gambro',   model: 'AK98',     zone: 'normal', status: 'running',    lastMaint: '2026-02-20', nextMaint: '2026-05-20', sessions: 892,  compliant: true },
  { key: '7',  no: '7号机',    brand: 'Gambro',   model: 'AK98',     zone: 'normal', status: 'maintenance', lastMaint: '2026-03-18', nextMaint: '2026-06-18', sessions: 1067, compliant: true },
  { key: '8',  no: 'HBV-01',  brand: 'Fresenius', model: '4008S',   zone: 'hbv',    status: 'running',    lastMaint: '2026-02-25', nextMaint: '2026-05-25', sessions: 678,  compliant: true },
  { key: '9',  no: 'HCV-01',  brand: 'Fresenius', model: '4008S',   zone: 'hcv',    status: 'running',    lastMaint: '2026-02-25', nextMaint: '2026-05-25', sessions: 534,  compliant: true },
];

const CONSUMABLES = [
  { key: '1', name: '透析器 FX80（高通量）',  unit: '个', stock: 152, minStock: 50, totalUsedMonth: 189, status: 'sufficient' },
  { key: '2', name: '透析器 FX60（低通量）',  unit: '个', stock: 78,  minStock: 50, totalUsedMonth: 82,  status: 'sufficient' },
  { key: '3', name: '血液管路（成人型）',      unit: '套', stock: 45,  minStock: 50, totalUsedMonth: 210, status: 'warning' },
  { key: '4', name: '穿刺针 16G',            unit: '盒', stock: 32,  minStock: 50, totalUsedMonth: 165, status: 'low' },
  { key: '5', name: '碳酸氢盐透析液（A液）',  unit: '桶', stock: 28,  minStock: 20, totalUsedMonth: 95,  status: 'sufficient' },
  { key: '6', name: '碳酸氢盐透析液（B液）',  unit: '桶', stock: 28,  minStock: 20, totalUsedMonth: 95,  status: 'sufficient' },
  { key: '7', name: '消毒液（次氯酸）',       unit: '瓶', stock: 18,  minStock: 20, totalUsedMonth: 45,  status: 'warning' },
  { key: '8', name: '生理盐水 500mL',        unit: '袋', stock: 230, minStock: 100, totalUsedMonth: 580, status: 'sufficient' },
];

const MACHINE_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  running:     { label: '正常运行', color: '#059669', bg: '#ECFDF5' },
  maintenance: { label: '维护中',   color: '#D97706', bg: '#FFFBEB' },
  fault:       { label: '故障',    color: '#BE123C', bg: '#FFF1F2' },
  idle:        { label: '空闲',    color: '#7B92BC', bg: '#F1F5F9' },
};

const ZONE_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  normal: { label: '普通区', color: '#0369A1', bg: '#E0F2FE' },
  hbv:    { label: '乙肝区', color: '#92400E', bg: '#FFFBEB' },
  hcv:    { label: '丙肝区', color: '#9F1239', bg: '#FFF1F2' },
};

const STOCK_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  sufficient: { label: '充足', color: '#059669', bg: '#ECFDF5' },
  warning:    { label: '偏低', color: '#D97706', bg: '#FFFBEB' },
  low:        { label: '不足', color: '#BE123C', bg: '#FFF1F2' },
};

export default function DevicesPage() {
  const [search, setSearch] = useState('');
  const [zoneFilter, setZoneFilter] = useState('');
  const [showOutboundModal, setShowOutboundModal] = useState(false);
  const [showMaintModal, setShowMaintModal] = useState(false);
  const [outboundForm] = Form.useForm();
  const [maintForm] = Form.useForm();

  const filteredMachines = MACHINES.filter(m => {
    if (search && !m.no.includes(search) && !m.model.includes(search)) return false;
    if (zoneFilter && m.zone !== zoneFilter) return false;
    return true;
  });

  const maintenanceDue = MACHINES.filter(m => dayjs(m.nextMaint).diff(dayjs(), 'day') <= 30);
  const lowStockItems  = CONSUMABLES.filter(c => c.status !== 'sufficient');

  const machineColumns = [
    { title: '机器编号', dataIndex: 'no', render: (v: string) => <span style={{ fontWeight: 600 }}>{v}</span> },
    { title: '品牌/型号', render: (_: unknown, r: typeof MACHINES[0]) => <span>{r.brand} {r.model}</span> },
    {
      title: '分区',
      render: (_: unknown, r: typeof MACHINES[0]) => {
        const z = ZONE_STYLE[r.zone];
        return <span style={{ background: z.bg, color: z.color, padding: '2px 8px', borderRadius: 20, fontSize: 12 }}>{z.label}</span>;
      },
    },
    {
      title: '运行状态',
      render: (_: unknown, r: typeof MACHINES[0]) => {
        const s = MACHINE_STATUS[r.status];
        return <span style={{ background: s.bg, color: s.color, padding: '3px 9px', borderRadius: 20, fontSize: 12, fontWeight: 500 }}>{s.label}</span>;
      },
    },
    { title: '累计透析次数', dataIndex: 'sessions', render: (v: number) => <span className="num">{v.toLocaleString()}</span> },
    { title: '上次维护', dataIndex: 'lastMaint', render: (v: string) => <span className="num text-sm">{v}</span> },
    {
      title: '下次维护',
      render: (_: unknown, r: typeof MACHINES[0]) => {
        const days = dayjs(r.nextMaint).diff(dayjs(), 'day');
        return (
          <span className="num text-sm" style={{ color: days <= 30 ? '#D97706' : '#059669', fontWeight: days <= 30 ? 600 : 400 }}>
            {r.nextMaint}{days <= 30 && ` (${days}天后)`}
          </span>
        );
      },
    },
    {
      title: '合规',
      render: (_: unknown, r: typeof MACHINES[0]) => (
        <span style={{ color: r.compliant ? '#059669' : '#BE123C' }}>{r.compliant ? '✅' : '⚠️ 到期'}</span>
      ),
    },
    {
      title: '操作',
      render: () => (
        <Button size="small" icon={<ToolOutlined />} onClick={() => setShowMaintModal(true)}>记录维护</Button>
      ),
    },
  ];

  const consumableColumns = [
    { title: '耗材名称', dataIndex: 'name', render: (v: string) => <span style={{ fontWeight: 500 }}>{v}</span> },
    { title: '单位', dataIndex: 'unit' },
    {
      title: '当前库存',
      render: (_: unknown, r: typeof CONSUMABLES[0]) => (
        <span className="num" style={{ fontWeight: 700, color: r.status === 'low' ? '#BE123C' : r.status === 'warning' ? '#D97706' : '#059669' }}>
          {r.stock}
        </span>
      ),
    },
    { title: '最低库存预警线', dataIndex: 'minStock', render: (v: number) => <span className="num text-muted">{v}</span> },
    { title: '本月出库', dataIndex: 'totalUsedMonth', render: (v: number) => <span className="num">{v}</span> },
    {
      title: '状态',
      render: (_: unknown, r: typeof CONSUMABLES[0]) => {
        const s = STOCK_STATUS[r.status];
        return <span style={{ background: s.bg, color: s.color, padding: '3px 9px', borderRadius: 20, fontSize: 12, fontWeight: 500 }}>{s.label}</span>;
      },
    },
    {
      title: '操作',
      render: () => (
        <Button size="small" type="primary" onClick={() => setShowOutboundModal(true)}>出库记录</Button>
      ),
    },
  ];

  return (
    <PageShell fullWidth>
      {/* 概览 */}
      <div className="grid-4" style={{ marginBottom: 20 }}>
        <div className="hd-stat-card teal">
          <div className="hd-stat-icon">⚙️</div>
          <div className="hd-stat-label">透析机总数</div>
          <div className="hd-stat-value num">{MACHINES.length}</div>
          <div className="hd-stat-meta">普通区7台 · 隔离区2台</div>
        </div>
        <div className="hd-stat-card blue">
          <div className="hd-stat-icon">✅</div>
          <div className="hd-stat-label">正常运行</div>
          <div className="hd-stat-value num">{MACHINES.filter(m => m.status === 'running').length}</div>
          <div className="hd-stat-meta">今日可用</div>
        </div>
        <div className="hd-stat-card amber">
          <div className="hd-stat-icon">🔧</div>
          <div className="hd-stat-label">30天内到期维护</div>
          <div className="hd-stat-value num" style={{ color: maintenanceDue.length > 0 ? '#D97706' : '#059669' }}>{maintenanceDue.length}</div>
          <div className="hd-stat-meta">需安排维护</div>
        </div>
        <div className="hd-stat-card red">
          <div className="hd-stat-icon">📦</div>
          <div className="hd-stat-label">耗材库存预警</div>
          <div className="hd-stat-value num" style={{ color: lowStockItems.length > 0 ? '#BE123C' : '#059669' }}>{lowStockItems.length}</div>
          <div className="hd-stat-meta">项低于安全线</div>
        </div>
      </div>

      <Tabs defaultActiveKey="machines" items={[
        {
          key: 'machines',
          label: '⚙️ 透析机管理',
          children: (
            <div>
              <div className="flex gap-8 items-center" style={{ marginBottom: 16 }}>
                <Input
                  prefix={<SearchOutlined style={{ color: '#7B92BC' }} />}
                  placeholder="搜索机器编号/型号…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  style={{ width: 220, borderColor: '#DBEAFE' }}
                  allowClear
                />
                <Select placeholder="全部分区" value={zoneFilter || undefined} onChange={v => setZoneFilter(v || '')} style={{ width: 130 }} allowClear
                  options={[{ value: 'normal', label: '普通区' }, { value: 'hbv', label: '乙肝区' }, { value: 'hcv', label: '丙肝区' }]}
                />
                <div style={{ marginLeft: 'auto' }}>
                  <Button type="primary" icon={<PlusOutlined />}>登记新机器</Button>
                </div>
              </div>
              <Card style={{ border: '1px solid #DBEAFE' }} styles={{ body: { padding: 0 } }}>
                <Table dataSource={filteredMachines} columns={machineColumns} size="small"
                  pagination={{ pageSize: 10, showTotal: t => `共 ${t} 台` }} />
              </Card>
            </div>
          ),
        },
        {
          key: 'consumables',
          label: '📦 耗材管理',
          children: (
            <div>
              {lowStockItems.length > 0 && (
                <div className="hd-alert-item danger" style={{ marginBottom: 16 }}>
                  <span className="hd-alert-icon">📦</span>
                  <div className="hd-alert-content">
                    <div className="hd-alert-title">{lowStockItems.length} 项耗材库存不足，需及时补货</div>
                    <div className="hd-alert-desc">{lowStockItems.map(i => i.name).join('、')}</div>
                  </div>
                </div>
              )}
              <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-end' }}>
                <Button type="primary" icon={<PlusOutlined />} onClick={() => setShowOutboundModal(true)}>出库记录</Button>
              </div>
              <Card style={{ border: '1px solid #DBEAFE' }} styles={{ body: { padding: 0 } }}>
                <Table dataSource={CONSUMABLES} columns={consumableColumns} size="small" pagination={false} />
              </Card>
            </div>
          ),
        },
      ]} />

      {/* 出库记录弹窗 */}
      <Modal
        title="耗材出库记录"
        open={showOutboundModal}
        onOk={() => outboundForm.validateFields().then(() => { setShowOutboundModal(false); outboundForm.resetFields(); message.success('出库记录已保存'); })}
        onCancel={() => { setShowOutboundModal(false); outboundForm.resetFields(); }}
        okText="确认出库"
        cancelText="取消"
        width={480}
      >
        <Form form={outboundForm} layout="vertical" size="middle" style={{ marginTop: 16 }}>
          <Form.Item label="耗材名称" name="item" rules={[{ required: true }]}>
            <Select options={CONSUMABLES.map(c => ({ value: c.key, label: c.name }))} />
          </Form.Item>
          <div className="grid-2" style={{ gap: 16 }}>
            <Form.Item label="出库数量" name="quantity" rules={[{ required: true }]}>
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="领用护士" name="nurse" rules={[{ required: true }]}>
              <Select options={['杨晨','陈燕','李梅','王芳','张颖','刘娜','赵丽'].map(n => ({ value: n, label: n }))} />
            </Form.Item>
          </div>
          <Form.Item label="用途备注" name="notes">
            <Input.TextArea rows={2} placeholder="如：下午班患者透析使用" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 维护记录弹窗 */}
      <Modal
        title="记录设备维护"
        open={showMaintModal}
        onOk={() => maintForm.validateFields().then(() => { setShowMaintModal(false); maintForm.resetFields(); message.success('维护记录已保存'); })}
        onCancel={() => { setShowMaintModal(false); maintForm.resetFields(); }}
        okText="保存维护记录"
        cancelText="取消"
        width={480}
      >
        <Form form={maintForm} layout="vertical" size="middle" style={{ marginTop: 16 }}>
          <div className="grid-2" style={{ gap: 16 }}>
            <Form.Item label="维护类型" name="type" rules={[{ required: true }]}>
              <Select options={[{ value: 'preventive', label: '预防性维护' }, { value: 'corrective', label: '故障修复' }, { value: 'calibration', label: '校准' }]} />
            </Form.Item>
            <Form.Item label="维护工程师" name="engineer" rules={[{ required: true }]}>
              <Input placeholder="维护人员姓名" />
            </Form.Item>
          </div>
          <Form.Item label="维护描述" name="description" rules={[{ required: true }]}>
            <Input.TextArea rows={3} placeholder="描述维护内容、更换部件等…" />
          </Form.Item>
        </Form>
      </Modal>
    </PageShell>
  );
}
