/**
 * 血管通路管理页
 * 以患者为维度加载当前通路 + 评估历史 + 穿刺记录 + CVC 风险评分；
 * 评估/穿刺保存后调用后端接口落库并刷新展示。
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Card, Select, Button, Table, Tabs, Modal, Form, Input,
  DatePicker, InputNumber, message, Alert, Spin, Tag, Tooltip,
} from 'antd';
import { PlusOutlined, ArrowLeftOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PageShell from '../../components/PageShell/PageShell';
import { usePermission } from '../../utils/permission';
import { aiApi, type AiTextResult } from '../../api/ai';
import { patientsApi, type Patient } from '../../api/patients';
import vascularApi, {
  type VascularAccess, type AvfAssessment, type CvcAssessment,
  type PunctureRecord, type CVCRiskAssessment, type FactorDefinition,
  ACCESS_TYPE_LABELS, RISK_GRADE_LABELS, RISK_GRADE_COLORS,
} from '../../api/vascular';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const ACCESS_BG: Record<string, { bg: string; color: string }> = {
  avf:  { bg: '#ECFDF5', color: '#059669' },
  avg:  { bg: '#EFF6FF', color: '#2563EB' },
  ncc:  { bg: '#FFF7ED', color: '#C2410C' },
  tcc:  { bg: '#FAF5FF', color: '#7C3AED' },
};

const PUNCTURE_RESULT_STYLE: Record<string, { bg: string; color: string }> = {
  '顺利':   { bg: '#ECFDF5', color: '#059669' },
  '困难':   { bg: '#FFFBEB', color: '#D97706' },
  '失败':   { bg: '#FFF1F2', color: '#BE123C' },
};

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

function isCVCType(accessType: string) {
  return accessType === 'ncc' || accessType === 'tcc';
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

export default function VascularAccessPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const patientIdFromQuery = searchParams.get('patient_id');
  const { canUseAI, canWrite } = usePermission();

  // ---------- 患者列表 ----------
  const [patientOptions, setPatientOptions] = useState<{ value: string; label: string; access_type?: string }[]>([]);
  const [patientsLoading, setPatientsLoading] = useState(false);
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);

  // ---------- 通路数据 ----------
  const [currentAccess, setCurrentAccess] = useState<VascularAccess | null>(null);
  const [accessLoading, setAccessLoading] = useState(false);

  // ---------- 评估列表 ----------
  const [avfAssessments, setAvfAssessments] = useState<AvfAssessment[]>([]);
  const [cvcAssessments, setCvcAssessments] = useState<CvcAssessment[]>([]);
  const [assessLoading, setAssessLoading] = useState(false);

  // ---------- 穿刺记录 ----------
  const [punctures, setPunctures] = useState<PunctureRecord[]>([]);
  const [punctureLoading, setPunctureLoading] = useState(false);

  // ---------- CVC 风险评分 ----------
  const [cvcRiskHistory, setCvcRiskHistory] = useState<CVCRiskAssessment[]>([]);
  const [factorDefinitions, setFactorDefinitions] = useState<FactorDefinition[]>([]);
  const [riskLoading, setRiskLoading] = useState(false);

  // ---------- 弹窗控制 ----------
  const [showAssessModal, setShowAssessModal] = useState(false);
  const [assessSaving, setAssessSaving] = useState(false);
  const [assessForm] = Form.useForm();

  const [showPunctureModal, setShowPunctureModal] = useState(false);
  const [punctureSaving, setPunctureSaving] = useState(false);
  const [punctureForm] = Form.useForm();

  const [showCvcRiskModal, setShowCvcRiskModal] = useState(false);
  const [cvcRiskSaving, setCvcRiskSaving] = useState(false);
  const [cvcRiskForm] = Form.useForm();

  // ---------- AI 解读 ----------
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<AiTextResult | null>(null);

  // ---------------------------------------------------------------------------
  // 数据加载
  // ---------------------------------------------------------------------------

  // 加载活跃患者列表（支持从 /vascular?patient_id= 预选中患者）
  useEffect(() => {
    setPatientsLoading(true);
    patientsApi.list({ status: 'active', page: 1, page_size: 200 })
      .then(res => {
        const items = res.data.data?.list ?? [];
        setPatientOptions(items.map((p: Patient) => ({
          value: p.id,
          label: `${p.name}${p.access_type ? ` — ${String(p.access_type).toUpperCase()}` : ''}`,
          access_type: p.access_type,
        })));
        const prefer = patientIdFromQuery && items.some((p: Patient) => p.id === patientIdFromQuery)
          ? patientIdFromQuery
          : (items[0]?.id ?? null);
        setSelectedPatientId(prefer);
      })
      .catch(() => message.error('加载患者列表失败'))
      .finally(() => setPatientsLoading(false));
  }, [patientIdFromQuery]);

  // 加载当前通路
  const loadCurrentAccess = useCallback((patientId: string) => {
    setAccessLoading(true);
    setCurrentAccess(null);
    vascularApi.getCurrent(patientId)
      .then(res => setCurrentAccess(res.data.data ?? null))
      .catch(() => message.error('加载当前通路失败'))
      .finally(() => setAccessLoading(false));
  }, []);

  // 加载评估历史
  const loadAssessments = useCallback((accessId: string, type: string) => {
    setAssessLoading(true);
    if (isCVCType(type)) {
      vascularApi.getCvcAssessments(accessId)
        .then(res => setCvcAssessments(res.data.data ?? []))
        .catch(() => message.error('加载 CVC 评估记录失败'))
        .finally(() => setAssessLoading(false));
    } else {
      vascularApi.getAssessments(accessId)
        .then(res => setAvfAssessments(res.data.data ?? []))
        .catch(() => message.error('加载评估记录失败'))
        .finally(() => setAssessLoading(false));
    }
  }, []);

  // 加载穿刺记录
  const loadPunctures = useCallback((accessId: string) => {
    setPunctureLoading(true);
    vascularApi.getPunctures(accessId)
      .then(res => setPunctures(res.data.data ?? []))
      .catch(() => message.error('加载穿刺记录失败'))
      .finally(() => setPunctureLoading(false));
  }, []);

  // 加载 CVC 风险评分历史 + 因素定义
  const loadCvcRisk = useCallback((accessId: string) => {
    setRiskLoading(true);
    Promise.all([
      vascularApi.getCVCRisk(accessId),
      factorDefinitions.length === 0 ? vascularApi.getFactorDefinitions() : Promise.resolve(null),
    ])
      .then(([riskRes, defRes]) => {
        setCvcRiskHistory(riskRes.data.data ?? []);
        if (defRes) setFactorDefinitions(defRes.data.data ?? []);
      })
      .catch(() => message.error('加载 CVC 风险评分失败'))
      .finally(() => setRiskLoading(false));
  }, [factorDefinitions.length]);

  // 患者切换时级联加载
  useEffect(() => {
    if (!selectedPatientId) return;
    loadCurrentAccess(selectedPatientId);
    setAvfAssessments([]);
    setCvcAssessments([]);
    setPunctures([]);
    setCvcRiskHistory([]);
  }, [selectedPatientId, loadCurrentAccess]);

  // 通路加载完成后加载子资源
  useEffect(() => {
    if (!currentAccess) return;
    const { id, access_type } = currentAccess;
    loadAssessments(id, access_type);
    if (isCVCType(access_type)) {
      loadCvcRisk(id);
    } else {
      loadPunctures(id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentAccess?.id]);

  // ---------------------------------------------------------------------------
  // 衍生值
  // ---------------------------------------------------------------------------

  const isCVC = currentAccess ? isCVCType(currentAccess.access_type) : false;
  const typeStyle = currentAccess ? ACCESS_BG[currentAccess.access_type] : undefined;
  const typeLabel = currentAccess ? ACCESS_TYPE_LABELS[currentAccess.access_type] : '';
  const latestRisk = cvcRiskHistory[0];


  // ---------------------------------------------------------------------------
  // 保存评估
  // ---------------------------------------------------------------------------

  const handleSaveAssessment = async () => {
    if (!currentAccess) return;
    try {
      const values = await assessForm.validateFields();
      setAssessSaving(true);
      const dateStr = dayjs(values.date).format('YYYY-MM-DD');

      if (isCVC) {
        await vascularApi.addCvcAssessment(currentAccess.id, {
          assessed_at: dateStr,
          blood_flow_rate: values.blood_flow_rate,
          blood_return_status: values.blood_return_status,
          arterial_draw_volume_ml: values.arterial_draw_volume_ml,
          venous_draw_volume_ml: values.venous_draw_volume_ml,
          lock_clot_status: values.lock_clot_status,
          skin_condition: values.skin_condition,
          fixation_status: values.fixation_status,
          overall_result: values.overall_result,
          intervention_notes: values.intervention_notes,
        });
        loadAssessments(currentAccess.id, currentAccess.access_type);
      } else {
        await vascularApi.addAssessment(currentAccess.id, {
          assessed_at: dateStr,
          blood_flow_rate: values.blood_flow_rate,
          pulsation: values.pulsation,
          thrill: values.thrill,
          bruit: values.bruit,
          inner_diameter_mm: values.inner_diameter_mm,
          skin_depth_mm: values.skin_depth_mm,
          arm_raise_test: values.arm_raise_test,
          pulsation_enhancement_test: values.pulsation_enhancement_test,
          skin_condition: values.skin_condition,
          overall_result: values.overall_result,
          notes: values.notes,
        });
        loadAssessments(currentAccess.id, currentAccess.access_type);
      }

      setShowAssessModal(false);
      assessForm.resetFields();
      message.success('评估记录已保存');
    } catch {
      // validateFields 失败时不处理
    } finally {
      setAssessSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // 保存穿刺记录
  // ---------------------------------------------------------------------------

  const handleSavePuncture = async () => {
    if (!currentAccess) return;
    try {
      const values = await punctureForm.validateFields();
      setPunctureSaving(true);
      await vascularApi.addPuncture(currentAccess.id, {
        puncture_date: dayjs(values.puncture_date).format('YYYY-MM-DD'),
        arterial_site: values.arterial_site,
        venous_site: values.venous_site,
        attempts: values.attempts,
        puncture_result: values.puncture_result,
        hematoma_occurred: values.hematoma_occurred ?? false,
        notes: values.notes,
      });
      loadPunctures(currentAccess.id);
      setShowPunctureModal(false);
      punctureForm.resetFields();
      message.success('穿刺记录已保存');
    } catch {
      // validateFields 失败时不处理
    } finally {
      setPunctureSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // 保存 CVC 风险评分
  // ---------------------------------------------------------------------------

  const handleSaveCvcRisk = async () => {
    if (!currentAccess) return;
    try {
      const values = await cvcRiskForm.validateFields();
      setCvcRiskSaving(true);
      await vascularApi.addCVCRisk(currentAccess.id, {
        assessed_at: dayjs(values.assessed_at).format('YYYY-MM-DD'),
        diabetes_mellitus:      !!values.diabetes_mellitus,
        immunosuppressed:       !!values.immunosuppressed,
        recent_hospitalization: !!values.recent_hospitalization,
        catheter_days_over90:   !!values.catheter_days_over90,
        previous_crbsi:         !!values.previous_crbsi,
        poor_hygiene:           !!values.poor_hygiene,
        intervention_notes: values.intervention_notes,
      });
      loadCvcRisk(currentAccess.id);
      setShowCvcRiskModal(false);
      cvcRiskForm.resetFields();
      message.success('风险评分已保存');
    } catch {
      // validateFields 失败时不处理
    } finally {
      setCvcRiskSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // AI 解读
  // ---------------------------------------------------------------------------

  const handleCvcAiExplain = () => {
    if (!canUseAI || !latestRisk) return;
    setAiModalOpen(true);
    setAiLoading(true);
    void aiApi
      .postNlpQuery({
        query: '请解读下面这个 CVC 感染高危评分结果，并给出护理观察要点和护理建议（不要给出具体处方或具体剂量）。',
        context: {
          total_score: latestRisk.total_score,
          risk_grade:  latestRisk.risk_grade,
          risk_label:  RISK_GRADE_LABELS[latestRisk.risk_grade],
          factors: {
            diabetes_mellitus:      latestRisk.diabetes_mellitus,
            immunosuppressed:       latestRisk.immunosuppressed,
            recent_hospitalization: latestRisk.recent_hospitalization,
            catheter_days_over90:   latestRisk.catheter_days_over90,
            previous_crbsi:         latestRisk.previous_crbsi,
            poor_hygiene:           latestRisk.poor_hygiene,
          },
        },
      })
      .then(res => setAiResult(res.data.data))
      .catch(() => message.error('AI 解读失败，请稍后重试'))
      .finally(() => setAiLoading(false));
  };

  // ---------------------------------------------------------------------------
  // 表格列定义
  // ---------------------------------------------------------------------------

  const avfAssessColumns = [
    { title: '评估日期', dataIndex: 'assessed_at', width: 100 },
    { title: '血流量(mL/min)', dataIndex: 'blood_flow_rate', width: 120,
      render: (v: number) => <span className="num">{v ?? '—'}</span> },
    { title: '搏动', dataIndex: 'pulsation', render: (v?: string) => v || '—' },
    { title: '震颤', dataIndex: 'thrill', render: (v?: string) => v || '—' },
    { title: '杂音', dataIndex: 'bruit', render: (v?: string) => v || '—' },
    { title: '内径(mm)', dataIndex: 'inner_diameter_mm', width: 80,
      render: (v?: number) => v != null ? v : '—' },
    { title: '距皮深度(mm)', dataIndex: 'skin_depth_mm', width: 100,
      render: (v?: number) => v != null ? v : '—' },
    { title: '综合结论', dataIndex: 'overall_result',
      render: (v: string) => <span style={{ color: '#059669', fontWeight: 500 }}>{v}</span> },
    { title: '评估人', dataIndex: 'assessed_by_name', render: (v?: string) => v || '—' },
  ];

  const cvcAssessColumns = [
    { title: '评估日期', dataIndex: 'assessed_at', width: 100 },
    { title: '血流量(mL/min)', dataIndex: 'blood_flow_rate', width: 120,
      render: (v: number) => <span className="num">{v ?? '—'}</span> },
    { title: '回血通畅', dataIndex: 'blood_return_status', render: (v?: string) => v || '—' },
    { title: '动脉回抽(mL)', dataIndex: 'arterial_draw_volume_ml',
      render: (v?: number) => v != null ? v : '—' },
    { title: '静脉回抽(mL)', dataIndex: 'venous_draw_volume_ml',
      render: (v?: number) => v != null ? v : '—' },
    { title: '封管液凝血块', dataIndex: 'lock_clot_status', render: (v?: string) => v || '—' },
    { title: '综合结论', dataIndex: 'overall_result',
      render: (v: string) => <span style={{ color: '#059669', fontWeight: 500 }}>{v}</span> },
    { title: '评估人', dataIndex: 'assessed_by_name', render: (v?: string) => v || '—' },
  ];

  const punctureColumns = [
    { title: '日期', dataIndex: 'puncture_date', width: 100 },
    { title: '穿刺护士', dataIndex: 'nurse_name', render: (v?: string) => v || '—' },
    { title: '动脉针位置', dataIndex: 'arterial_site', render: (v?: string) => v || '—' },
    { title: '静脉针位置', dataIndex: 'venous_site', render: (v?: string) => v || '—' },
    { title: '尝试次数', dataIndex: 'attempts', width: 80 },
    {
      title: '结果', dataIndex: 'puncture_result', width: 80,
      render: (v: string) => {
        const s = PUNCTURE_RESULT_STYLE[v] || { bg: '#F1F5F9', color: '#64748B' };
        return (
          <span style={{ background: s.bg, color: s.color, padding: '2px 8px', borderRadius: 20, fontSize: 12, fontWeight: 500 }}>
            {v}
          </span>
        );
      },
    },
    {
      title: '血肿', dataIndex: 'hematoma_occurred', width: 60,
      render: (v: boolean) => v
        ? <Tag color="red" style={{ fontSize: 11 }}>有</Tag>
        : <Tag color="green" style={{ fontSize: 11 }}>无</Tag>,
    },
    { title: '备注', dataIndex: 'notes', render: (v?: string) => <span className="text-sm text-muted">{v || '—'}</span> },
  ];

  // ---------------------------------------------------------------------------
  // 渲染
  // ---------------------------------------------------------------------------

  return (
    <PageShell fullWidth>
      <div className="flex items-center" style={{ marginBottom: 16, gap: 12 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>返回</Button>
      </div>

      {/* 患者选择 */}
      <Card style={{ marginBottom: 20, border: '1px solid #DBEAFE' }} styles={{ body: { padding: '16px 20px' } }}>
        <div className="flex items-center gap-16" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: '#7B92BC', marginBottom: 4 }}>选择患者</div>
            <Select
              value={selectedPatientId}
              onChange={setSelectedPatientId}
              options={patientOptions}
              style={{ width: 280 }}
              showSearch
              loading={patientsLoading}
              filterOption={(input, opt) =>
                (opt?.label as string ?? '').toLowerCase().includes(input.toLowerCase())
              }
              placeholder="搜索患者姓名"
            />
          </div>

          {currentAccess && typeStyle && (
            <div style={{ background: typeStyle.bg, color: typeStyle.color, padding: '5px 14px', borderRadius: 20, fontWeight: 500 }}>
              {typeLabel}
            </div>
          )}

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {canWrite && currentAccess && (
              <Button
                icon={<PlusOutlined />}
                onClick={() => { assessForm.resetFields(); setShowAssessModal(true); }}
              >
                录入评估
              </Button>
            )}
            {canWrite && currentAccess && !isCVC && (
              <Button
                icon={<PlusOutlined />}
                onClick={() => { punctureForm.resetFields(); setShowPunctureModal(true); }}
              >
                录入穿刺
              </Button>
            )}
            {canWrite && currentAccess && isCVC && (
              <Button
                icon={<PlusOutlined />}
                onClick={() => { cvcRiskForm.resetFields(); setShowCvcRiskModal(true); }}
              >
                录入风险评分
              </Button>
            )}
            {selectedPatientId && (
              <Tooltip title="刷新通路数据">
                <Button icon={<ReloadOutlined />} onClick={() => selectedPatientId && loadCurrentAccess(selectedPatientId)} />
              </Tooltip>
            )}
          </div>
        </div>
      </Card>

      {/* 加载中 / 无通路提示 */}
      {accessLoading && (
        <div style={{ textAlign: 'center', padding: 32 }}><Spin /></div>
      )}

      {!accessLoading && selectedPatientId && !currentAccess && (
        <Alert type="info" showIcon message="该患者暂无活动血管通路记录" style={{ marginBottom: 20 }} />
      )}

      {/* 通路详情卡片 */}
      {currentAccess && typeStyle && (
        <Card
          style={{ marginBottom: 20, border: `1px solid ${typeStyle.bg}`, background: typeStyle.bg + '44' }}
          styles={{ body: { padding: '16px 20px' } }}
        >
          <div className="flex justify-between items-center" style={{ marginBottom: 16 }}>
            <span style={{ background: typeStyle.bg, color: typeStyle.color, padding: '4px 12px', borderRadius: 20, fontSize: 13, fontWeight: 500 }}>
              {typeLabel} — 当前使用
            </span>
            <span style={{ background: '#ECFDF5', color: '#059669', padding: '3px 9px', borderRadius: 20, fontSize: 12, fontWeight: 500 }}>
              {currentAccess.is_active ? '活动中' : '已停用'}
            </span>
          </div>
          <div className="grid-4" style={{ gap: 16 }}>
            <div>
              <div style={{ fontSize: 12, color: '#7B92BC', marginBottom: 3 }}>位置</div>
              <div style={{ fontWeight: 600 }}>{currentAccess.location}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#7B92BC', marginBottom: 3 }}>穿刺方式</div>
              <div style={{ fontWeight: 600 }}>{currentAccess.puncture_method || '—'}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#7B92BC', marginBottom: 3 }}>建立日期</div>
              <div style={{ fontWeight: 600 }} className="num">{currentAccess.established_date}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#7B92BC', marginBottom: 3 }}>最新风险评分</div>
              <div style={{ fontWeight: 700, color: '#0284C7' }} className="num">
                {currentAccess.last_risk_score != null
                  ? <Tag color={RISK_GRADE_COLORS[currentAccess.last_risk_grade ?? 1]}>
                      {currentAccess.last_risk_score}分 · {RISK_GRADE_LABELS[currentAccess.last_risk_grade ?? 1]}
                    </Tag>
                  : '—'}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* 子页签 */}
      {currentAccess && (
        <Tabs
          items={[
            {
              key: 'assessment',
              label: '📊 定期评估记录',
              children: (
                <Card style={{ border: '1px solid #DBEAFE' }} styles={{ body: { padding: 0 } }}>
                  <Spin spinning={assessLoading}>
                    <Table
                      rowKey="id"
                      dataSource={isCVC ? cvcAssessments : avfAssessments}
                      columns={isCVC ? cvcAssessColumns : avfAssessColumns}
                      size="small"
                      pagination={{ pageSize: 10, showSizeChanger: false }}
                      locale={{ emptyText: '暂无评估记录' }}
                    />
                  </Spin>
                </Card>
              ),
            },
            ...(!isCVC ? [{
              key: 'puncture',
              label: '🩹 穿刺记录',
              children: (
                <Card style={{ border: '1px solid #DBEAFE' }} styles={{ body: { padding: 0 } }}>
                  <Spin spinning={punctureLoading}>
                    <Table
                      rowKey="id"
                      dataSource={punctures}
                      columns={punctureColumns}
                      size="small"
                      pagination={{ pageSize: 10, showSizeChanger: false }}
                      locale={{ emptyText: '暂无穿刺记录' }}
                    />
                  </Spin>
                </Card>
              ),
            }] : []),
            ...(isCVC ? [{
              key: 'cvc_risk',
              label: '⚠️ CVC 感染风险评分',
              children: (
                <Spin spinning={riskLoading}>
                  {latestRisk ? (
                    <div className="grid-2" style={{ gap: 20 }}>
                      {/* 因素评分卡 */}
                      <Card
                        title="🏥 最新风险因素"
                        size="small"
                        style={{ border: '1px solid #DBEAFE' }}
                        styles={{ header: { background: '#FAFCFF', borderBottom: '1px solid #DBEAFE' } }}
                      >
                        {factorDefinitions.map(f => {
                          const isChecked = latestRisk[f.key as keyof CVCRiskAssessment] as boolean;
                          return (
                            <div key={f.key} className="flex items-center justify-between" style={{ padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
                              <div className="flex items-center" style={{ gap: 8 }}>
                                <span style={{ color: isChecked ? '#BE123C' : '#6EE7B7', fontSize: 14 }}>{isChecked ? '✓' : '✗'}</span>
                                <span style={{ color: isChecked ? '#0D1B3E' : '#7B92BC', fontWeight: isChecked ? 500 : 400 }}>{f.label}</span>
                              </div>
                              <span style={{ color: isChecked ? '#BE123C' : '#7B92BC', fontWeight: 600 }} className="num">
                                {isChecked ? `+${f.weight}` : '0'}
                              </span>
                            </div>
                          );
                        })}
                        <div style={{ fontSize: 11, color: '#7B92BC', marginTop: 8 }}>评分日期：{latestRisk.assessed_at}</div>
                      </Card>

                      {/* 综合结论卡 */}
                      <Card
                        title="📊 风险评估结果"
                        size="small"
                        style={{ border: '1px solid #DBEAFE' }}
                        styles={{ header: { background: '#FAFCFF', borderBottom: '1px solid #DBEAFE' } }}
                        extra={
                          canUseAI
                            ? <Button size="small" onClick={handleCvcAiExplain}>AI 解读</Button>
                            : null
                        }
                      >
                        <div style={{ textAlign: 'center', padding: '20px 0' }}>
                          <div style={{ fontSize: 12, color: '#7B92BC', marginBottom: 8 }}>综合风险评分</div>
                          <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 48, fontWeight: 700, color: RISK_GRADE_COLORS[latestRisk.risk_grade], lineHeight: 1 }}>
                            {latestRisk.total_score}
                          </div>
                          <div style={{ fontSize: 12, color: '#7B92BC', marginBottom: 16 }}>分（满分 11 分）</div>
                          <Tag color={RISK_GRADE_COLORS[latestRisk.risk_grade]} style={{ fontSize: 16, padding: '8px 20px', borderRadius: 8 }}>
                            {RISK_GRADE_LABELS[latestRisk.risk_grade]}
                          </Tag>
                        </div>
                        <div style={{ marginTop: 16, padding: 12, background: '#F0F9FF', borderRadius: 6, border: '1px solid #BAE6FD', fontSize: 12.5, lineHeight: 1.8 }}>
                          <div style={{ fontWeight: 600, color: '#0369A1', marginBottom: 4 }}>📋 处置建议</div>
                          {latestRisk.risk_grade === 3 && <div>高风险：建议加强每日导管护理，考虑预防性应用抗生素，密切监测感染指征，评估拔管可能性。</div>}
                          {latestRisk.risk_grade === 2 && <div>中风险：加强导管护理与观察，每次透析前评估出口部位，记录渗液/红肿变化。</div>}
                          {latestRisk.risk_grade === 1 && <div>低风险：按常规护理流程操作，保持出口部位清洁干燥。</div>}
                        </div>
                      </Card>
                    </div>
                  ) : (
                    <Alert type="info" showIcon message={'暂无 CVC 风险评分记录，点击【录入风险评分】按钮添加。'} />
                  )}
                </Spin>
              ),
            }] : []),
          ]}
        />
      )}

      {/* ============================================================
          弹窗 1：录入 AVF/AVG 评估 / CVC 评估
          ============================================================ */}
      <Modal
        title={isCVC ? '录入 CVC 导管评估' : '录入 AVF/AVG 评估'}
        open={showAssessModal}
        onOk={handleSaveAssessment}
        confirmLoading={assessSaving}
        onCancel={() => { setShowAssessModal(false); assessForm.resetFields(); }}
        okText="保存评估"
        cancelText="取消"
        width={580}
        destroyOnClose
      >
        <Form form={assessForm} layout="vertical" size="middle" style={{ marginTop: 16 }}>
          <div className="grid-2" style={{ gap: 16 }}>
            <Form.Item
              label="评估日期"
              name="date"
              initialValue={dayjs()}
              rules={[{ required: true, message: '请选择评估日期' }]}
            >
              <DatePicker style={{ width: '100%' }} disabledDate={d => !!d && d > dayjs().endOf('day')} />
            </Form.Item>
            <Form.Item
              label={isCVC ? '血流量 (mL/min)' : '自然血流量 (mL/min)'}
              name="blood_flow_rate"
              help={isCVC ? undefined : '规程：自然血流量 > 500 mL/min'}
            >
              <InputNumber style={{ width: '100%' }} min={0} />
            </Form.Item>
          </div>

          {isCVC ? (
            <>
              <Form.Item label="回血通畅情况" name="blood_return_status" rules={[{ required: true, message: '请选择' }]} initialValue="通畅">
                <Select options={[
                  { value: '通畅', label: '通畅' },
                  { value: '轻度阻力', label: '轻度阻力' },
                  { value: '不通畅', label: '不通畅' },
                ]} />
              </Form.Item>
              <div className="grid-2" style={{ gap: 16 }}>
                <Form.Item label="动脉端回抽量 (mL)" name="arterial_draw_volume_ml" rules={[{ required: true, message: '请填写' }]} initialValue={2}>
                  <InputNumber style={{ width: '100%' }} min={0} step={0.1} />
                </Form.Item>
                <Form.Item label="静脉端回抽量 (mL)" name="venous_draw_volume_ml" rules={[{ required: true, message: '请填写' }]} initialValue={2}>
                  <InputNumber style={{ width: '100%' }} min={0} step={0.1} />
                </Form.Item>
              </div>
              <Form.Item label="封管液凝血块" name="lock_clot_status" rules={[{ required: true, message: '请选择' }]} initialValue="无凝血块">
                <Select options={[
                  { value: '无凝血块', label: '无凝血块' },
                  { value: '少量', label: '少量' },
                  { value: '明显', label: '明显' },
                ]} />
              </Form.Item>
              <div className="grid-2" style={{ gap: 16 }}>
                <Form.Item label="入口处皮肤/分泌物" name="skin_condition" rules={[{ required: true, message: '请选择' }]} initialValue="干燥清洁">
                  <Select options={[
                    { value: '干燥清洁', label: '干燥清洁' },
                    { value: '红肿', label: '红肿' },
                    { value: '渗出/分泌物', label: '渗出/分泌物' },
                  ]} />
                </Form.Item>
                <Form.Item label="导管固定情况" name="fixation_status" rules={[{ required: true, message: '请选择' }]} initialValue="固定良好">
                  <Select options={[
                    { value: '固定良好', label: '固定良好' },
                    { value: '固定松动', label: '固定松动' },
                    { value: '脱出/移位', label: '脱出/移位' },
                  ]} />
                </Form.Item>
              </div>
              <Form.Item label="综合评估结论" name="overall_result" rules={[{ required: true, message: '请选择' }]}>
                <Select options={[
                  { value: '功能良好', label: '功能良好' },
                  { value: '导管功能不良', label: '导管功能不良' },
                  { value: '疑似感染', label: '疑似感染' },
                  { value: '建议换管', label: '建议换管' },
                ]} />
              </Form.Item>
              <Form.Item
                label="处置/建议"
                name="intervention_notes"
                dependencies={['lock_clot_status', 'blood_return_status']}
                rules={[({ getFieldValue }) => ({
                  validator: (_, value) => {
                    const lockClot = getFieldValue('lock_clot_status');
                    const bloodReturn = getFieldValue('blood_return_status');
                    const needNote = (lockClot && lockClot !== '无凝血块') || bloodReturn === '不通畅';
                    if (needNote && !String(value || '').trim()) {
                      return Promise.reject(new Error('出现凝血块或不通畅时必须填写处置建议'));
                    }
                    return Promise.resolve();
                  },
                })]}
              >
                <Input.TextArea rows={2} placeholder="如：按规程处理封管液；通知医生" />
              </Form.Item>
            </>
          ) : (
            <>
              <div className="grid-2" style={{ gap: 16 }}>
                <Form.Item label="搏动" name="pulsation" rules={[{ required: true }]} initialValue="轻柔（易压迫）">
                  <Select options={[
                    { value: '轻柔（易压迫）', label: '轻柔（易压迫）' },
                    { value: '强度增强（有力）', label: '强度增强（有力）' },
                  ]} />
                </Form.Item>
                <Form.Item label="震颤" name="thrill" rules={[{ required: true }]} initialValue="弥漫、柔和">
                  <Select options={[
                    { value: '弥漫、柔和', label: '弥漫、柔和' },
                    { value: '局限、增强', label: '局限、增强' },
                  ]} />
                </Form.Item>
                <Form.Item label="杂音" name="bruit" rules={[{ required: true }]} initialValue="弥漫连续、低调">
                  <Select options={[
                    { value: '弥漫连续、低调', label: '弥漫连续、低调' },
                    { value: '局限不连续、高调', label: '局限不连续、高调' },
                  ]} />
                </Form.Item>
                <Form.Item label="抬臂试验" name="arm_raise_test" rules={[{ required: true }]} initialValue="正常塌陷">
                  <Select options={[
                    { value: '正常塌陷', label: '正常塌陷' },
                    { value: '异常（近心端塌陷、远心端扩张）', label: '异常' },
                  ]} />
                </Form.Item>
              </div>
              <div className="grid-2" style={{ gap: 16 }}>
                <Form.Item label="内径 (mm)" name="inner_diameter_mm" help="规程：内径 ≥ 5mm">
                  <InputNumber style={{ width: '100%' }} min={0} step={0.1} />
                </Form.Item>
                <Form.Item label="距皮深度 (mm)" name="skin_depth_mm" help="规程：距皮深度 < 5mm">
                  <InputNumber style={{ width: '100%' }} min={0} step={0.1} />
                </Form.Item>
              </div>
              <Form.Item label="搏动增强试验" name="pulsation_enhancement_test" rules={[{ required: true }]} initialValue="增强">
                <Select options={[
                  { value: '增强（远心端搏动增强）', label: '增强（远心端搏动增强）' },
                  { value: '不明显/异常', label: '不明显/异常' },
                ]} />
              </Form.Item>
              <Form.Item label="皮肤/穿刺点" name="skin_condition" rules={[{ required: true }]}>
                <Input placeholder="如：颜色/温度正常；无肿胀疼痛/破溃" />
              </Form.Item>
              <Form.Item label="综合评估结论" name="overall_result" rules={[{ required: true }]}>
                <Select options={[
                  { value: '功能良好', label: '功能良好' },
                  { value: '需关注', label: '需关注' },
                  { value: '建议进一步检查', label: '建议进一步检查' },
                  { value: '建议介入/手术', label: '建议介入/手术' },
                ]} />
              </Form.Item>
              <Form.Item label="备注" name="notes">
                <Input.TextArea rows={2} />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>

      {/* ============================================================
          弹窗 2：录入穿刺记录
          ============================================================ */}
      <Modal
        title="录入穿刺记录"
        open={showPunctureModal}
        onOk={handleSavePuncture}
        confirmLoading={punctureSaving}
        onCancel={() => { setShowPunctureModal(false); punctureForm.resetFields(); }}
        okText="保存"
        cancelText="取消"
        width={520}
        destroyOnClose
      >
        <Form form={punctureForm} layout="vertical" size="middle" style={{ marginTop: 16 }}>
          <Form.Item label="穿刺日期" name="puncture_date" initialValue={dayjs()} rules={[{ required: true }]}>
            <DatePicker style={{ width: '100%' }} disabledDate={d => !!d && d > dayjs().endOf('day')} />
          </Form.Item>
          <div className="grid-2" style={{ gap: 16 }}>
            <Form.Item label="动脉针位置" name="arterial_site">
              <Input placeholder="如：距吻合口 8cm" />
            </Form.Item>
            <Form.Item label="静脉针位置" name="venous_site">
              <Input placeholder="如：距吻合口 18cm" />
            </Form.Item>
          </div>
          <div className="grid-2" style={{ gap: 16 }}>
            <Form.Item label="穿刺尝试次数" name="attempts" initialValue={1} rules={[{ required: true }]}>
              <InputNumber style={{ width: '100%' }} min={1} max={10} />
            </Form.Item>
            <Form.Item label="穿刺结果" name="puncture_result" rules={[{ required: true }]}>
              <Select options={[
                { value: '顺利', label: '顺利' },
                { value: '困难', label: '困难' },
                { value: '失败', label: '失败' },
              ]} />
            </Form.Item>
          </div>
          <Form.Item label="是否发生血肿" name="hematoma_occurred" initialValue={false}>
            <Select options={[
              { value: false, label: '无' },
              { value: true, label: '有' },
            ]} />
          </Form.Item>
          <Form.Item label="备注" name="notes">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      {/* ============================================================
          弹窗 3：录入 CVC 风险评分
          ============================================================ */}
      <Modal
        title="录入 CVC 感染风险评分"
        open={showCvcRiskModal}
        onOk={handleSaveCvcRisk}
        confirmLoading={cvcRiskSaving}
        onCancel={() => { setShowCvcRiskModal(false); cvcRiskForm.resetFields(); }}
        okText="保存评分"
        cancelText="取消"
        width={520}
        destroyOnClose
      >
        <Form form={cvcRiskForm} layout="vertical" size="middle" style={{ marginTop: 16 }}>
          <Form.Item label="评估日期" name="assessed_at" initialValue={dayjs()} rules={[{ required: true }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <div style={{ padding: '8px 0', fontWeight: 500, marginBottom: 8 }}>风险因素（勾选存在的因素）</div>
          {factorDefinitions.map(f => (
            <Form.Item key={f.key} name={f.key} valuePropName="checked" initialValue={false} style={{ marginBottom: 8 }}>
              <div className="flex items-center justify-between" style={{ padding: '6px 12px', background: '#F8FAFF', borderRadius: 6, border: '1px solid #DBEAFE' }}>
                <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={!!cvcRiskForm.getFieldValue(f.key)}
                    onChange={e => cvcRiskForm.setFieldValue(f.key, e.target.checked)}
                  />
                  <span>{f.label}</span>
                </label>
                <span style={{ color: '#7B92BC', fontSize: 12 }} className="num">+{f.weight} 分</span>
              </div>
            </Form.Item>
          ))}
          <Form.Item label="干预措施/备注" name="intervention_notes">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      {/* ============================================================
          弹窗 4：AI 解读 CVC 风险
          ============================================================ */}
      <Modal
        title="AI 解读：CVC 感染高危评分"
        open={aiModalOpen}
        onCancel={() => setAiModalOpen(false)}
        footer={null}
        width={640}
      >
        {aiLoading && (
          <div style={{ textAlign: 'center', padding: 24 }}>
            <Spin /><div style={{ marginTop: 8, color: '#7B92BC' }}>AI 解读中，请稍候…</div>
          </div>
        )}
        {!aiLoading && aiResult && (
          <>
            <div style={{ whiteSpace: 'pre-wrap', marginBottom: 16, lineHeight: 1.8 }}>
              {aiResult.content}
            </div>
            <Alert
              type="info"
              showIcon
              message={aiResult.ai_disclaimer || '本内容由AI生成，仅供医护人员参考，不构成医疗诊断建议。'}
            />
          </>
        )}
      </Modal>
    </PageShell>
  );
}
