/**
 * 患者档案列表页
 * 主要作用：分页展示在透患者，支持检索、隔离区筛选与跳转详情/新建。
 * 主要功能：Table + 搜索；导出（权限受控）；对接 patientsApi.list。
 */
import { useEffect, useMemo, useState } from 'react';
import { Card, Input, Select, Button, Table, Space, Tooltip, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { SearchOutlined, PlusOutlined, ExportOutlined, CloudUploadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import PageShell from '../../components/PageShell/PageShell';
import { PageLoading, PageErrorResult } from '../../components/PageStates/PageStates';
import { useAuthStore } from '../../stores/authStore';
import IsolationZoneTag from '../../components/IsolationZoneTag/IsolationZoneTag';
import { getAccessTypeStyle } from '../../constants/isolation';
import { patientsApi, type Patient } from '../../api/patients';

type PatientRow = {
  key: string;
  id: string;
  avatar: string;
  name: string;
  gender: '男' | '女';
  age: number | null;
  diagnosis: string;
  access: string;
  accessDetail: string;
  zone: string;
  dialysisAge: string;
  dryWeight?: number | null;
  status: string;
  responsibleNurseName: string;
};

function parseDryWeightKg(
  profile: Patient['profile_dry_weight'],
  prescription: Patient['prescription_dry_weight'],
): number | null {
  const toNum = (v: unknown): number | null => {
    if (v == null || v === '') return null;
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    return Number.isFinite(n) ? n : null;
  };
  const fromProfile = toNum(profile);
  if (fromProfile != null) return fromProfile;
  return toNum(prescription);
}

function toPatientRow(p: Patient): PatientRow {
  const access = (p.access_type || 'NCC').toUpperCase();
  const zone = p.isolation_zone || 'normal';
  return {
    key: p.id,
    id: p.id,
    avatar: p.name?.slice(0, 1) || '患',
    name: p.name,
    gender: p.gender === 'F' ? '女' : '男',
    age: Number.isFinite(p.age) ? Number(p.age) : null,
    diagnosis: p.primary_diagnosis || '—',
    access,
    accessDetail: p.access_location || '—',
    zone,
    dialysisAge: p.dialysis_age || '—',
    dryWeight: parseDryWeightKg(p.profile_dry_weight, p.prescription_dry_weight),
    status: p.status,
    responsibleNurseName: p.responsible_nurse_name?.trim() || '—',
  };
}

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  active: { label: '在透', color: '#059669', bg: '#ECFDF5' },
  suspended: { label: '暂停', color: '#D97706', bg: '#FFFBEB' },
  transferred: { label: '转出', color: '#7B92BC', bg: '#F1F5F9' },
  transplanted: { label: '肾移植', color: '#4338CA', bg: '#EEF2FF' },
  deceased: { label: '死亡', color: '#64748B', bg: '#F8FAFC' },
};

export default function PatientListPage() {
  const navigate = useNavigate();
  const canCreatePatient = useAuthStore((s) => s.hasRole(['admin', 'doctor']));
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [accessFilter, setAccessFilter] = useState('');
  const [zoneFilter, setZoneFilter] = useState('');
  const [rows, setRows] = useState<PatientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(false);
      try {
        const res = await patientsApi.list({ page: 1, page_size: 500 });
        if (cancelled) return;
        if (res.data.code !== 200 || !Array.isArray(res.data.data?.list)) {
          setRows([]);
          setLoadError(true);
          return;
        }
        setRows(res.data.data.list.map(toPatientRow));
      } catch {
        if (!cancelled) {
          setRows([]);
          setLoadError(true);
          message.error('患者列表加载失败，请检查后端服务');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => rows.filter((p) => {
    if (search && !p.name.includes(search) && !p.diagnosis.includes(search)) return false;
    if (statusFilter && p.status !== statusFilter) return false;
    if (accessFilter && p.access !== accessFilter) return false;
    if (zoneFilter && p.zone !== zoneFilter) return false;
    return true;
  }), [rows, search, statusFilter, accessFilter, zoneFilter]);

  const summary = useMemo(() => ({
    total: rows.length,
    active: rows.filter(r => r.status === 'active').length,
    isolated: rows.filter(r => r.zone !== 'normal').length,
  }), [rows]);

  const rowClassName = (r: PatientRow) => {
    if (r.zone === 'hbv') return 'row-hbv';
    if (r.zone === 'hcv') return 'row-hcv';
    return '';
  };

  const columns: ColumnsType<PatientRow> = [
    {
      title: '患者信息',
      key: 'patient',
      render: (_, r) => (
        <div className="flex items-center gap-8">
          <div className={`hd-avatar ${r.gender === '女' ? 'hd-avatar-f' : 'hd-avatar-m'}`}>
            {r.avatar}
          </div>
          <div>
            <div style={{ fontWeight: 600, color: '#0D1B3E' }}>{r.name}</div>
            <div className="text-sm text-muted">{r.gender} · {r.age ?? '—'}岁 · {r.diagnosis}</div>
          </div>
        </div>
      ),
    },
    {
      title: '通路类型',
      key: 'access',
      render: (_, r) => {
        const s = getAccessTypeStyle(r.access);
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
      render: (_, r) => (
        <IsolationZoneTag zone={r.zone} />
      ),
    },
    {
      title: '透析龄',
      dataIndex: 'dialysisAge',
      render: (v: string) => <span className="num">{v}</span>,
    },
    {
      title: '责任护士',
      key: 'responsibleNurse',
      width: 120,
      render: (_, r) => (
        <span style={{ color: r.responsibleNurseName === '—' ? '#94A3B8' : '#0D1B3E' }}>
          {r.responsibleNurseName}
        </span>
      ),
    },
    {
      title: '干体重',
      key: 'dryWeight',
      render: (_, r) => (
        <span className="num">
          {r.dryWeight != null ? `${r.dryWeight.toFixed(1)} kg` : '—'}
        </span>
      ),
    },
    {
      title: '状态',
      key: 'status',
      render: (_, r) => {
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
      render: (_, r) => (
        <Space size={4}>
          <Button size="small" onClick={() => navigate(`/patients/${r.id}`)}>档案</Button>
          {r.status === 'active' && (
            <Button size="small" type="primary" onClick={() => navigate('/dialysis/entry')}>录入</Button>
          )}
        </Space>
      ),
    },
  ];

  if (loading) {
    return (
      <PageShell fullWidth>
        <PageLoading tip="加载患者列表中..." />
      </PageShell>
    );
  }

  if (loadError) {
    return (
      <PageShell fullWidth>
        <PageErrorResult title="无法加载患者列表" subTitle="请确认后端服务已启动，再重试。" />
      </PageShell>
    );
  }

  return (
    <PageShell fullWidth>
      <div className="hd-page-intro">
        <div>
          <div className="hd-page-intro__eyebrow">患者档案中心</div>
          <div className="hd-page-intro__title">在透患者与分区信息</div>
          <div className="hd-page-intro__desc">
            用于日常检索、分区识别、状态查看与快速进入患者档案或透析录入。
          </div>
        </div>
        <div className="hd-page-intro__chips">
          <span className="hd-page-intro__chip">患者总数 {summary.total}</span>
          <span className="hd-page-intro__chip">在透 {summary.active}</span>
          <span className="hd-page-intro__chip">隔离管理 {summary.isolated}</span>
        </div>
      </div>

      {/* 搜索筛选栏 */}
      <div className="hd-filter-bar">
        <div className="hd-filter-bar__left">
          <Input
            prefix={<SearchOutlined style={{ color: '#7B92BC' }} />}
            placeholder="搜索患者姓名 / 诊断"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: 260 }}
            allowClear
          />
          <Select
            placeholder="全部状态"
            value={statusFilter || undefined}
            onChange={v => setStatusFilter(v || '')}
            style={{ width: 132 }}
            allowClear
            options={[
              { value: 'active', label: '在透' },
              { value: 'suspended', label: '暂停' },
              { value: 'transferred', label: '转出' },
              { value: 'transplanted', label: '肾移植' },
              { value: 'deceased', label: '死亡' },
            ]}
          />
          <Select
            placeholder="全部通路"
            value={accessFilter || undefined}
            onChange={v => setAccessFilter(v || '')}
            style={{ width: 152 }}
            allowClear
            options={[
              { value: 'AVF', label: '动静脉内瘘 AVF' },
              { value: 'AVG', label: '人工血管 AVG' },
              { value: 'TCC', label: '带涤纶套导管 TCC' },
              { value: 'NCC', label: '无涤纶套导管 NCC' },
              { value: 'LTCC', label: '长期导管 LTCC' },
            ]}
          />
          <Select
            placeholder="全部分区"
            value={zoneFilter || undefined}
            onChange={v => setZoneFilter(v || '')}
            style={{ width: 138 }}
            allowClear
            options={[
              { value: 'normal', label: '普通区' },
              { value: 'hbv', label: '乙肝隔离区' },
              { value: 'hcv', label: '丙肝隔离区' },
            ]}
          />
        </div>
        <div className="hd-filter-bar__right">
          {canCreatePatient ? (
            <Space size="middle">
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => navigate('/patients/new')}
              >
                新建患者档案
              </Button>
              <Button icon={<CloudUploadOutlined />} onClick={() => navigate('/patients/import')}>
                批量导入
              </Button>
            </Space>
          ) : (
            <Tooltip title="仅管理员与医生可新建患者档案">
              <Button type="primary" icon={<PlusOutlined />} disabled>
                新建患者档案
              </Button>
            </Tooltip>
          )}
          <Button icon={<ExportOutlined />}>导出名单</Button>
        </div>
      </div>

      {/* 患者表格 */}
      <Card className="hd-table-card" styles={{ body: { padding: 0 } }}>
        <div className="hd-table-responsive">
        <Table
          rowKey="id"
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
        </div>
      </Card>
      <div className="hd-list-summary">
        显示 {filtered.length} / {rows.length} 条患者记录
      </div>
    </PageShell>
  );
}
