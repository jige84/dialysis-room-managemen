/**
 * 感染筛查与监测管理页
 * 主要作用：展示筛查状态、超期提醒，并支持录入筛查与月度监测。
 * 主要功能：按患者汇总最新筛查；录入四项筛查+胸片；月度导管日监测维护。
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  message,
} from 'antd';
import dayjs, { Dayjs } from 'dayjs';
import PageShell from '../../components/PageShell/PageShell';
import { infectionApi, type InfectionMonitoringRow, type InfectionScreeningLatestBatchRow } from '../../api/infection';
import { patientsApi, type Patient } from '../../api/patients';
import { useAuthStore } from '../../stores/authStore';

type ScreeningStatus = 'normal' | 'warning' | 'overdue' | 'positive' | 'missing';

interface PatientSummaryRow {
  key: string;
  patientId: string;
  patientName: string;
  gender?: string | null;
  age?: number | null;
  zone: string;
  hbsag: { result: string; date: string | null; status: ScreeningStatus };
  hcvab: { result: string; date: string | null; status: ScreeningStatus };
  hiv: { result: string; date: string | null; status: ScreeningStatus };
  syphilis_tppa: { result: string; date: string | null; status: ScreeningStatus };
}

const STATUS_META: Record<ScreeningStatus, { label: string; color: string }> = {
  normal: { label: '正常', color: 'green' },
  warning: { label: '即将到期', color: 'gold' },
  overdue: { label: '已超期', color: 'red' },
  positive: { label: '阳性', color: 'purple' },
  missing: { label: '未筛查', color: 'default' },
};

const ZONE_LABEL: Record<string, string> = {
  normal: '普通区',
  hbv: '乙肝隔离区',
  hcv: '丙肝隔离区',
  observation: '观察区',
  last_shift: '末班区',
};

const MONITOR_STATUS_OPTIONS = [
  { value: 'none', label: '无感染' },
  { value: 'suspected', label: '疑似感染' },
  { value: 'confirmed', label: '确诊感染' },
];

function normalizeResultText(result?: string | null): string {
  const s = String(result || '').toLowerCase();
  if (!s) return '未录入';
  if (s === 'positive') return '阳性';
  if (s === 'negative') return '阴性';
  if (s === 'normal') return '正常';
  if (s === 'abnormal') return '异常';
  return String(result);
}

function getScreeningStatus(result?: string | null, date?: string | null): ScreeningStatus {
  const normalized = String(result || '').toLowerCase();
  if (!date) return 'missing';
  if (normalized === 'positive') return 'positive';
  const days = dayjs().diff(dayjs(date), 'day');
  if (days >= 185) return 'overdue';
  if (days >= 175) return 'warning';
  return 'normal';
}

function buildPatientSummary(patient: Patient, latestRows: Array<{ screen_type: string; result: string; screen_date: string }>): PatientSummaryRow {
  const map = new Map(latestRows.map((row) => [row.screen_type, row]));
  const pick = (key: string) => {
    const row = map.get(key);
    const result = normalizeResultText(row?.result);
    const date = row?.screen_date || null;
    return {
      result,
      date,
      status: getScreeningStatus(row?.result, date),
    };
  };

  return {
    key: patient.id,
    patientId: patient.id,
    patientName: patient.name,
    gender: patient.gender || null,
    age: patient.age || null,
    zone: patient.isolation_zone || 'normal',
    hbsag: pick('hbsag'),
    hcvab: pick('hcvab'),
    hiv: pick('hiv'),
    syphilis_tppa: pick('syphilis_tppa'),
  };
}

function ScreeningCell({ item }: { item: { result: string; date: string | null; status: ScreeningStatus } }) {
  const meta = STATUS_META[item.status];
  return (
    <Space direction="vertical" size={0}>
      <Tag color={meta.color}>{item.result}</Tag>
      <span style={{ color: '#64748b', fontSize: 12 }}>{item.date || '-'}</span>
    </Space>
  );
}

export default function InfectionPage() {
  const [form] = Form.useForm();
  const [monitorForm] = Form.useForm();
  const currentUser = useAuthStore((state) => state.user);

  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<PatientSummaryRow[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState('');
  const [zoneFilter, setZoneFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  const [monitorMonth, setMonitorMonth] = useState<Dayjs>(dayjs());
  const [monitoringRows, setMonitoringRows] = useState<InfectionMonitoringRow[]>([]);
  const [monitoringLoading, setMonitoringLoading] = useState(false);
  const [monitorSaving, setMonitorSaving] = useState(false);

  const canViewOverdue = currentUser?.role === 'admin' || currentUser?.role === 'head_nurse';
  const canWriteScreening = ['admin', 'doctor', 'head_nurse', 'nurse', 'technician'].includes(currentUser?.role || '');
  const canWriteMonitoring = ['admin', 'head_nurse', 'nurse'].includes(currentUser?.role || '');

  const loadSummary = async () => {
    setLoading(true);
    try {
      const patientsRes = await patientsApi.list({ page: 1, page_size: 200, status: 'active' });
      const patients = patientsRes.data.data.list || [];
      const patientIds = patients.map((patient) => patient.id);

      let latestRows: InfectionScreeningLatestBatchRow[] = [];
      if (patientIds.length > 0) {
        try {
          const latestRes = await infectionApi.getLatestBatch(patientIds);
          latestRows = latestRes.data.data || [];
        } catch {
          latestRows = [];
        }
      }

      const latestMap = latestRows.reduce<Map<string, InfectionScreeningLatestBatchRow[]>>((acc, row) => {
        const list = acc.get(row.patient_id) || [];
        list.push(row);
        acc.set(row.patient_id, list);
        return acc;
      }, new Map());

      const merged = patients.map((patient) => buildPatientSummary(patient, latestMap.get(patient.id) || []));
      setRows(merged);
    } finally {
      setLoading(false);
    }
  };

  const loadMonitoring = async (month: Dayjs) => {
    setMonitoringLoading(true);
    try {
      const res = await infectionApi.getMonitoringByMonth(month.year(), month.month() + 1);
      setMonitoringRows(res.data.data || []);
    } finally {
      setMonitoringLoading(false);
    }
  };

  useEffect(() => {
    void loadSummary();
  }, []);

  useEffect(() => {
    void loadMonitoring(monitorMonth);
  }, [monitorMonth]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (search && !row.patientName.includes(search)) return false;
      if (zoneFilter && row.zone !== zoneFilter) return false;
      if (statusFilter === 'overdue') return [row.hbsag, row.hcvab, row.hiv, row.syphilis_tppa].some((s) => s.status === 'overdue');
      if (statusFilter === 'warning') return [row.hbsag, row.hcvab, row.hiv, row.syphilis_tppa].some((s) => s.status === 'warning');
      if (statusFilter === 'positive') return [row.hbsag, row.hcvab].some((s) => s.status === 'positive');
      return true;
    });
  }, [rows, search, zoneFilter, statusFilter]);

  const stats = useMemo(() => {
    const overdueCount = rows.filter((row) => [row.hbsag, row.hcvab, row.hiv, row.syphilis_tppa].some((s) => s.status === 'overdue')).length;
    const warningCount = rows.filter((row) => [row.hbsag, row.hcvab, row.hiv, row.syphilis_tppa].some((s) => s.status === 'warning')).length;
    const positiveCount = rows.filter((row) => [row.hbsag, row.hcvab].some((s) => s.status === 'positive')).length;
    return { overdueCount, warningCount, positiveCount, total: rows.length };
  }, [rows]);

  const handleCreate = async () => {
    const values = await form.validateFields();
    const testDate = dayjs(values.test_date).format('YYYY-MM-DD');
    const payload = [
      { test_type: 'hbsag', result: values.hbsag, test_date: testDate, notes: values.notes },
      { test_type: 'hcvab', result: values.hcvab, test_date: testDate, notes: values.notes },
      { test_type: 'hiv', result: values.hiv, test_date: testDate, notes: values.notes },
      { test_type: 'syphilis_tppa', result: values.syphilis_tppa, test_date: testDate, notes: values.notes },
      { test_type: 'chest_xray', result: values.chest_xray, test_date: testDate, notes: values.notes },
    ];
    await infectionApi.createScreenings(values.patient_id, payload);
    message.success('筛查结果已保存');
    setShowModal(false);
    form.resetFields();
    await loadSummary();
  };

  const handleSaveMonitoring = async () => {
    if (!canWriteMonitoring) {
      message.error('当前角色无感染监测写入权限');
      return;
    }
    const values = await monitorForm.validateFields();
    setMonitorSaving(true);
    try {
      await infectionApi.saveMonitoring({
        patient_id: values.patient_id,
        monitor_year: monitorMonth.year(),
        monitor_month: monitorMonth.month() + 1,
        catheter_days: values.catheter_days,
        infection_status: values.infection_status,
        notes: values.notes,
      });
      message.success('感染监测数据已保存');
      monitorForm.resetFields();
      await loadMonitoring(monitorMonth);
    } finally {
      setMonitorSaving(false);
    }
  };

  return (
    <PageShell fullWidth>
      <div className="grid-4" style={{ marginBottom: 20 }}>
        <div className="hd-stat-card red"><div className="hd-stat-label">阳性患者</div><div className="hd-stat-value num">{stats.positiveCount}</div></div>
        <div className="hd-stat-card amber"><div className="hd-stat-label">复查超期</div><div className="hd-stat-value num">{stats.overdueCount}</div></div>
        <div className="hd-stat-card blue"><div className="hd-stat-label">即将到期</div><div className="hd-stat-value num">{stats.warningCount}</div></div>
        <div className="hd-stat-card teal"><div className="hd-stat-label">在透患者</div><div className="hd-stat-value num">{stats.total}</div></div>
      </div>

      <Tabs
        defaultActiveKey="screening"
        items={[
          {
            key: 'screening',
            label: '筛查状态总览',
            children: (
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Space wrap>
                  <Input placeholder="搜索患者姓名" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 220 }} allowClear />
                  <Select
                    placeholder="筛选分区"
                    allowClear
                    value={zoneFilter || undefined}
                    onChange={(v) => setZoneFilter(v || '')}
                    style={{ width: 160 }}
                    options={Object.entries(ZONE_LABEL).map(([value, label]) => ({ value, label }))}
                  />
                  <Select
                    placeholder="筛选状态"
                    allowClear
                    value={statusFilter || undefined}
                    onChange={(v) => setStatusFilter(v || '')}
                    style={{ width: 180 }}
                    options={[
                      { value: 'overdue', label: '已超期' },
                      { value: 'warning', label: '即将到期' },
                      { value: 'positive', label: '阳性' },
                    ]}
                  />
                  {canWriteScreening && <Button type="primary" onClick={() => setShowModal(true)}>录入筛查结果</Button>}
                  <Button onClick={() => void loadSummary()} loading={loading}>刷新</Button>
                </Space>

                {canViewOverdue && (
                  <Card size="small" title="超期筛查提醒（后端汇总）">
                    <OverdueSummary />
                  </Card>
                )}

                <Card>
                  <Table
                    rowKey="key"
                    loading={loading}
                    dataSource={filteredRows}
                    pagination={{ pageSize: 15 }}
                    columns={[
                      { title: '患者', render: (_, r) => `${r.patientName}${r.age ? `（${r.age}岁）` : ''}` },
                      { title: '隔离分区', render: (_, r) => ZONE_LABEL[r.zone] || r.zone },
                      { title: 'HBsAg', render: (_, r) => <ScreeningCell item={r.hbsag} /> },
                      { title: '抗-HCV', render: (_, r) => <ScreeningCell item={r.hcvab} /> },
                      { title: '抗-HIV', render: (_, r) => <ScreeningCell item={r.hiv} /> },
                      { title: '梅毒', render: (_, r) => <ScreeningCell item={r.syphilis_tppa} /> },
                    ]}
                  />
                </Card>
              </Space>
            ),
          },
          {
            key: 'monitoring',
            label: '感染监测（月度导管日）',
            children: (
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Space wrap>
                  <DatePicker picker="month" value={monitorMonth} onChange={(v) => v && setMonitorMonth(v)} />
                  <Button onClick={() => void loadMonitoring(monitorMonth)} loading={monitoringLoading}>刷新</Button>
                </Space>

                <Card title="监测记录">
                  <Table
                    rowKey="id"
                    loading={monitoringLoading}
                    dataSource={monitoringRows}
                    pagination={{ pageSize: 12 }}
                    columns={[
                      { title: '患者', dataIndex: 'patient_name' },
                      { title: '导管天数', dataIndex: 'catheter_days' },
                      { title: '感染状态', dataIndex: 'infection_status' },
                      { title: '备注', dataIndex: 'notes' },
                    ]}
                  />
                </Card>

                <Card title="录入/更新监测">
                  <Form form={monitorForm} layout="inline">
                    <Form.Item name="patient_id" rules={[{ required: true, message: '请选择患者' }]}>
                      <Select
                        placeholder="患者"
                        showSearch
                        style={{ width: 220 }}
                        optionFilterProp="label"
                        options={rows.map((r) => ({ value: r.patientId, label: r.patientName }))}
                      />
                    </Form.Item>
                    <Form.Item name="catheter_days" rules={[{ required: true, message: '请输入导管天数' }]}>
                      <InputNumber placeholder="导管天数" min={0} max={31} />
                    </Form.Item>
                    <Form.Item name="infection_status" initialValue="none">
                      <Select style={{ width: 160 }} options={MONITOR_STATUS_OPTIONS} />
                    </Form.Item>
                    <Form.Item name="notes">
                      <Input placeholder="备注" style={{ width: 280 }} />
                    </Form.Item>
                    <Button type="primary" onClick={() => void handleSaveMonitoring()} loading={monitorSaving} disabled={!canWriteMonitoring}>
                      保存监测
                    </Button>
                  </Form>
                </Card>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title="录入传染病筛查结果"
        open={showModal}
        onCancel={() => setShowModal(false)}
        onOk={() => void handleCreate()}
        okButtonProps={{ disabled: !canWriteScreening }}
        destroyOnClose
      >
        <Form form={form} layout="vertical" initialValues={{ test_date: dayjs(), hbsag: 'negative', hcvab: 'negative', hiv: 'negative', syphilis_tppa: 'negative', chest_xray: 'normal' }}>
          <Form.Item label="患者" name="patient_id" rules={[{ required: true, message: '请选择患者' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={rows.map((r) => ({ value: r.patientId, label: r.patientName }))}
            />
          </Form.Item>
          <Form.Item label="检测日期" name="test_date" rules={[{ required: true, message: '请选择检测日期' }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="HBsAg" name="hbsag" rules={[{ required: true }]}>
            <Select options={[{ value: 'negative', label: '阴性' }, { value: 'positive', label: '阳性' }]} />
          </Form.Item>
          <Form.Item label="抗-HCV" name="hcvab" rules={[{ required: true }]}>
            <Select options={[{ value: 'negative', label: '阴性' }, { value: 'positive', label: '阳性' }]} />
          </Form.Item>
          <Form.Item label="抗-HIV" name="hiv" rules={[{ required: true }]}>
            <Select options={[{ value: 'negative', label: '阴性' }, { value: 'positive', label: '阳性' }]} />
          </Form.Item>
          <Form.Item label="梅毒（TPPA）" name="syphilis_tppa" rules={[{ required: true }]}>
            <Select options={[{ value: 'negative', label: '阴性' }, { value: 'positive', label: '阳性' }]} />
          </Form.Item>
          <Form.Item label="胸片" name="chest_xray" rules={[{ required: true }]}>
            <Select options={[{ value: 'normal', label: '正常' }, { value: 'abnormal', label: '异常' }]} />
          </Form.Item>
          <Form.Item label="备注" name="notes">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </PageShell>
  );
}

function OverdueSummary() {
  const [list, setList] = useState<Array<{ patient_id: string; name: string; screen_type: string | null; screen_date: string | null }>>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      try {
        const res = await infectionApi.listOverdue();
        setList(res.data.data || []);
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, []);

  return (
    <Table
      rowKey={(row) => `${row.patient_id}-${row.screen_type || 'none'}`}
      size="small"
      loading={loading}
      dataSource={list}
      pagination={{ pageSize: 5 }}
      columns={[
        { title: '患者', dataIndex: 'name' },
        { title: '筛查项目', dataIndex: 'screen_type', render: (v) => v || '未筛查' },
        { title: '最近日期', dataIndex: 'screen_date', render: (v) => v || '-' },
      ]}
    />
  );
}
