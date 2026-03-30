/**
 * 长期医嘱单列表与管理页
 * 主要作用：展示患者长期医嘱，支持医生开立/停嘱与护士查看执行依据。
 * 主要功能：按患者筛选 Table；新开/停止 Modal；对接 orders API。
 */
import { useState } from 'react';
import { Card, Select, Button, Table, Tag, Modal, Form, Input, Space, message, Divider } from 'antd';
import { PlusOutlined, StopOutlined } from '@ant-design/icons';
import PageShell from '../../components/PageShell/PageShell';

const PATIENTS = [
  { value: 'zhang', label: '张国华', info: '糖尿病肾病 · 透析龄4年7月 · 主管医生：任计阁' },
  { value: 'wang',  label: '王社香', info: '慢性肾小球肾炎 · 透析龄7年9月 · 主管医生：任计阁' },
  { value: 'liu',   label: '刘明远', info: '多囊肾 · 透析龄6年0月 · LTCC · 主管医生：任计阁' },
  { value: 'zhao',  label: '赵丽萍', info: '糖尿病肾病 · 透析龄5年3月 · 主管医生：任计阁' },
  { value: 'wjj',   label: '王建军', info: '高血压肾病 · 透析龄8年2月 · AVF · 主管医生：任计阁' },
];

const ORDERS_DATA: Record<string, { active: OrderItem[]; stopped: OrderItem[] }> = {
  zhang: {
    active: [
      { key: '1', drug: '重组人促红素注射液（EPO）', dose: '6000 IU', route: '皮下注射', freq: 'tiw（每透析日）', doctor: '任计阁', date: '2026-01-10' },
      { key: '2', drug: '碳酸钙片', dose: '0.6g', route: '口服 随餐', freq: 'tid（每日三次）', doctor: '任计阁', date: '2026-01-10' },
      { key: '3', drug: '蔗糖铁注射液', dose: '200mg', route: '静脉输注（透析中）', freq: 'qw（每周1次）', doctor: '任计阁', date: '2026-02-15' },
      { key: '4', drug: '阿法骨化醇胶囊', dose: '0.25μg', route: '口服 睡前', freq: 'qd（每日1次）', doctor: '任计阁', date: '2025-10-20' },
    ],
    stopped: [
      { key: 's1', drug: '低分子肝素钙注射液', dose: '4100 IU', route: '皮下注射', freq: 'tiw（每透析日）', doctor: '任计阁', date: '2025-08-01', stopDate: '2025-09-15', stopReason: '改为普通肝素' },
    ],
  },
};

interface OrderItem {
  key: string;
  drug: string;
  dose: string;
  route: string;
  freq: string;
  doctor: string;
  date: string;
  stopDate?: string;
  stopReason?: string;
}

const FREQ_OPTIONS = [
  { value: 'qd', label: 'qd（每日1次）' },
  { value: 'bid', label: 'bid（每日2次）' },
  { value: 'tid', label: 'tid（每日3次）' },
  { value: 'tiw', label: 'tiw（每透析日）' },
  { value: 'qw', label: 'qw（每周1次）' },
  { value: 'biw', label: 'biw（每周2次）' },
  { value: 'qm', label: 'qm（每月1次）' },
];

export default function LongTermOrderListPage() {
  const [selectedPatient, setSelectedPatient] = useState('zhang');
  const [showNewModal, setShowNewModal] = useState(false);
  const [showStopModal, setShowStopModal] = useState(false);
  const [stopTarget, setStopTarget] = useState<OrderItem | null>(null);
  const [filterMode, setFilterMode] = useState<'active' | 'all'>('active');
  const [showStopped, setShowStopped] = useState(false);
  const [newForm] = Form.useForm();
  const [stopForm] = Form.useForm();

  const orders = ORDERS_DATA[selectedPatient] || { active: [], stopped: [] };
  const patientInfo = PATIENTS.find(p => p.value === selectedPatient);

  const activeColumns = [
    { title: '药品名称', dataIndex: 'drug', render: (v: string) => <span style={{ fontWeight: 600, color: '#0D1B3E' }}>{v}</span> },
    { title: '剂量', dataIndex: 'dose', render: (v: string) => <span className="num">{v}</span> },
    { title: '用法', dataIndex: 'route' },
    {
      title: '执行频次', dataIndex: 'freq',
      render: (v: string) => (
        <Tag color={v.includes('qw') ? 'orange' : 'blue'} style={{ fontSize: 11 }}>{v}</Tag>
      ),
    },
    { title: '开具医生', dataIndex: 'doctor' },
    { title: '开具日期', dataIndex: 'date', render: (v: string) => <span className="num text-sm">{v}</span> },
    {
      title: '状态',
      render: () => <span style={{ background: '#ECFDF5', color: '#059669', padding: '2px 8px', borderRadius: 20, fontSize: 12, fontWeight: 500 }}>有效</span>,
    },
    {
      title: '操作',
      render: (_: unknown, r: OrderItem) => (
        <Space size={4}>
          <Button size="small">编辑</Button>
          <Button size="small" danger icon={<StopOutlined />} onClick={() => { setStopTarget(r); setShowStopModal(true); }}>
            停止
          </Button>
        </Space>
      ),
    },
  ];

  const stoppedColumns = [
    { title: '药品名称', dataIndex: 'drug', render: (v: string) => <span style={{ fontWeight: 600, color: '#9CA3AF', textDecoration: 'line-through' }}>{v}</span> },
    { title: '剂量', dataIndex: 'dose', render: (v: string) => <span className="num text-muted">{v}</span> },
    { title: '用法', dataIndex: 'route', render: (v: string) => <span className="text-muted">{v}</span> },
    { title: '频次', dataIndex: 'freq', render: (v: string) => <Tag color="default" style={{ fontSize: 11 }}>{v}</Tag> },
    { title: '停止日期', dataIndex: 'stopDate', render: (v: string) => <span className="num text-sm text-muted">{v}</span> },
    { title: '停止原因', dataIndex: 'stopReason', render: (v: string) => <span className="text-sm text-muted">{v}</span> },
    { title: '操作', render: () => <Button size="small" disabled style={{ opacity: 0.5 }}>恢复</Button> },
  ];

  const handleNewOrder = () => {
    newForm.validateFields().then(() => {
      setShowNewModal(false);
      newForm.resetFields();
      message.success('长期医嘱已开具，护士下次透析录入时将自动显示');
    });
  };

  const handleStop = () => {
    stopForm.validateFields().then(() => {
      setShowStopModal(false);
      stopForm.resetFields();
      setStopTarget(null);
      message.success('医嘱已停止，已记录审计日志');
    });
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
              onChange={v => setSelectedPatient(v)}
              options={PATIENTS.map(p => ({ value: p.value, label: p.label }))}
              style={{ width: 220 }}
              showSearch
            />
          </div>
          {patientInfo && (
            <div id="order-patient-info" className="flex items-center gap-8">
              <div className="hd-avatar hd-avatar-m">
                {patientInfo.label.charAt(0)}
              </div>
              <div>
                <div style={{ fontWeight: 700 }}>{patientInfo.label}</div>
                <div style={{ fontSize: 12, color: '#7B92BC' }}>{patientInfo.info}</div>
              </div>
            </div>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <Button
              size="small"
              type={filterMode === 'active' ? 'primary' : 'default'}
              onClick={() => setFilterMode('active')}
            >有效医嘱</Button>
            <Button
              size="small"
              type={filterMode === 'all' ? 'primary' : 'default'}
              onClick={() => { setFilterMode('all'); setShowStopped(true); }}
            >全部医嘱</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setShowNewModal(true)}>
              开具新医嘱
            </Button>
          </div>
        </div>
      </Card>

      {/* 有效医嘱列表 */}
      <Card style={{ marginBottom: 16, border: '1px solid #DBEAFE' }}
        styles={{ header: { background: '#FAFCFF', borderBottom: '1px solid #DBEAFE' } }}
        title={
          <span style={{ fontWeight: 600 }}>
            ✅ 有效医嘱
            <span style={{ color: '#7B92BC', fontSize: 12, marginLeft: 8 }}>({orders.active.length}条)</span>
          </span>
        }
      >
        <Table dataSource={orders.active} columns={activeColumns} size="small" pagination={false} rowKey="key" />
      </Card>

      {/* 已停止医嘱（可折叠） */}
      {(filterMode === 'all' || showStopped) && orders.stopped.length > 0 && (
        <Card style={{ border: '1px solid #DBEAFE', opacity: 0.85 }}
          styles={{ header: { background: '#F8FAFC', borderBottom: '1px solid #DBEAFE' } }}
          title={
            <div className="flex items-center gap-8">
              <span style={{ fontWeight: 600, color: '#9CA3AF' }}>
                ⛔ 已停止医嘱
                <span style={{ fontSize: 12, marginLeft: 8 }}>({orders.stopped.length}条)</span>
              </span>
              <Button
                size="small"
                type="text"
                style={{ color: '#7B92BC' }}
                onClick={() => setShowStopped(s => !s)}
              >
                {showStopped ? '▲ 折叠' : '▼ 展开'}
              </Button>
            </div>
          }
        >
          {showStopped && (
            <Table dataSource={orders.stopped} columns={stoppedColumns} size="small" pagination={false} rowKey="key" />
          )}
        </Card>
      )}

      {/* 开具新医嘱弹窗 */}
      <Modal
        title="开具长期医嘱"
        open={showNewModal}
        onOk={handleNewOrder}
        onCancel={() => { setShowNewModal(false); newForm.resetFields(); }}
        okText="确认开具"
        cancelText="取消"
        width={560}
      >
        <Divider style={{ margin: '12px 0', borderColor: '#DBEAFE' }} />
        <Form form={newForm} layout="vertical" size="middle">
          <Form.Item label="药品名称" name="drug" rules={[{ required: true, message: '请输入药品名称' }]}>
            <Input placeholder="如：重组人促红素注射液" />
          </Form.Item>
          <div className="grid-2" style={{ gap: 16 }}>
            <Form.Item label="剂量" name="dose" rules={[{ required: true }]}>
              <Input placeholder="如：6000 IU" />
            </Form.Item>
            <Form.Item label="用法" name="route" rules={[{ required: true }]}>
              <Input placeholder="如：皮下注射" />
            </Form.Item>
          </div>
          <Form.Item label="执行频次" name="freq" rules={[{ required: true }]}>
            <Select options={FREQ_OPTIONS} />
          </Form.Item>
          <Form.Item label="开具说明" name="notes">
            <Input.TextArea rows={2} placeholder="特殊说明或注意事项…" />
          </Form.Item>
        </Form>
        <div style={{ padding: '8px 0', fontSize: 12.5, color: '#7B92BC' }}>
          ⓘ 医嘱将在下次护士录入透析记录时自动显示
        </div>
      </Modal>

      {/* 停止医嘱确认弹窗 */}
      <Modal
        title="停止长期医嘱"
        open={showStopModal}
        onOk={handleStop}
        onCancel={() => { setShowStopModal(false); setStopTarget(null); stopForm.resetFields(); }}
        okText="确认停止"
        okButtonProps={{ danger: true }}
        cancelText="取消"
        width={480}
      >
        {stopTarget && (
          <div>
            <div style={{ marginBottom: 16, padding: 12, background: '#FFF1F2', border: '1px solid #FECDD3', borderRadius: 6 }}>
              <div style={{ fontWeight: 600, color: '#0D1B3E' }}>{stopTarget.drug}</div>
              <div style={{ fontSize: 12.5, color: '#7B92BC', marginTop: 4 }}>{stopTarget.dose} · {stopTarget.route} · {stopTarget.freq}</div>
            </div>
            <Form form={stopForm} layout="vertical">
              <Form.Item label="停止原因" name="reason" rules={[{ required: true, message: '请填写停止原因' }]}>
                <Input.TextArea rows={3} placeholder="请填写停止该医嘱的原因，将记录审计日志…" />
              </Form.Item>
            </Form>
            <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 8 }}>
              ⓘ 停止后医嘱不可在护士端显示，如需恢复请重新开具。
            </div>
          </div>
        )}
      </Modal>
    </PageShell>
  );
}
