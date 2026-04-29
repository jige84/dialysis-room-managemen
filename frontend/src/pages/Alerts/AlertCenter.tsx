/**
 * 预警中心页
 * 对接 alertsApi 真实 API，severity 使用 emergency/critical/warning/info。
 */
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Card, Button, Select, Input, Modal, Form, message, Spin } from 'antd';
import { SearchOutlined, CheckOutlined, ReloadOutlined } from '@ant-design/icons';
import PageShell from '../../components/PageShell/PageShell';
import { useLocation } from 'react-router-dom';
import alertsApi, { type AlertItem, type AlertSummary } from '../../api/alerts';
import AnomalyAnalysisModal from '../../components/AnomalyAnalysisModal/AnomalyAnalysisModal';
import { alertTypeToAnomaly, type AnomalyType } from '../../utils/anomalyAnalysis';

const LEVEL_CONFIG: Record<string, { label: string; icon: string; color: string; bg: string; border: string }> = {
  emergency: { label: '急危重症', icon: '⚡', color: '#BE123C', bg: '#FFF1F2', border: '#F43F5E' },
  critical:  { label: '危急值',   icon: '🔴', color: '#C2410C', bg: '#FFFBEB', border: '#F59E0B' },
  warning:   { label: '警告',     icon: '🟡', color: '#1D4ED8', bg: '#EEF2FF', border: '#6366F1' },
  info:      { label: '信息提示', icon: 'ℹ️',  color: '#059669', bg: '#ECFDF5', border: '#10B981' },
};

const STATUS_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  active:     { label: '未处理', color: '#BE123C', bg: '#FFF1F2' },
  handled:    { label: '已处理', color: '#059669', bg: '#ECFDF5' },
  dismissed:  { label: '已忽略', color: '#D97706', bg: '#FFFBEB' },
  auto_closed:{ label: '自动关闭', color: '#7B92BC', bg: '#F1F5F9' },
};

const CATEGORY_LABEL: Record<string, string> = {
  lab_critical: '检验危急值',
  low_ktv: 'Kt/V持续偏低',
  infection_screening_due: '感染筛查到期',
  lab_review_due: '化验复查到期',
  vascular_assessment_due: '通路评估到期',
  ultrafiltration_exceed: '超滤量超限',
  nurse_ratio: '护患比超标',
  dry_weight_overdue: '干体重评估超期',
  cvc_high_risk: 'CVC高危',
  buttonhole_monitor: '扣眼穿刺监测',
  cqi_quarterly: 'CQI季度提醒',
  machine_alarm: '设备报警',
  water_alarm: '水处理报警',
  disinfection_alarm: '消毒相关报警',
};

export default function AlertCenterPage() {
  const location = useLocation();
  const [loading, setLoading] = useState(false);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [summary, setSummary] = useState<AlertSummary>({ total: 0, emergency: 0, critical: 0, warning: 0, info: 0 });

  const [severityFilter, setSeverityFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [search, setSearch] = useState('');
  const [handleModal, setHandleModal] = useState<AlertItem | null>(null);
  const [handleForm] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const urgentSectionRef = useRef<HTMLDivElement | null>(null);
  const normalSectionRef = useRef<HTMLDivElement | null>(null);

  const [anomalyOpen, setAnomalyOpen] = useState(false);
  const [anomalyCtx, setAnomalyCtx] = useState<{
    patientId: string;
    anomalyType: AnomalyType;
    contextId?: string;
    patientName?: string;
  } | null>(null);

  const openAnomalyForAlert = (a: AlertItem) => {
    if (!a.patient_id) return;
    setAnomalyCtx({
      patientId: a.patient_id,
      anomalyType: alertTypeToAnomaly(a.alert_type),
      contextId: a.id,
      patientName: a.patient_name ?? undefined,
    });
    setAnomalyOpen(true);
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const sev = params.get('severity');
    const st = params.get('status');
    const cat = params.get('category');
    const q = params.get('q');
    queueMicrotask(() => {
      if (sev) setSeverityFilter(sev);
      if (st) setStatusFilter(st);
      if (cat) setCategoryFilter(cat);
      if (q) setSearch(q);
    });
  }, [location.search]);

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const [listRes, summaryRes] = await Promise.all([
        alertsApi.list({
          severity: severityFilter || undefined,
          status: statusFilter || 'all',
          type: categoryFilter || undefined,
          page_size: 200,
        }),
        alertsApi.summary(),
      ]);
      setAlerts(listRes.data.data?.data ?? []);
      setSummary(summaryRes.data.data ?? { total: 0, emergency: 0, critical: 0, warning: 0, info: 0 });
    } catch {
      message.error('加载预警数据失败');
    } finally {
      setLoading(false);
    }
  }, [severityFilter, statusFilter, categoryFilter]);

  useEffect(() => { fetchAlerts(); }, [fetchAlerts]);

  const filtered = useMemo(() => alerts.filter(a => {
    if (search && !(a.patient_name ?? '').includes(search) && !a.title.includes(search)) return false;
    return true;
  }), [alerts, search]);

  const emergencies = filtered.filter(a => a.severity === 'emergency');
  const criticals = filtered.filter(a => a.severity === 'critical');
  const warnings = filtered.filter(a => a.severity === 'warning');
  const infos = filtered.filter(a => a.severity === 'info');

  const handleAck = (a: AlertItem) => setHandleModal(a);

  const scrollToSection = (target: 'urgent' | 'normal') => {
    window.setTimeout(() => {
      const el = target === 'urgent' ? urgentSectionRef.current : normalSectionRef.current;
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  };

  const handleSummaryCardClick = (severity: string, target: 'urgent' | 'normal') => {
    setSeverityFilter(severity);
    setStatusFilter('active');
    scrollToSection(target);
  };

  const confirmHandle = async () => {
    if (!handleModal) return;
    try {
      const values = await handleForm.validateFields();
      setSubmitting(true);
      await alertsApi.ack(handleModal.id, {
        handle_notes: values.action,
        new_status: values.status,
      });
      setHandleModal(null);
      handleForm.resetFields();
      message.success('预警已处理');
      fetchAlerts();
    } catch {
      message.error('处理失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PageShell fullWidth>
      {/* 概览 */}
      <div className="grid-4" style={{ marginBottom: 20 }}>
        <div className="hd-stat-card red" role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => handleSummaryCardClick('emergency', 'urgent')}>
          <div className="hd-stat-icon">⚡</div>
          <div className="hd-stat-label">急危重症</div>
          <div className="hd-stat-value num" style={{ color: '#BE123C' }}>{summary.emergency}</div>
          <div className="hd-stat-meta">需立即处理</div>
        </div>
        <div className="hd-stat-card amber" role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => handleSummaryCardClick('critical', 'urgent')}>
          <div className="hd-stat-icon">🔴</div>
          <div className="hd-stat-label">危急值</div>
          <div className="hd-stat-value num" style={{ color: '#C2410C' }}>{summary.critical}</div>
          <div className="hd-stat-meta">今日处理</div>
        </div>
        <div className="hd-stat-card blue" role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => handleSummaryCardClick('warning', 'normal')}>
          <div className="hd-stat-icon">🟡</div>
          <div className="hd-stat-label">警告</div>
          <div className="hd-stat-value num" style={{ color: '#1D4ED8' }}>{summary.warning}</div>
          <div className="hd-stat-meta">近期处理</div>
        </div>
        <div className="hd-stat-card teal" role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => handleSummaryCardClick('', 'urgent')}>
          <div className="hd-stat-icon">✅</div>
          <div className="hd-stat-label">未处理总数</div>
          <div className="hd-stat-value num">{summary.total}</div>
          <div className="hd-stat-meta">需关注处理</div>
        </div>
      </div>

      {/* 筛选栏 */}
      <div className="flex gap-8 items-center" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
        <Input prefix={<SearchOutlined style={{ color: '#7B92BC' }} />}
          placeholder="搜索患者姓名 / 预警内容…"
          value={search} onChange={e => setSearch(e.target.value)}
          style={{ width: 240, borderColor: '#DBEAFE' }} allowClear />
        <Select placeholder="全部级别" value={severityFilter || undefined}
          onChange={v => setSeverityFilter(v || '')} style={{ width: 130 }} allowClear
          options={[
            { value: 'emergency', label: '⚡ 急危重症' },
            { value: 'critical', label: '🔴 危急值' },
            { value: 'warning', label: '🟡 警告' },
            { value: 'info', label: 'ℹ️ 信息提示' },
          ]} />
        <Select placeholder="全部类别" value={categoryFilter || undefined}
          onChange={v => setCategoryFilter(v || '')} style={{ width: 140 }} allowClear
          options={Object.entries(CATEGORY_LABEL).map(([k, v]) => ({ value: k, label: v }))} />
        <div className="flex gap-4">
          {['', 'active', 'handled', 'dismissed'].map(s => (
            <Button key={s} size="small" type={statusFilter === s ? 'primary' : 'default'}
              onClick={() => setStatusFilter(s)}>
              {s === '' ? '全部' : STATUS_LABEL[s]?.label}
            </Button>
          ))}
        </div>
        <Button icon={<ReloadOutlined />} onClick={fetchAlerts}>刷新</Button>
      </div>

      {/* 双栏分级展示 */}
      <Spin spinning={loading}>
        <div className="grid-2" style={{ gap: 20 }}>
          <div ref={urgentSectionRef}>
            {[...emergencies, ...criticals].length === 0 ? (
              <Card style={{ border: '1px solid #DBEAFE', textAlign: 'center', padding: '40px 20px' }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>✅</div>
                <div style={{ color: '#7B92BC' }}>暂无急危重症或危急值预警</div>
              </Card>
            ) : (
              <Card title={<span style={{ fontWeight: 600, color: '#BE123C' }}>⚡ 急危重症 & 危急值</span>}
                style={{ border: '1px solid #FECDD3' }}
                styles={{ header: { background: '#FFF1F2', borderBottom: '1px solid #FECDD3' } }}>
                {[...emergencies, ...criticals].map(a => (
                  <AlertCard key={a.id} alert={a} onHandle={handleAck} onAnalyze={openAnomalyForAlert} />
                ))}
              </Card>
            )}
          </div>
          <div ref={normalSectionRef}>
            {[...warnings, ...infos].length === 0 ? (
              <Card style={{ border: '1px solid #DBEAFE', textAlign: 'center', padding: '40px 20px' }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>✅</div>
                <div style={{ color: '#7B92BC' }}>暂无警告或信息提醒</div>
              </Card>
            ) : (
              <Card title={<span style={{ fontWeight: 600, color: '#1D4ED8' }}>🟡 警告 & 信息提示</span>}
                style={{ border: '1px solid #C7D2FE' }}
                styles={{ header: { background: '#EEF2FF', borderBottom: '1px solid #C7D2FE' } }}>
                {[...warnings, ...infos].map(a => (
                  <AlertCard key={a.id} alert={a} onHandle={handleAck} onAnalyze={openAnomalyForAlert} />
                ))}
              </Card>
            )}
          </div>
        </div>
      </Spin>

      {/* 处理弹窗 */}
      <Modal title="处理预警" open={!!handleModal}
        onOk={confirmHandle} confirmLoading={submitting}
        onCancel={() => { setHandleModal(null); handleForm.resetFields(); }}
        okText="确认处理" cancelText="取消" width={480}>
        {handleModal && (
          <div>
            <div style={{ marginBottom: 16, padding: 14, background: LEVEL_CONFIG[handleModal.severity]?.bg, border: `1.5px solid ${LEVEL_CONFIG[handleModal.severity]?.border}`, borderRadius: 8 }}>
              <div style={{ fontWeight: 600, color: LEVEL_CONFIG[handleModal.severity]?.color, marginBottom: 4 }}>
                {LEVEL_CONFIG[handleModal.severity]?.icon} {handleModal.title}
              </div>
              <div style={{ fontSize: 12.5, color: '#3D5280' }}>{handleModal.message}</div>
              <div style={{ fontSize: 11.5, color: '#7B92BC', marginTop: 4 }}>
                患者：{handleModal.patient_name ?? '—'} · {handleModal.created_at?.slice(0, 16)}
              </div>
            </div>
            <Form form={handleForm} layout="vertical">
              <Form.Item label="处理措施" name="action" rules={[{ required: true, message: '请填写处理措施' }]}>
                <Input.TextArea rows={3} placeholder="请描述您的处理措施…" />
              </Form.Item>
              <Form.Item label="处理状态" name="status" initialValue="handled" rules={[{ required: true }]}>
                <Select options={[
                  { value: 'handled', label: '已处理' },
                  { value: 'dismissed', label: '已忽略/无需处理' },
                ]} />
              </Form.Item>
            </Form>
          </div>
        )}
      </Modal>

      {anomalyCtx ? (
        <AnomalyAnalysisModal
          open={anomalyOpen}
          onClose={() => setAnomalyOpen(false)}
          patientId={anomalyCtx.patientId}
          anomalyType={anomalyCtx.anomalyType}
          contextId={anomalyCtx.contextId}
          patientLabel={anomalyCtx.patientName}
        />
      ) : null}
    </PageShell>
  );
}

function AlertCard({
  alert,
  onHandle,
  onAnalyze,
}: {
  alert: AlertItem;
  onHandle: (a: AlertItem) => void;
  onAnalyze?: (a: AlertItem) => void;
}) {
  const cfg = LEVEL_CONFIG[alert.severity] ?? LEVEL_CONFIG.info;
  const sCfg = STATUS_LABEL[alert.status] ?? STATUS_LABEL.active;

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12,
      padding: 14, borderRadius: 6, marginBottom: 10,
      background: cfg.bg, borderLeft: `4px solid ${cfg.border}`,
      opacity: alert.status !== 'active' ? 0.6 : 1,
    }}>
      <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>{cfg.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="flex items-center gap-6" style={{ marginBottom: 3 }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: '#0D1B3E' }}>{alert.title}</span>
          <span style={{ background: sCfg.bg, color: sCfg.color, padding: '1px 7px', borderRadius: 20, fontSize: 11, fontWeight: 500, flexShrink: 0 }}>
            {sCfg.label}
          </span>
        </div>
        <div style={{ fontSize: 12.5, color: '#3D5280', marginBottom: 3 }}>{alert.message}</div>
        <div style={{ fontSize: 11.5, color: '#7B92BC' }}>
          {alert.patient_name && <span>患者：{alert.patient_name} · </span>}
          ⏱ {alert.created_at?.slice(0, 16)}
        </div>
      </div>
      {alert.status === 'active' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
          {alert.patient_id && onAnalyze ? (
            <Button size="small" onClick={() => onAnalyze(alert)}>
              分析
            </Button>
          ) : null}
          <Button size="small" icon={<CheckOutlined />} onClick={() => onHandle(alert)}>
            处理
          </Button>
        </div>
      )}
    </div>
  );
}
