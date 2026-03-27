import { useState } from 'react';
import { Card, Select, Button, Table, Input, Tooltip, Modal, Form, DatePicker, message } from 'antd';
import { SearchOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import PageShell from '../../components/PageShell/PageShell';
import { PageEmpty } from '../../components/PageStates/PageStates';

interface LabItem {
  key: string;
  patient: string;
  patientGender: string;
  date: string;
  category: string;
  item: string;
  value: string;
  unit: string;
  range: string;
  status: 'normal' | 'high' | 'low' | 'critical';
  nextReview: string;
}

const LAB_DATA: LabItem[] = [
  { key: '1',  patient: '赵丽萍', patientGender: '女', date: '2026-03-19', category: '电解质', item: '血清钾 K⁺',          value: '6.8',  unit: 'mmol/L',  range: '3.5–5.5',     status: 'critical', nextReview: '立即复查' },
  { key: '2',  patient: '王建军', patientGender: '男', date: '2026-03-15', category: '透析充分性', item: 'spKt/V',          value: '1.05', unit: '',        range: '≥1.2',         status: 'low',      nextReview: '2026-04-15' },
  { key: '3',  patient: '王建军', patientGender: '男', date: '2026-03-15', category: '透析充分性', item: 'URR',             value: '58%',  unit: '',        range: '≥65%',         status: 'low',      nextReview: '2026-04-15' },
  { key: '4',  patient: '张国华', patientGender: '男', date: '2026-03-15', category: '贫血',       item: '血红蛋白 Hb',     value: '98',   unit: 'g/L',     range: '≥110',         status: 'low',      nextReview: '2026-04-15' },
  { key: '5',  patient: '张国华', patientGender: '男', date: '2026-03-15', category: 'CKD-MBD',  item: 'iPTH',             value: '312',  unit: 'pg/mL',   range: '150–300',      status: 'high',     nextReview: '2026-06-15' },
  { key: '6',  patient: '刘明远', patientGender: '男', date: '2026-03-10', category: '贫血',       item: '血清铁蛋白 SF',  value: '245',  unit: 'ng/mL',   range: '200–500',      status: 'normal',   nextReview: '2026-09-10' },
  { key: '7',  patient: '刘明远', patientGender: '男', date: '2026-03-10', category: 'CKD-MBD',  item: '血清磷 P',         value: '1.92', unit: 'mmol/L',  range: '1.13–1.78',    status: 'high',     nextReview: '2026-06-10' },
  { key: '8',  patient: '李秀珍', patientGender: '女', date: '2026-03-08', category: '营养',       item: '白蛋白 ALB',      value: '31',   unit: 'g/L',     range: '≥35',          status: 'low',      nextReview: '2026-06-08' },
  { key: '9',  patient: '张国华', patientGender: '男', date: '2026-02-15', category: '透析充分性', item: 'spKt/V',          value: '1.25', unit: '',        range: '≥1.2',         status: 'normal',   nextReview: '2026-05-15' },
  { key: '10', patient: '孙红梅', patientGender: '女', date: '2026-02-10', category: '电解质',     item: '血清钙 Ca²⁺',    value: '2.65', unit: 'mmol/L',  range: '2.10–2.55',    status: 'high',     nextReview: '2026-05-10' },
];

const STATUS_CONFIG: Record<string, { label: string; className: string; tagColor: string; tagBg: string }> = {
  normal:   { label: '正常',   className: 'lab-normal',   tagColor: '#059669', tagBg: '#ECFDF5' },
  high:     { label: '偏高',   className: 'lab-high',     tagColor: '#D97706', tagBg: '#FFFBEB' },
  low:      { label: '偏低',   className: 'lab-low',      tagColor: '#4338CA', tagBg: '#EEF2FF' },
  critical: { label: '危急值', className: 'lab-critical', tagColor: '#BE123C', tagBg: '#FFF1F2' },
};

const CATEGORIES = ['全部类别', '电解质', '透析充分性', '贫血', 'CKD-MBD', '营养'];

export default function LabResultListPage() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('全部类别');
  const [statusFilter, setStatusFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form] = Form.useForm();

  const filtered = LAB_DATA.filter(r => {
    if (search && !r.patient.includes(search) && !r.item.includes(search)) return false;
    if (category !== '全部类别' && r.category !== category) return false;
    if (statusFilter && r.status !== statusFilter) return false;
    return true;
  });

  const criticalCount = LAB_DATA.filter(r => r.status === 'critical').length;
  const abnormalCount = LAB_DATA.filter(r => r.status !== 'normal').length;

  const columns = [
    {
      title: '患者',
      render: (_: unknown, r: LabItem) => (
        <div className="flex items-center gap-8">
          <div className={`hd-avatar ${r.patientGender === '女' ? 'hd-avatar-f' : 'hd-avatar-m'}`} style={{ width: 30, height: 30, fontSize: 12 }}>
            {r.patient.charAt(0)}
          </div>
          <span style={{ fontWeight: 600 }}>{r.patient}</span>
        </div>
      ),
    },
    { title: '检测日期', dataIndex: 'date', render: (v: string) => <span className="num text-sm">{v}</span> },
    { title: '类别', dataIndex: 'category', render: (v: string) => <span style={{ background: '#EEF2FF', color: '#4338CA', padding: '2px 8px', borderRadius: 20, fontSize: 11.5 }}>{v}</span> },
    { title: '检验项目', dataIndex: 'item', render: (v: string) => <span style={{ fontWeight: 500 }}>{v}</span> },
    {
      title: '结果值',
      render: (_: unknown, r: LabItem) => {
        const s = STATUS_CONFIG[r.status];
        return (
          <Tooltip title={r.status === 'critical' ? '危急值！需立即处理' : ''}>
            <span className={`num ${s.className}`}>
              {r.value} {r.unit}
              {r.status === 'critical' && ' ⚡'}
            </span>
          </Tooltip>
        );
      },
    },
    { title: '参考范围', dataIndex: 'range', render: (v: string) => <span className="text-sm text-muted">{v}</span> },
    {
      title: '状态',
      render: (_: unknown, r: LabItem) => {
        const s = STATUS_CONFIG[r.status];
        return (
          <span style={{ background: s.tagBg, color: s.tagColor, padding: '3px 9px', borderRadius: 20, fontSize: 12, fontWeight: 500 }}>
            {s.label}
          </span>
        );
      },
    },
    {
      title: '下次复查',
      dataIndex: 'nextReview',
      render: (v: string) => (
        <span className="num text-sm" style={{ color: v === '立即复查' ? '#BE123C' : '#D97706', fontWeight: v === '立即复查' ? 700 : 400 }}>
          {v}
        </span>
      ),
    },
    {
      title: '操作',
      render: () => <Button size="small">查看详情</Button>,
    },
  ];

  return (
    <PageShell fullWidth>
      {/* 概览统计 */}
      <div className="grid-4" style={{ marginBottom: 20 }}>
        <div className="hd-stat-card red">
          <div className="hd-stat-icon">⚡</div>
          <div className="hd-stat-label">危急值</div>
          <div className="hd-stat-value num" style={{ color: '#BE123C' }}>{criticalCount}</div>
          <div className="hd-stat-meta">需立即处理</div>
        </div>
        <div className="hd-stat-card amber">
          <div className="hd-stat-icon">⚠️</div>
          <div className="hd-stat-label">异常指标</div>
          <div className="hd-stat-value num" style={{ color: '#D97706' }}>{abnormalCount}</div>
          <div className="hd-stat-meta">包含偏高/偏低</div>
        </div>
        <div className="hd-stat-card teal">
          <div className="hd-stat-icon">🧪</div>
          <div className="hd-stat-label">本月检验总数</div>
          <div className="hd-stat-value num">{LAB_DATA.length}</div>
          <div className="hd-stat-meta">截至今日</div>
        </div>
        <div className="hd-stat-card blue">
          <div className="hd-stat-icon">📅</div>
          <div className="hd-stat-label">近7天到期复查</div>
          <div className="hd-stat-value num">5</div>
          <div className="hd-stat-meta">需安排复查</div>
        </div>
      </div>

      {/* 搜索筛选 */}
      <div className="flex gap-8 items-center" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
        <Input
          prefix={<SearchOutlined style={{ color: '#7B92BC' }} />}
          placeholder="搜索患者姓名 / 检验项目…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: 240, borderColor: '#DBEAFE' }}
          allowClear
        />
        <Select
          value={category}
          onChange={setCategory}
          style={{ width: 130 }}
          options={CATEGORIES.map(c => ({ value: c, label: c }))}
        />
        <Select
          placeholder="全部状态"
          value={statusFilter || undefined}
          onChange={v => setStatusFilter(v || '')}
          style={{ width: 120 }}
          allowClear
          options={[
            { value: 'normal',   label: '正常' },
            { value: 'high',     label: '偏高' },
            { value: 'low',      label: '偏低' },
            { value: 'critical', label: '危急值' },
          ]}
        />
        <div style={{ marginLeft: 'auto' }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setShowModal(true)}>
            录入新检验结果
          </Button>
        </div>
      </div>

      {/* 危急值提示 */}
      {criticalCount > 0 && (
        <div className="hd-alert-item danger" style={{ marginBottom: 16 }}>
          <span className="hd-alert-icon">⚡</span>
          <div className="hd-alert-content">
            <div className="hd-alert-title">存在 {criticalCount} 项危急值，需立即处理！</div>
            <div className="hd-alert-desc">赵丽萍 血清钾 K⁺ = 6.8 mmol/L（危急值上限 6.5）— 需立即通知医生</div>
          </div>
          <Button danger size="small">立即处理</Button>
        </div>
      )}

      {/* 检验结果表格 */}
      <Card style={{ border: '1px solid #DBEAFE' }} styles={{ body: { padding: 0 } }}>
        <div className="hd-table-responsive">
        <Table
          dataSource={filtered}
          columns={columns}
          size="small"
          locale={{ emptyText: <PageEmpty description="无符合条件的检验记录" /> }}
          pagination={{ pageSize: 15, showTotal: total => `共 ${total} 条` }}
          rowClassName={r => r.status === 'critical' ? 'row-hcv' : r.status === 'high' ? 'row-hbv' : ''}
        />
        </div>
      </Card>

      {/* 录入弹窗 */}
      <Modal
        title="录入检验结果"
        open={showModal}
        onOk={() => form.validateFields().then(() => { setShowModal(false); form.resetFields(); message.success('检验结果已录入'); })}
        onCancel={() => { setShowModal(false); form.resetFields(); }}
        okText="保存"
        cancelText="取消"
        width={520}
      >
        <Form form={form} layout="vertical" size="middle" style={{ marginTop: 16 }}>
          <div className="grid-2" style={{ gap: 16 }}>
            <Form.Item label="患者" name="patient" rules={[{ required: true }]}>
              <Select placeholder="选择患者" options={['张国华','李秀珍','王建军','赵丽萍','刘明远'].map(n => ({ value: n, label: n }))} />
            </Form.Item>
            <Form.Item label="检测日期" name="date" rules={[{ required: true }]}>
              <DatePicker style={{ width: '100%' }} defaultValue={dayjs()} />
            </Form.Item>
          </div>
          <div className="grid-2" style={{ gap: 16 }}>
            <Form.Item label="检验类别" name="category" rules={[{ required: true }]}>
              <Select options={CATEGORIES.slice(1).map(c => ({ value: c, label: c }))} />
            </Form.Item>
            <Form.Item label="检验项目" name="item" rules={[{ required: true }]}>
              <Input placeholder="如：血清钾 K⁺" />
            </Form.Item>
          </div>
          <div className="grid-2" style={{ gap: 16 }}>
            <Form.Item label="结果值" name="value" rules={[{ required: true }]}>
              <Input placeholder="如：5.8" />
            </Form.Item>
            <Form.Item label="单位" name="unit">
              <Input placeholder="如：mmol/L" />
            </Form.Item>
          </div>
          <Form.Item label="参考范围" name="range">
            <Input placeholder="如：3.5–5.5" />
          </Form.Item>
        </Form>
      </Modal>
    </PageShell>
  );
}
