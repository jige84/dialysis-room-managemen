import { useState } from 'react';
import { Card, Input, Select, Button, Table, Space, Tooltip } from 'antd';
import { SearchOutlined, PlusOutlined, ExportOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

// ── 演示数据 ──────────────────────────────────────────────
const PATIENTS = [
  {
    key: '1', avatar: '张', name: '张国华', gender: '男', age: 56, diagnosis: '糖尿病肾病',
    access: 'AVF', accessDetail: '绳梯', zone: 'normal',
    dialysisAge: '4年7月', ktv: 1.25, ktvStatus: 'normal',
    lastScreen: '2025-12-10', screenStatus: 'normal',
    dryWeight: 62.0, status: 'active',
  },
  {
    key: '2', avatar: '李', name: '李秀珍', gender: '女', age: 63, diagnosis: '慢性肾小球肾炎',
    access: 'TCC', accessDetail: '临时管', zone: 'hcv',
    dialysisAge: '2年1月', ktv: 1.32, ktvStatus: 'normal',
    lastScreen: '2025-09-12', screenStatus: 'overdue',
    dryWeight: 50.5, status: 'active',
  },
  {
    key: '3', avatar: '王', name: '王建军', gender: '男', age: 71, diagnosis: '高血压肾病',
    access: 'AVF', accessDetail: '绳梯', zone: 'hbv',
    dialysisAge: '8年3月', ktv: 1.05, ktvStatus: 'low',
    lastScreen: '2025-11-20', screenStatus: 'normal',
    dryWeight: 57.5, status: 'active',
  },
  {
    key: '4', avatar: '赵', name: '赵丽萍', gender: '女', age: 48, diagnosis: '糖尿病肾病',
    access: 'AVF', accessDetail: '扣眼', zone: 'normal',
    dialysisAge: '1年9月', ktv: 1.28, ktvStatus: 'normal',
    lastScreen: '2026-01-05', screenStatus: 'normal',
    dryWeight: 53.0, status: 'critical',
  },
  {
    key: '5', avatar: '刘', name: '刘明远', gender: '男', age: 65, diagnosis: '多囊肾',
    access: 'LTCC', accessDetail: '长期管', zone: 'normal',
    dialysisAge: '6年0月', ktv: 1.35, ktvStatus: 'normal',
    lastScreen: '2026-02-18', screenStatus: 'normal',
    dryWeight: 50.0, status: 'active',
  },
  {
    key: '6', avatar: '陈', name: '陈春梅', gender: '女', age: 58, diagnosis: '慢性肾小球肾炎',
    access: 'AVF', accessDetail: '绳梯', zone: 'normal',
    dialysisAge: '3年5月', ktv: null, ktvStatus: 'na',
    lastScreen: '2025-10-30', screenStatus: 'warning',
    dryWeight: 55.0, status: 'paused',
  },
  {
    key: '7', avatar: '孙', name: '孙红梅', gender: '女', age: 52, diagnosis: '狼疮性肾炎',
    access: 'AVG', accessDetail: '人工血管', zone: 'normal',
    dialysisAge: '2年8月', ktv: 1.22, ktvStatus: 'normal',
    lastScreen: '2025-10-01', screenStatus: 'warning',
    dryWeight: 48.0, status: 'active',
  },
];

const ACCESS_COLORS: Record<string, { bg: string; color: string }> = {
  AVF:  { bg: '#ECFDF5', color: '#059669' },
  AVG:  { bg: '#EFF6FF', color: '#2563EB' },
  TCC:  { bg: '#FFFBEB', color: '#D97706' },
  LTCC: { bg: '#FAF5FF', color: '#7C3AED' },
  NCC:  { bg: '#FFF7ED', color: '#C2410C' },
};

const ZONE_STYLE: Record<string, { bg: string; color: string; border: string; label: string }> = {
  normal: { bg: '#E0F2FE', color: '#0369A1', border: '#7DD3FC', label: '普通区' },
  hbv:    { bg: '#FFFBEB', color: '#92400E', border: '#FDE68A', label: '乙肝隔离区' },
  hcv:    { bg: '#FFF1F2', color: '#9F1239', border: '#FECDD3', label: '丙肝隔离区' },
};

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  active:    { label: '在透', color: '#059669', bg: '#ECFDF5' },
  paused:    { label: '暂停', color: '#D97706', bg: '#FFFBEB' },
  transfer:  { label: '转出', color: '#7B92BC', bg: '#F1F5F9' },
  critical:  { label: '⚡ K⁺危急', color: '#BE123C', bg: '#FFF1F2' },
  deceased:  { label: '死亡', color: '#64748B', bg: '#F8FAFC' },
};

export default function PatientListPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [accessFilter, setAccessFilter] = useState('');
  const [zoneFilter, setZoneFilter] = useState('');

  const filtered = PATIENTS.filter(p => {
    if (search && !p.name.includes(search) && !p.diagnosis.includes(search)) return false;
    if (statusFilter === 'active' && p.status !== 'active' && p.status !== 'critical') return false;
    if (statusFilter && statusFilter !== 'active' && p.status !== statusFilter) return false;
    if (accessFilter && p.access !== accessFilter) return false;
    if (zoneFilter && p.zone !== zoneFilter) return false;
    return true;
  });

  const rowClassName = (r: typeof PATIENTS[0]) => {
    if (r.zone === 'hbv') return 'row-hbv';
    if (r.zone === 'hcv') return 'row-hcv';
    return '';
  };

  const columns = [
    {
      title: '患者信息',
      key: 'patient',
      render: (_: unknown, r: typeof PATIENTS[0]) => (
        <div className="flex items-center gap-8">
          <div className={`hd-avatar ${r.gender === '女' ? 'hd-avatar-f' : 'hd-avatar-m'}`}>
            {r.avatar}
          </div>
          <div>
            <div style={{ fontWeight: 600, color: '#0D1B3E' }}>{r.name}</div>
            <div className="text-sm text-muted">{r.gender} · {r.age}岁 · {r.diagnosis}</div>
          </div>
        </div>
      ),
    },
    {
      title: '通路类型',
      key: 'access',
      render: (_: unknown, r: typeof PATIENTS[0]) => {
        const s = ACCESS_COLORS[r.access] || { bg: '#F1F5F9', color: '#64748B' };
        return (
          <span style={{ background: s.bg, color: s.color, padding: '3px 9px', borderRadius: 20, fontSize: 12, fontWeight: 500 }}>
            {r.access} {r.accessDetail}
          </span>
        );
      },
    },
    {
      title: '隔离区',
      key: 'zone',
      render: (_: unknown, r: typeof PATIENTS[0]) => {
        const z = ZONE_STYLE[r.zone];
        return (
          <span style={{ background: z.bg, color: z.color, border: `1px solid ${z.border}`, padding: '3px 9px', borderRadius: 20, fontSize: 12 }}>
            {z.label}
          </span>
        );
      },
    },
    {
      title: '透析龄',
      dataIndex: 'dialysisAge',
      render: (v: string) => <span className="num">{v}</span>,
    },
    {
      title: 'Kt/V',
      key: 'ktv',
      render: (_: unknown, r: typeof PATIENTS[0]) => {
        if (r.ktv === null) return <span className="text-muted">—</span>;
        const isLow = r.ktvStatus === 'low';
        return (
          <Tooltip title={isLow ? 'Kt/V 不达标 (≥1.2)' : ''}>
            <span className={`num ${isLow ? 'lab-critical' : 'lab-normal'}`}>
              {r.ktv}{isLow ? '⚠' : ''}
            </span>
          </Tooltip>
        );
      },
    },
    {
      title: '最近传染病筛查',
      key: 'screen',
      render: (_: unknown, r: typeof PATIENTS[0]) => {
        const statusStyle: Record<string, { label: string; color: string; bg: string }> = {
          normal:  { label: '正常', color: '#059669', bg: '#ECFDF5' },
          warning: { label: '即将到期', color: '#D97706', bg: '#FFFBEB' },
          overdue: { label: '逾期7天', color: '#BE123C', bg: '#FFF1F2' },
        };
        const s = statusStyle[r.screenStatus] || statusStyle.normal;
        return (
          <div className="text-sm">
            {r.lastScreen}
            <span style={{ marginLeft: 6, background: s.bg, color: s.color, padding: '1px 7px', borderRadius: 20, fontSize: 11 }}>
              {s.label}
            </span>
          </div>
        );
      },
    },
    {
      title: '干体重',
      dataIndex: 'dryWeight',
      render: (v: number) => <span className="num">{v} kg</span>,
    },
    {
      title: '状态',
      key: 'status',
      render: (_: unknown, r: typeof PATIENTS[0]) => {
        const s = STATUS_MAP[r.status] || STATUS_MAP.active;
        return (
          <span style={{ background: s.bg, color: s.color, padding: '3px 9px', borderRadius: 20, fontSize: 12, fontWeight: 500 }}>
            {s.label}
          </span>
        );
      },
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: unknown, r: typeof PATIENTS[0]) => (
        <Space size={4}>
          <Button size="small" onClick={() => navigate(`/patients/${r.key}`)}>档案</Button>
          {(r.status === 'active' || r.status === 'critical') && (
            <Button size="small" type="primary" onClick={() => navigate('/dialysis/entry')}>录入</Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      {/* 搜索筛选栏 */}
      <div className="flex gap-8 items-center" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
        <Input
          prefix={<SearchOutlined style={{ color: '#7B92BC' }} />}
          placeholder="搜索患者姓名 / 诊断…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: 240, borderColor: '#DBEAFE' }}
          allowClear
        />
        <Select
          placeholder="全部状态"
          value={statusFilter || undefined}
          onChange={v => setStatusFilter(v || '')}
          style={{ width: 130 }}
          allowClear
          options={[
            { value: 'active',   label: '在透' },
            { value: 'paused',   label: '暂停' },
            { value: 'transfer', label: '转出' },
            { value: 'deceased', label: '死亡' },
          ]}
        />
        <Select
          placeholder="全部通路"
          value={accessFilter || undefined}
          onChange={v => setAccessFilter(v || '')}
          style={{ width: 140 }}
          allowClear
          options={[
            { value: 'AVF',  label: '动静脉内瘘 AVF' },
            { value: 'AVG',  label: '人工血管 AVG' },
            { value: 'TCC',  label: '临时导管 TCC' },
            { value: 'LTCC', label: '长期导管 LTCC' },
          ]}
        />
        <Select
          placeholder="全部分区"
          value={zoneFilter || undefined}
          onChange={v => setZoneFilter(v || '')}
          style={{ width: 130 }}
          allowClear
          options={[
            { value: 'normal', label: '普通区' },
            { value: 'hbv',    label: '乙肝隔离区' },
            { value: 'hcv',    label: '丙肝隔离区' },
          ]}
        />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => {}}>新建档案</Button>
          <Button icon={<ExportOutlined />}>导出</Button>
        </div>
      </div>

      {/* 患者表格 */}
      <Card style={{ border: '1px solid #DBEAFE' }} styles={{ body: { padding: 0 } }}>
        <Table
          dataSource={filtered}
          columns={columns}
          rowClassName={rowClassName}
          pagination={{
            pageSize: 15,
            showTotal: total => `共 ${total} 条患者记录`,
            showSizeChanger: false,
          }}
          size="small"
          style={{ border: 'none' }}
        />
      </Card>
      <div style={{ marginTop: 10, textAlign: 'right', fontSize: 12, color: '#7B92BC' }}>
        显示 {filtered.length} / 79 条患者记录 · 按最后透析时间降序排列
      </div>
    </div>
  );
}
