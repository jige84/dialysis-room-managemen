/**
 * 感染筛查与监测管理页
 * 主要作用：录入与查询传染病筛查、感染事件，支撑隔离与质控指标。
 * 主要功能：筛查 Tab + 监测 Tab；表格与表单；对接 infection API。
 */
import { useState } from 'react';
import { Card, Button, Table, Input, Select, Modal, Form, DatePicker, message, Tabs } from 'antd';
import { SearchOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import PageShell from '../../components/PageShell/PageShell';

interface PatientInfection {
  key: string;
  name: string;
  gender: string;
  age: number;
  zone: 'normal' | 'hbv' | 'hcv';
  hbsag: { result: string; date: string; status: 'normal' | 'warning' | 'overdue' | 'positive' };
  hcv: { result: string; date: string; status: 'normal' | 'warning' | 'overdue' | 'positive' };
  hiv: { result: string; date: string; status: 'normal' | 'warning' | 'overdue' };
  syphilis: { result: string; date: string; status: 'normal' | 'warning' | 'overdue' };
  machine: string;
}

const INFECTION_DATA: PatientInfection[] = [
  { key: '1', name: '张国华', gender: '男', age: 56, zone: 'normal', machine: '5号机（普通区）',
    hbsag: { result: '阴性', date: '2025-12-10', status: 'normal' },
    hcv:   { result: '阴性', date: '2025-12-10', status: 'normal' },
    hiv:   { result: '阴性', date: '2025-12-10', status: 'normal' },
    syphilis: { result: '阴性', date: '2025-12-10', status: 'normal' },
  },
  { key: '2', name: '李秀珍', gender: '女', age: 63, zone: 'hcv', machine: 'HCV-01（丙肝区）',
    hbsag: { result: '阴性', date: '2025-09-12', status: 'overdue' },
    hcv:   { result: '阳性', date: '2025-09-12', status: 'positive' },
    hiv:   { result: '阴性', date: '2025-09-12', status: 'overdue' },
    syphilis: { result: '阴性', date: '2025-09-12', status: 'overdue' },
  },
  { key: '3', name: '王建军', gender: '男', age: 71, zone: 'hbv', machine: 'HBV-01（乙肝区）',
    hbsag: { result: '阳性', date: '2025-11-20', status: 'positive' },
    hcv:   { result: '阴性', date: '2025-11-20', status: 'normal' },
    hiv:   { result: '阴性', date: '2025-11-20', status: 'normal' },
    syphilis: { result: '阴性', date: '2025-11-20', status: 'normal' },
  },
  { key: '4', name: '赵丽萍', gender: '女', age: 48, zone: 'normal', machine: '6号机（普通区）',
    hbsag: { result: '阴性', date: '2026-01-05', status: 'normal' },
    hcv:   { result: '阴性', date: '2026-01-05', status: 'normal' },
    hiv:   { result: '阴性', date: '2026-01-05', status: 'normal' },
    syphilis: { result: '阴性', date: '2026-01-05', status: 'normal' },
  },
  { key: '5', name: '刘明远', gender: '男', age: 65, zone: 'normal', machine: '7号机（普通区）',
    hbsag: { result: '阴性', date: '2026-02-18', status: 'normal' },
    hcv:   { result: '阴性', date: '2026-02-18', status: 'normal' },
    hiv:   { result: '阴性', date: '2026-02-18', status: 'normal' },
    syphilis: { result: '阴性', date: '2026-02-18', status: 'normal' },
  },
  { key: '6', name: '陈春梅', gender: '女', age: 58, zone: 'normal', machine: '3号机（普通区）',
    hbsag: { result: '阴性', date: '2025-10-30', status: 'warning' },
    hcv:   { result: '阴性', date: '2025-10-30', status: 'warning' },
    hiv:   { result: '阴性', date: '2025-10-30', status: 'warning' },
    syphilis: { result: '阴性', date: '2025-10-30', status: 'warning' },
  },
  { key: '7', name: '孙红梅', gender: '女', age: 52, zone: 'normal', machine: '4号机（普通区）',
    hbsag: { result: '阴性', date: '2025-10-01', status: 'warning' },
    hcv:   { result: '阴性', date: '2025-10-01', status: 'warning' },
    hiv:   { result: '阴性', date: '2025-10-01', status: 'warning' },
    syphilis: { result: '阴性', date: '2025-10-01', status: 'warning' },
  },
];

const SCREEN_STATUS_CFG: Record<string, { label: string; color: string; bg: string }> = {
  normal:   { label: '正常',     color: '#059669', bg: '#ECFDF5' },
  warning:  { label: '即将到期', color: '#D97706', bg: '#FFFBEB' },
  overdue:  { label: '已超期',   color: '#BE123C', bg: '#FFF1F2' },
  positive: { label: '阳性！',   color: '#7C3AED', bg: '#FAF5FF' },
};

const ZONE_CFG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  normal: { label: '普通区',    color: '#0369A1', bg: '#E0F2FE', border: '#7DD3FC' },
  hbv:    { label: '乙肝隔离区', color: '#92400E', bg: '#FFFBEB', border: '#FDE68A' },
  hcv:    { label: '丙肝隔离区', color: '#9F1239', bg: '#FFF1F2', border: '#FECDD3' },
};

function ScreenCell({ data }: { data: { result: string; date: string; status: string } }) {
  const cfg = SCREEN_STATUS_CFG[data.status] || SCREEN_STATUS_CFG.normal;
  return (
    <div>
      <span style={{ background: cfg.bg, color: cfg.color, padding: '2px 8px', borderRadius: 20, fontSize: 12, fontWeight: 500 }}>
        {data.result === '阳性！' ? '⚠️ 阳性' : data.result}
      </span>
      <div className="text-xs text-muted num" style={{ marginTop: 2 }}>{data.date}</div>
      {data.status !== 'normal' && data.status !== 'positive' && (
        <div style={{ fontSize: 10.5, color: cfg.color, marginTop: 1 }}>{cfg.label}</div>
      )}
    </div>
  );
}

export default function InfectionPage() {
  const [search, setSearch] = useState('');
  const [zoneFilter, setZoneFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form] = Form.useForm();

  const filtered = INFECTION_DATA.filter(p => {
    if (search && !p.name.includes(search)) return false;
    if (zoneFilter && p.zone !== zoneFilter) return false;
    if (statusFilter === 'overdue') return [p.hbsag, p.hcv, p.hiv, p.syphilis].some(s => s.status === 'overdue');
    if (statusFilter === 'warning') return [p.hbsag, p.hcv, p.hiv, p.syphilis].some(s => s.status === 'warning');
    if (statusFilter === 'positive') return [p.hbsag, p.hcv].some(s => s.status === 'positive');
    return true;
  });

  const overdueCount = INFECTION_DATA.filter(p => [p.hbsag, p.hcv, p.hiv, p.syphilis].some(s => s.status === 'overdue')).length;
  const warningCount = INFECTION_DATA.filter(p => [p.hbsag, p.hcv, p.hiv, p.syphilis].some(s => s.status === 'warning')).length;
  const positiveCount = INFECTION_DATA.filter(p => [p.hbsag, p.hcv].some(s => s.status === 'positive')).length;

  const columns = [
    {
      title: '患者',
      render: (_: unknown, r: PatientInfection) => (
        <div className="flex items-center gap-8">
          <div className={`hd-avatar ${r.gender === '女' ? 'hd-avatar-f' : 'hd-avatar-m'}`} style={{ width: 30, height: 30, fontSize: 12 }}>
            {r.name.charAt(0)}
          </div>
          <div>
            <div style={{ fontWeight: 600 }}>{r.name}</div>
            <div className="text-xs text-muted">{r.gender}·{r.age}岁</div>
          </div>
        </div>
      ),
    },
    {
      title: '隔离分区',
      render: (_: unknown, r: PatientInfection) => {
        const z = ZONE_CFG[r.zone];
        return (
          <span style={{ background: z.bg, color: z.color, border: `1px solid ${z.border}`, padding: '3px 9px', borderRadius: 20, fontSize: 12 }}>
            {z.label}
          </span>
        );
      },
    },
    {
      title: '分配机器',
      dataIndex: 'machine',
      render: (v: string) => <span className="text-sm">{v}</span>,
    },
    {
      title: 'HBsAg（乙肝）',
      render: (_: unknown, r: PatientInfection) => <ScreenCell data={r.hbsag} />,
    },
    {
      title: '抗-HCV（丙肝）',
      render: (_: unknown, r: PatientInfection) => <ScreenCell data={r.hcv} />,
    },
    {
      title: '抗-HIV',
      render: (_: unknown, r: PatientInfection) => <ScreenCell data={r.hiv} />,
    },
    {
      title: '梅毒（TPPA）',
      render: (_: unknown, r: PatientInfection) => <ScreenCell data={r.syphilis} />,
    },
    {
      title: '操作',
      render: () => <Button size="small" type="primary" onClick={() => setShowModal(true)}>录入新结果</Button>,
    },
  ];

  const normalPatients = INFECTION_DATA.filter(p => p.zone === 'normal');
  const hbvPatients   = INFECTION_DATA.filter(p => p.zone === 'hbv');
  const hcvPatients   = INFECTION_DATA.filter(p => p.zone === 'hcv');

  return (
    <PageShell fullWidth>
      {/* 概览 */}
      <div className="grid-4" style={{ marginBottom: 20 }}>
        <div className="hd-stat-card red">
          <div className="hd-stat-icon">🦠</div>
          <div className="hd-stat-label">阳性患者</div>
          <div className="hd-stat-value num" style={{ color: '#7C3AED' }}>{positiveCount}</div>
          <div className="hd-stat-meta">已隔离分区</div>
        </div>
        <div className="hd-stat-card amber">
          <div className="hd-stat-icon">⏰</div>
          <div className="hd-stat-label">复查超期</div>
          <div className="hd-stat-value num" style={{ color: '#BE123C' }}>{overdueCount}</div>
          <div className="hd-stat-meta">需立即安排检测</div>
        </div>
        <div className="hd-stat-card blue">
          <div className="hd-stat-icon">⚠️</div>
          <div className="hd-stat-label">即将到期（25天内）</div>
          <div className="hd-stat-value num" style={{ color: '#D97706' }}>{warningCount}</div>
          <div className="hd-stat-meta">需提前安排</div>
        </div>
        <div className="hd-stat-card teal">
          <div className="hd-stat-icon">✅</div>
          <div className="hd-stat-label">在透总患者数</div>
          <div className="hd-stat-value num">{INFECTION_DATA.length}</div>
          <div className="hd-stat-meta">纳入管理</div>
        </div>
      </div>

      <Tabs defaultActiveKey="status" items={[
        {
          key: 'status',
          label: '📋 筛查状态总览',
          children: (
            <div>
              {/* 筛选栏 */}
              <div className="flex gap-8 items-center" style={{ marginBottom: 16 }}>
                <Input
                  prefix={<SearchOutlined style={{ color: '#7B92BC' }} />}
                  placeholder="搜索患者姓名…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  style={{ width: 200, borderColor: '#DBEAFE' }}
                  allowClear
                />
                <Select placeholder="全部分区" value={zoneFilter || undefined} onChange={v => setZoneFilter(v || '')} style={{ width: 140 }} allowClear
                  options={[{ value: 'normal', label: '普通区' }, { value: 'hbv', label: '乙肝隔离区' }, { value: 'hcv', label: '丙肝隔离区' }]}
                />
                <div className="flex gap-4">
                  {[['', '全部'], ['overdue', '已超期'], ['warning', '即将到期'], ['positive', '阳性']].map(([val, label]) => (
                    <Button key={val} size="small" type={statusFilter === val ? 'primary' : 'default'} onClick={() => setStatusFilter(val)}>
                      {label}
                    </Button>
                  ))}
                </div>
                <div style={{ marginLeft: 'auto' }}>
                  <Button type="primary" icon={<PlusOutlined />} onClick={() => setShowModal(true)}>录入检测结果</Button>
                </div>
              </div>

              {overdueCount > 0 && (
                <div className="hd-alert-item danger" style={{ marginBottom: 16 }}>
                  <span className="hd-alert-icon">⚡</span>
                  <div className="hd-alert-content">
                    <div className="hd-alert-title">{overdueCount} 名患者传染病筛查已超期，需立即安排检测！</div>
                    <div className="hd-alert-desc">李秀珍（抗HCV等已超期7天）· 其他患者请查看详情</div>
                  </div>
                </div>
              )}

              <Card style={{ border: '1px solid #DBEAFE' }} styles={{ body: { padding: 0 } }}>
                <Table
                  dataSource={filtered}
                  columns={columns}
                  size="small"
                  pagination={{ pageSize: 15, showTotal: total => `共 ${total} 名患者` }}
                  rowClassName={r => r.zone === 'hbv' ? 'row-hbv' : r.zone === 'hcv' ? 'row-hcv' : ''}
                />
              </Card>
            </div>
          ),
        },
        {
          key: 'isolation',
          label: '🏥 隔离分区管理',
          children: (
            <div>
              <div className="grid-3" style={{ gap: 20 }}>
                {/* 普通区 */}
                <Card
                  title={<span style={{ fontWeight: 600, color: '#0369A1' }}>🟦 普通透析区</span>}
                  style={{ border: '2px solid #7DD3FC' }}
                  styles={{ header: { background: '#E0F2FE', borderBottom: '1px solid #7DD3FC' } }}
                >
                  <div style={{ fontSize: 12, color: '#7B92BC', marginBottom: 12 }}>HBsAg阴性 & 抗HCV阴性患者</div>
                  {normalPatients.map(p => (
                    <div key={p.key} className="flex items-center justify-between" style={{ padding: '6px 0', borderBottom: '1px solid #DBEAFE' }}>
                      <span style={{ fontWeight: 500 }}>{p.name}</span>
                      <span className="text-xs text-muted">{p.machine}</span>
                    </div>
                  ))}
                  <div style={{ marginTop: 12, fontSize: 13, fontWeight: 600, color: '#0369A1' }}>
                    共 {normalPatients.length} 名患者
                  </div>
                </Card>

                {/* 乙肝区 */}
                <Card
                  title={<span style={{ fontWeight: 600, color: '#92400E' }}>🟧 乙肝隔离区</span>}
                  style={{ border: '2px solid #FDE68A' }}
                  styles={{ header: { background: '#FFFBEB', borderBottom: '1px solid #FDE68A' } }}
                >
                  <div style={{ fontSize: 12, color: '#7B92BC', marginBottom: 12 }}>HBsAg阳性患者专区（专机专用）</div>
                  {hbvPatients.map(p => (
                    <div key={p.key} className="flex items-center justify-between" style={{ padding: '6px 0', borderBottom: '1px solid #FDE68A' }}>
                      <span style={{ fontWeight: 500 }}>{p.name}</span>
                      <span className="text-xs text-muted">{p.machine}</span>
                    </div>
                  ))}
                  {hbvPatients.length === 0 && <div style={{ color: '#7B92BC', fontSize: 13, padding: '8px 0' }}>暂无乙肝阳性患者</div>}
                  <div style={{ marginTop: 12, fontSize: 13, fontWeight: 600, color: '#92400E' }}>
                    共 {hbvPatients.length} 名患者
                  </div>
                </Card>

                {/* 丙肝区 */}
                <Card
                  title={<span style={{ fontWeight: 600, color: '#9F1239' }}>🟥 丙肝隔离区</span>}
                  style={{ border: '2px solid #FECDD3' }}
                  styles={{ header: { background: '#FFF1F2', borderBottom: '1px solid #FECDD3' } }}
                >
                  <div style={{ fontSize: 12, color: '#7B92BC', marginBottom: 12 }}>抗HCV阳性患者专区（专机专用）</div>
                  {hcvPatients.map(p => (
                    <div key={p.key} className="flex items-center justify-between" style={{ padding: '6px 0', borderBottom: '1px solid #FECDD3' }}>
                      <span style={{ fontWeight: 500 }}>{p.name}</span>
                      <span className="text-xs text-muted">{p.machine}</span>
                    </div>
                  ))}
                  {hcvPatients.length === 0 && <div style={{ color: '#7B92BC', fontSize: 13, padding: '8px 0' }}>暂无丙肝阳性患者</div>}
                  <div style={{ marginTop: 12, fontSize: 13, fontWeight: 600, color: '#9F1239' }}>
                    共 {hcvPatients.length} 名患者
                  </div>
                </Card>
              </div>
              <div style={{ marginTop: 16, padding: 14, background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: 8, fontSize: 13, lineHeight: 1.8 }}>
                <div style={{ fontWeight: 600, color: '#0369A1', marginBottom: 4 }}>📋 隔离分区规则（依据《血液净化标准化操作规程2021版》）</div>
                <div>① HBsAg阳性患者必须使用乙肝隔离区专机，不得与阴性区共用</div>
                <div>② 抗HCV阳性患者必须使用丙肝隔离区专机，不得与阴性区共用</div>
                <div>③ 系统分配机器时自动验证隔离区合规性，阳性患者不得分配阴性区机器</div>
                <div>④ 新入患者首次透析前必须完成4项筛查（HBsAg、抗HCV、抗HIV、梅毒）</div>
              </div>
            </div>
          ),
        },
      ]} />

      {/* 录入弹窗 */}
      <Modal
        title="录入传染病检测结果"
        open={showModal}
        onOk={() => form.validateFields().then(() => { setShowModal(false); form.resetFields(); message.success('检测结果已录入，系统已自动检查隔离区分配'); })}
        onCancel={() => { setShowModal(false); form.resetFields(); }}
        okText="保存结果"
        cancelText="取消"
        width={520}
      >
        <Form form={form} layout="vertical" size="middle" style={{ marginTop: 16 }}>
          <div className="grid-2" style={{ gap: 16 }}>
            <Form.Item label="患者" name="patient" rules={[{ required: true }]}>
              <Select placeholder="选择患者" options={INFECTION_DATA.map(p => ({ value: p.key, label: p.name }))} />
            </Form.Item>
            <Form.Item label="检测日期" name="date" initialValue={dayjs()} rules={[{ required: true }]}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <div className="grid-2" style={{ gap: 16 }}>
            <Form.Item label="HBsAg" name="hbsag" initialValue="阴性" rules={[{ required: true }]}>
              <Select options={[{ value: '阴性', label: '阴性' }, { value: '阳性', label: '阳性 ⚠️' }]} />
            </Form.Item>
            <Form.Item label="抗-HCV" name="hcv" initialValue="阴性" rules={[{ required: true }]}>
              <Select options={[{ value: '阴性', label: '阴性' }, { value: '阳性', label: '阳性 ⚠️' }]} />
            </Form.Item>
          </div>
          <div className="grid-2" style={{ gap: 16 }}>
            <Form.Item label="抗-HIV" name="hiv" initialValue="阴性" rules={[{ required: true }]}>
              <Select options={[{ value: '阴性', label: '阴性' }, { value: '阳性', label: '阳性 ⚠️' }]} />
            </Form.Item>
            <Form.Item label="梅毒（TPPA）" name="syphilis" initialValue="阴性" rules={[{ required: true }]}>
              <Select options={[{ value: '阴性', label: '阴性' }, { value: '阳性', label: '阳性 ⚠️' }]} />
            </Form.Item>
          </div>
          <div style={{ padding: 10, background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 6, fontSize: 12.5, color: '#92400E' }}>
            ⚠️ 如有检测结果为阳性，系统将自动提示更新患者隔离分区并记录审计日志。
          </div>
        </Form>
      </Modal>
    </PageShell>
  );
}
