/**
 * 血管通路管理页
 * 主要作用：维护患者 AVF/AVG/导管等通路档案及 CVC 风险评分展示。
 * 主要功能：按患者切换；通路列表与表单；对接 vascular API。
 */
import { useState } from 'react';
import { Card, Select, Button, Table, Tabs, Modal, Form, Input, DatePicker, InputNumber, message } from 'antd';
import { PlusOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import PageShell from '../../components/PageShell/PageShell';

const PATIENTS = [
  { value: 'zhang', label: '张国华', access: 'AVF', zone: 'normal' },
  { value: 'liu',   label: '刘明远', access: 'LTCC', zone: 'normal' },
  { value: 'wang',  label: '王建军', access: 'AVF', zone: 'hbv' },
  { value: 'zhao',  label: '赵丽萍', access: 'AVF', zone: 'normal' },
  { value: 'sun',   label: '孙红梅', access: 'AVG', zone: 'normal' },
];

type AvfAssessment = {
  key: string;
  date: string;
  bloodflow: string;
  pulsation?: string;
  thrill?: string;
  bruit?: string;
  inner_diameter_mm?: number;
  skin_depth_mm?: number;
  armRaiseTest?: string;
  pulsationEnhancementTest?: string;
  skin?: string;
  result: string;
  doctor: string;
};

type CvcAssessment = {
  key: string;
  date: string;
  bloodflow: string;
  blood_return_status?: string;
  draw_volume?: string;
  lock_clot_status?: string;
  skin?: string;
  fixation?: string;
  result: string;
  doctor: string;
};

type AvfAssessFormValues = {
  date: dayjs.Dayjs;
  bloodflow: number;
  pulsation?: string;
  thrill?: string;
  bruit?: string;
  inner_diameter_mm?: number;
  skin_depth_mm?: number;
  armRaiseTest?: string;
  pulsationEnhancementTest?: string;
  skin?: string;
  result: string;
};

type CvcAssessFormValues = {
  date: dayjs.Dayjs;
  bloodflow: number;
  blood_return_status: string;
  arterial_draw_volume: number;
  venous_draw_volume: number;
  lock_clot_status: string;
  skin: string;
  fixation: string;
  result: string;
  intervention_notes?: string;
};

type AssessFormValues = AvfAssessFormValues | CvcAssessFormValues;

type AccessDetail = {
  current: { type: string; side: string; method: string; startDate: string; bloodflow: number; status: string; cathStatus?: string };
  assessments: Array<AvfAssessment | CvcAssessment>;
  punctures: { key: string; date: string; nurse: string; arterial: string; venous: string; attempts: string; result: string; note: string }[];
  cvcRisk?: { diabetesMellitus: boolean; immunosuppressed: boolean; recentHospitalization: boolean; catheterDaysOver90: boolean; previousCrbsi: boolean; poorHygiene: boolean };
};

const ACCESS_DETAIL: Record<string, {
  current: AccessDetail['current'];
  assessments: AccessDetail['assessments'];
  punctures: AccessDetail['punctures'];
  cvcRisk?: AccessDetail['cvcRisk'];
}> = {
  zhang: {
    current: { type: 'AVF', side: '左前臂', method: '绳梯穿刺', startDate: '2021-03-20', bloodflow: 820, status: '功能良好' },
    assessments: [
      { key: '1', date: '2026-03-01', bloodflow: '820 mL/min', thrill: '震颤有力', bruit: '杂音清晰', skin: '正常', result: '功能良好', doctor: '任计阁' },
      { key: '2', date: '2025-11-15', bloodflow: '780 mL/min', thrill: '震颤有力', bruit: '杂音清晰', skin: '正常', result: '功能良好', doctor: '任计阁' },
      { key: '3', date: '2025-08-10', bloodflow: '750 mL/min', thrill: '震颤有力', bruit: '杂音清晰', skin: '正常', result: '功能良好', doctor: '任计阁' },
    ],
    punctures: [
      { key: '1', date: '2026-03-19', nurse: '杨晨', arterial: '距吻合口8cm', venous: '距吻合口18cm', attempts: '1针', result: '成功', note: '—' },
      { key: '2', date: '2026-03-17', nurse: '陈燕', arterial: '距吻合口9cm', venous: '距吻合口20cm', attempts: '1针', result: '成功', note: '—' },
      { key: '3', date: '2026-03-15', nurse: '杨晨', arterial: '距吻合口8cm', venous: '距吻合口19cm', attempts: '2针', result: '二次穿刺', note: '血管稍硬，第一针未回血' },
    ],
  },
  liu: {
    current: { type: 'LTCC', side: '右颈内静脉', method: 'LTCC隧道导管', startDate: '2020-06-15', bloodflow: 260, status: '功能良好', cathStatus: '留置350天' },
    assessments: [
      {
        key: '1',
        date: '2026-02-15',
        bloodflow: '260 mL/min',
        blood_return_status: '通畅',
        draw_volume: '动约2mL/静约2mL',
        lock_clot_status: '无凝血块',
        skin: '入口处干燥清洁',
        fixation: '固定良好',
        result: '功能良好',
        doctor: '任计阁',
      },
    ],
    punctures: [],
    cvcRisk: { diabetesMellitus: true, immunosuppressed: false, recentHospitalization: false, catheterDaysOver90: true, previousCrbsi: false, poorHygiene: false },
  },
};

function calcCvcRisk(factors: Record<string, boolean>) {
  let score = 0;
  if (factors.diabetesMellitus) score += 2;
  if (factors.immunosuppressed) score += 2;
  if (factors.recentHospitalization) score += 1;
  if (factors.catheterDaysOver90) score += 2;
  if (factors.previousCrbsi) score += 3;
  if (factors.poorHygiene) score += 1;
  return { score, risk: score >= 6 ? 'high' : score >= 3 ? 'medium' : 'low' };
}

const CVC_RISK_FACTORS = [
  { key: 'diabetesMellitus',     label: '糖尿病', score: 2 },
  { key: 'immunosuppressed',     label: '免疫抑制', score: 2 },
  { key: 'recentHospitalization', label: '近期住院', score: 1 },
  { key: 'catheterDaysOver90',   label: '留管 > 90 天', score: 2 },
  { key: 'previousCrbsi',        label: '既往 CRBSI', score: 3 },
  { key: 'poorHygiene',          label: '卫生依从性差', score: 1 },
];

const ACCESS_TYPE_MAP: Record<string, { label: string; colorClass: string; bg: string; color: string }> = {
  AVF:  { label: '自体动静脉内瘘 AVF', colorClass: 'avf', bg: '#ECFDF5', color: '#059669' },
  AVG:  { label: '人工血管内瘘 AVG',   colorClass: 'avg', bg: '#EFF6FF', color: '#2563EB' },
  TCC:  { label: '临时导管 TCC',       colorClass: 'tcc', bg: '#FFFBEB', color: '#D97706' },
  LTCC: { label: '长期隧道导管 LTCC',  colorClass: 'ltcc', bg: '#FAF5FF', color: '#7C3AED' },
  NCC:  { label: '无涤纶套导管 NCC',   colorClass: 'tcc',  bg: '#FFF7ED', color: '#C2410C' },
};

const RESULT_STYLE: Record<string, { bg: string; color: string }> = {
  '成功':    { bg: '#ECFDF5', color: '#059669' },
  '二次穿刺': { bg: '#FFFBEB', color: '#D97706' },
  '穿刺困难': { bg: '#FFF1F2', color: '#BE123C' },
};

export default function VascularAccessPage() {
  const [selectedPatient, setSelectedPatient] = useState('zhang');
  const [showAssessModal, setShowAssessModal] = useState(false);
  const [assessForm] = Form.useForm();
  const [accessDetailState, setAccessDetailState] = useState(ACCESS_DETAIL);
  const navigate = useNavigate();

  const detail = accessDetailState[selectedPatient];
  const patientInfo = PATIENTS.find(p => p.value === selectedPatient);
  const accessType = patientInfo?.access || 'AVF';
  const typeConfig = ACCESS_TYPE_MAP[accessType];
  const isCVC = ['TCC', 'LTCC', 'NCC'].includes(accessType);

  const cvcRiskData = detail?.cvcRisk;
  const riskResult = cvcRiskData ? calcCvcRisk(cvcRiskData) : null;
  const riskStyle = riskResult
    ? riskResult.risk === 'high' ? { label: '高风险', color: '#BE123C', bg: '#FFF1F2' }
    : riskResult.risk === 'medium' ? { label: '中风险', color: '#D97706', bg: '#FFFBEB' }
    : { label: '低风险', color: '#059669', bg: '#ECFDF5' }
    : null;

  if (!detail) {
    return (
      <PageShell fullWidth>
        <div className="flex items-center" style={{ marginBottom: 16, gap: 12 }}>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>返回</Button>
        </div>
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px 0' }}>
          暂无该患者的血管通路数据
        </div>
      </PageShell>
    );
  }

  const assessmentColumns = isCVC
    ? [
      { title: '评估日期', dataIndex: 'date' },
      { title: '血流量', dataIndex: 'bloodflow', render: (v: string) => <span className="num">{v}</span> },
      { title: '回血通畅情况', dataIndex: 'blood_return_status' },
      { title: '回抽量(动/静)', dataIndex: 'draw_volume' },
      { title: '封管液凝血块', dataIndex: 'lock_clot_status' },
      {
        title: '入口皮肤/导管固定',
        dataIndex: 'skin',
        render: (_v: string, row: CvcAssessment) => `${row.skin || '—'} / ${row.fixation || '—'}`,
      },
      {
        title: '综合评估',
        dataIndex: 'result',
        render: (v: string) => <span style={{ color: '#059669', fontWeight: 500 }}>{v}</span>,
      },
      { title: '评估医生', dataIndex: 'doctor' },
    ]
    : [
      { title: '评估日期', dataIndex: 'date' },
      { title: '自然血流量', dataIndex: 'bloodflow', render: (v: string) => <span className="num">{v}</span> },
      { title: '搏动', dataIndex: 'pulsation', render: (v?: string) => v || '—' },
      { title: '震颤', dataIndex: 'thrill', render: (v?: string) => v || '—' },
      { title: '杂音', dataIndex: 'bruit', render: (v?: string) => v || '—' },
      { title: '内径(mm)', dataIndex: 'inner_diameter_mm', render: (v?: number) => (typeof v === 'number' ? `${v}` : '—') },
      { title: '距皮深度(mm)', dataIndex: 'skin_depth_mm', render: (v?: number) => (typeof v === 'number' ? `${v}` : '—') },
      { title: '抬臂试验', dataIndex: 'armRaiseTest', render: (v?: string) => v || '—' },
      { title: '搏动增强试验', dataIndex: 'pulsationEnhancementTest', render: (v?: string) => v || '—' },
      { title: '皮肤/穿刺点部位', dataIndex: 'skin', render: (v?: string) => v || '—' },
      {
        title: '综合评估',
        dataIndex: 'result',
        render: (v: string) => <span style={{ color: '#059669', fontWeight: 500 }}>{v}</span>,
      },
      { title: '评估医生', dataIndex: 'doctor' },
    ];

  const punctureColumns = [
    { title: '日期', dataIndex: 'date' },
    { title: '穿刺护士', dataIndex: 'nurse' },
    { title: '动脉针位置', dataIndex: 'arterial' },
    { title: '静脉针位置', dataIndex: 'venous' },
    { title: '穿刺次数', dataIndex: 'attempts' },
    {
      title: '结果',
      dataIndex: 'result',
      render: (v: string) => {
        const s = RESULT_STYLE[v] || { bg: '#F1F5F9', color: '#64748B' };
        return <span style={{ background: s.bg, color: s.color, padding: '2px 8px', borderRadius: 20, fontSize: 12, fontWeight: 500 }}>{v}</span>;
      },
    },
    { title: '备注', dataIndex: 'note', render: (v: string) => <span className="text-sm text-muted">{v}</span> },
  ];

  return (
    <PageShell fullWidth>
      <div className="flex items-center" style={{ marginBottom: 16, gap: 12 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>返回</Button>
      </div>
      {/* 患者选择 */}
      <Card style={{ marginBottom: 20, border: '1px solid #DBEAFE' }} styles={{ body: { padding: '16px 20px' } }}>
        <div className="flex items-center gap-16">
          <div>
            <div style={{ fontSize: 12, color: '#7B92BC', marginBottom: 4 }}>选择患者</div>
            <Select
              value={selectedPatient}
              onChange={setSelectedPatient}
              options={PATIENTS.map(p => ({ value: p.value, label: `${p.label} — ${p.access}` }))}
              style={{ width: 260 }}
              showSearch
            />
          </div>
          <div style={{ background: typeConfig.bg, color: typeConfig.color, padding: '5px 14px', borderRadius: 20, fontWeight: 500, border: `1px solid ${typeConfig.bg}` }}>
            🫀 {typeConfig.label}
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Button icon={<PlusOutlined />} onClick={() => { assessForm.resetFields(); setShowAssessModal(true); }}>录入评估</Button>
          </div>
        </div>
      </Card>

      {/* 通路详情 */}
      <div className={`hd-vascular-card ${detail.current.type.toLowerCase().replace('ltcc', 'ltcc')}`} style={{ marginBottom: 20 }}>
        <div className="flex justify-between items-center" style={{ marginBottom: 16 }}>
          <div>
            <span style={{ background: typeConfig.bg, color: typeConfig.color, padding: '4px 12px', borderRadius: 20, fontSize: 13, fontWeight: 500, border: `1px solid ${typeConfig.bg}` }}>
              {typeConfig.label} — 当前使用
            </span>
          </div>
          <span style={{ background: '#ECFDF5', color: '#059669', padding: '3px 9px', borderRadius: 20, fontSize: 12, fontWeight: 500 }}>
            {detail.current.status}
          </span>
        </div>
        <div className="grid-4" style={{ gap: 16 }}>
          <div>
            <div style={{ fontSize: 12, color: '#7B92BC', marginBottom: 3 }}>位置/侧别</div>
            <div style={{ fontWeight: 600 }}>{detail.current.side}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: '#7B92BC', marginBottom: 3 }}>{isCVC ? '置管方式' : '穿刺方法'}</div>
            <div style={{ fontWeight: 600 }}>{detail.current.method}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: '#7B92BC', marginBottom: 3 }}>建立/置管日期</div>
            <div style={{ fontWeight: 600 }} className="num">{detail.current.startDate}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: '#7B92BC', marginBottom: 3 }}>{isCVC ? '血流量（上次）' : '近期血流量'}</div>
            <div style={{ fontWeight: 700, color: '#0284C7' }} className="num">{detail.current.bloodflow} mL/min</div>
          </div>
          {isCVC && detail.current.cathStatus && (
            <div>
              <div style={{ fontSize: 12, color: '#7B92BC', marginBottom: 3 }}>导管状态</div>
              <div style={{ fontWeight: 600, color: '#D97706' }}>{detail.current.cathStatus}</div>
            </div>
          )}
        </div>
      </div>

      <Tabs
        items={[
          {
            key: 'assessment',
            label: '📊 定期评估记录',
            children: (
              <Card style={{ border: '1px solid #DBEAFE' }} styles={{ body: { padding: 0 } }}>
                <Table dataSource={detail.assessments} columns={assessmentColumns} size="small" pagination={false} />
              </Card>
            ),
          },
          ...(!isCVC ? [{
            key: 'puncture',
            label: '🩹 穿刺记录',
            children: (
              <Card style={{ border: '1px solid #DBEAFE' }} styles={{ body: { padding: 0 } }}
                extra={<Button size="small" type="primary">录入穿刺记录</Button>}>
                <Table dataSource={detail.punctures} columns={punctureColumns} size="small" pagination={false} />
              </Card>
            ),
          }] : []),
          ...(isCVC && cvcRiskData ? [{
            key: 'cvc_risk',
            label: '⚠️ CVC感染风险评分',
            children: (
              <div className="grid-2" style={{ gap: 20 }}>
                <Card title="🏥 风险因素评估" size="small" style={{ border: '1px solid #DBEAFE' }}
                  styles={{ header: { background: '#FAFCFF', borderBottom: '1px solid #DBEAFE' } }}>
                  {CVC_RISK_FACTORS.map(f => {
                    const isChecked = cvcRiskData[f.key as keyof typeof cvcRiskData];
                    return (
                      <div key={f.key} className="flex items-center justify-between" style={{ padding: '8px 0', borderBottom: '1px solid #DBEAFE' }}>
                        <div className="flex items-center gap-8">
                          <span style={{ color: isChecked ? '#BE123C' : '#6EE7B7', fontSize: 14 }}>{isChecked ? '✓' : '✗'}</span>
                          <span style={{ color: isChecked ? '#0D1B3E' : '#7B92BC', fontWeight: isChecked ? 500 : 400 }}>{f.label}</span>
                        </div>
                        <span style={{ color: isChecked ? '#BE123C' : '#7B92BC', fontWeight: 600 }} className="num">
                          {isChecked ? `+${f.score}` : '0'}
                        </span>
                      </div>
                    );
                  })}
                </Card>
                {riskResult && riskStyle && (
                  <Card title="📊 风险评估结果" size="small" style={{ border: '1px solid #DBEAFE' }}
                    styles={{ header: { background: '#FAFCFF', borderBottom: '1px solid #DBEAFE' } }}>
                    <div style={{ textAlign: 'center', padding: '20px 0' }}>
                      <div style={{ fontSize: 12, color: '#7B92BC', marginBottom: 8 }}>综合风险评分</div>
                      <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 48, fontWeight: 700, color: riskStyle.color, lineHeight: 1 }}>
                        {riskResult.score}
                      </div>
                      <div style={{ fontSize: 12, color: '#7B92BC', marginBottom: 16 }}>分（满分11分）</div>
                      <div style={{ background: riskStyle.bg, color: riskStyle.color, padding: '10px 20px', borderRadius: 8, fontSize: 16, fontWeight: 700 }}>
                        {riskStyle.label}
                      </div>
                    </div>
                    <div style={{ marginTop: 16, padding: 12, background: '#F0F9FF', borderRadius: 6, border: '1px solid #BAE6FD', fontSize: 12.5, lineHeight: 1.8 }}>
                      <div style={{ fontWeight: 600, color: '#0369A1', marginBottom: 4 }}>📋 处置建议</div>
                      {riskResult.risk === 'high' && <div>高风险：建议加强每日导管护理，考虑预防性应用抗生素，密切监测感染指征，评估拔管可能性。</div>}
                      {riskResult.risk === 'medium' && <div>中风险：加强导管护理与观察，每次透析前评估出口部位，记录渗液/红肿变化。</div>}
                      {riskResult.risk === 'low' && <div>低风险：按常规护理流程操作，保持出口部位清洁干燥。</div>}
                    </div>
                  </Card>
                )}
              </div>
            ),
          }] : []),
        ]}
      />

      {/* 录入评估弹窗 */}
      <Modal
        title="录入血管通路评估"
        open={showAssessModal}
        onOk={async () => {
          const values = (await assessForm.validateFields()) as unknown as AssessFormValues;
          const dateStr = dayjs(values.date).format('YYYY-MM-DD');
          const recordBase = {
            key: String(Date.now()),
            date: dateStr,
            bloodflow: `${values.bloodflow} mL/min`,
            doctor: '—',
            result: values.result,
          };

          const newAssessment: AvfAssessment | CvcAssessment = isCVC
            ? (() => {
              const cvcValues = values as CvcAssessFormValues;
              return {
                ...recordBase,
                blood_return_status: cvcValues.blood_return_status,
                draw_volume: `动约${cvcValues.arterial_draw_volume}mL/静约${cvcValues.venous_draw_volume}mL`,
                lock_clot_status: cvcValues.lock_clot_status,
                skin: cvcValues.skin,
                fixation: cvcValues.fixation,
                // 如果填写了处置/建议，就并入综合评估结论（便于后续追溯）
                result: cvcValues.intervention_notes ? `${cvcValues.result}；${cvcValues.intervention_notes}` : cvcValues.result,
              };
            })()
            : (() => {
              const avfValues = values as AvfAssessFormValues;
              return {
                ...recordBase,
                pulsation: avfValues.pulsation,
                thrill: avfValues.thrill,
                bruit: avfValues.bruit,
                inner_diameter_mm: avfValues.inner_diameter_mm,
                skin_depth_mm: avfValues.skin_depth_mm,
                armRaiseTest: avfValues.armRaiseTest,
                pulsationEnhancementTest: avfValues.pulsationEnhancementTest,
                skin: avfValues.skin,
              };
            })();

          setAccessDetailState(prev => {
            const existing = prev[selectedPatient];
            return {
              ...prev,
              [selectedPatient]: {
                ...existing,
                assessments: [newAssessment, ...(existing.assessments || [])],
              },
            };
          });

          setShowAssessModal(false);
          assessForm.resetFields();
          message.success('评估记录已保存');
        }}
        onCancel={() => { setShowAssessModal(false); assessForm.resetFields(); }}
        okText="保存评估"
        cancelText="取消"
        width={560}
      >
        <Form form={assessForm} layout="vertical" size="middle" style={{ marginTop: 16 }}>
          <div className="grid-2" style={{ gap: 16 }}>
            <Form.Item
              label="评估日期"
              name="date"
              initialValue={dayjs()}
              rules={[{ required: true, message: '请选择评估日期' }]}
            >
              <DatePicker
                style={{ width: '100%' }}
                disabledDate={(current) => !!current && current > dayjs().endOf('day')}
              />
            </Form.Item>
            <Form.Item
              label={isCVC ? '血流量 (mL/min)' : '自然血流量（mL/min）'}
              name="bloodflow"
              rules={[{ required: true, message: isCVC ? '请输入血流量' : '请输入自然血流量' }]}
              help={isCVC ? undefined : '规程要点：自然血流量 > 500 mL/min'}
            >
              <InputNumber style={{ width: '100%' }} min={0} />
            </Form.Item>
          </div>

          {isCVC ? (
            <>
              <Form.Item
                label="回血通畅情况"
                name="blood_return_status"
                rules={[{ required: true, message: '请选择回血通畅情况' }]}
                initialValue="通畅"
              >
                <Select
                  options={[
                    { value: '通畅', label: '通畅' },
                    { value: '轻度阻力', label: '轻度阻力' },
                    { value: '不通畅', label: '不通畅' },
                  ]}
                />
              </Form.Item>

              <div className="grid-2" style={{ gap: 16 }}>
                <Form.Item
                  label="动脉端回抽量 (mL)"
                  name="arterial_draw_volume"
                  rules={[{ required: true, message: '请输入动脉端回抽量' }]}
                  initialValue={2}
                >
                  <InputNumber style={{ width: '100%' }} min={0} step={0.1} />
                </Form.Item>
                <Form.Item
                  label="静脉端回抽量 (mL)"
                  name="venous_draw_volume"
                  rules={[{ required: true, message: '请输入静脉端回抽量' }]}
                  initialValue={2}
                >
                  <InputNumber style={{ width: '100%' }} min={0} step={0.1} />
                </Form.Item>
              </div>

              <Form.Item
                label="封管液凝血块"
                name="lock_clot_status"
                rules={[{ required: true, message: '请选择封管液凝血块情况' }]}
                initialValue="无凝血块"
              >
                <Select
                  options={[
                    { value: '无凝血块', label: '无凝血块' },
                    { value: '少量', label: '少量' },
                    { value: '明显', label: '明显' },
                  ]}
                />
              </Form.Item>

              <div className="grid-2" style={{ gap: 16 }}>
                <Form.Item
                  label="导管入口处皮肤/分泌物"
                  name="skin"
                  rules={[{ required: true, message: '请选择皮肤/分泌物情况' }]}
                  initialValue="入口干燥清洁"
                >
                  <Select
                    options={[
                      { value: '入口干燥清洁', label: '入口干燥清洁' },
                      { value: '红肿', label: '红肿' },
                      { value: '渗出/分泌物', label: '渗出/分泌物' },
                    ]}
                  />
                </Form.Item>
                <Form.Item
                  label="导管固定情况"
                  name="fixation"
                  rules={[{ required: true, message: '请选择导管固定情况' }]}
                  initialValue="固定良好"
                >
                  <Select
                    options={[
                      { value: '固定良好', label: '固定良好' },
                      { value: '固定松动', label: '固定松动' },
                      { value: '脱出/移位', label: '脱出/移位' },
                    ]}
                  />
                </Form.Item>
              </div>

              <Form.Item
                label="综合评估结论"
                name="result"
                rules={[{ required: true, message: '请输入综合评估结论' }]}
              >
                <Input placeholder="如：功能良好 / 需关注 / 建议处理" />
              </Form.Item>

              <Form.Item
                label="处置/建议（如出现凝血块或回抽不畅需填写）"
                name="intervention_notes"
                dependencies={['lock_clot_status', 'blood_return_status']}
                rules={[
                  ({ getFieldValue }) => ({
                    validator: (_, value) => {
                      const lockClot = getFieldValue('lock_clot_status');
                      const bloodReturn = getFieldValue('blood_return_status');
                      const needs = (lockClot && lockClot !== '无凝血块') || bloodReturn === '不通畅';
                      if (!needs) return Promise.resolve();
                      if (!value || !String(value).trim()) return Promise.reject(new Error('请填写处置/建议'));
                      return Promise.resolve();
                    },
                  }),
                ]}
              >
                <Input.TextArea rows={3} placeholder="如：暂停使用并通知医生；查找原因并按规程处理封管液/导管。" />
              </Form.Item>
            </>
          ) : (
            <>
              <div className="grid-2" style={{ gap: 16 }}>
                <Form.Item
                  label="搏动"
                  name="pulsation"
                  rules={[{ required: true, message: '请选择搏动情况' }]}
                  initialValue="轻柔（易压迫）"
                >
                  <Select
                    options={[
                      { value: '轻柔（易压迫）', label: '轻柔（易压迫）' },
                      { value: '强度增强（有力）', label: '强度增强（有力）' },
                    ]}
                  />
                </Form.Item>
                <Form.Item
                  label="震颤"
                  name="thrill"
                  rules={[{ required: true, message: '请选择震颤情况' }]}
                  initialValue="弥漫、柔和"
                >
                  <Select
                    options={[
                      { value: '弥漫、柔和', label: '弥漫、柔和' },
                      { value: '局限、增强', label: '局限、增强' },
                    ]}
                  />
                </Form.Item>
                <Form.Item
                  label="杂音"
                  name="bruit"
                  rules={[{ required: true, message: '请选择杂音情况' }]}
                  initialValue="弥漫连续、低调"
                >
                  <Select
                    options={[
                      { value: '弥漫连续、低调', label: '弥漫连续、低调' },
                      { value: '局限不连续、高调', label: '局限不连续、高调' },
                    ]}
                  />
                </Form.Item>
                <Form.Item
                  label="抬臂试验"
                  name="armRaiseTest"
                  rules={[{ required: true, message: '请选择抬臂试验结果' }]}
                  initialValue="正常塌陷"
                >
                  <Select
                    options={[
                      { value: '正常塌陷', label: '正常塌陷' },
                      { value: '异常（近心端塌陷、远心端扩张）', label: '异常（近心端塌陷、远心端扩张）' },
                    ]}
                  />
                </Form.Item>
              </div>
              <div className="grid-2" style={{ gap: 16 }}>
                <Form.Item label="内径（mm）" name="inner_diameter_mm" help="规程要点：内径 >= 5mm">
                  <InputNumber style={{ width: '100%' }} min={0} step={0.1} />
                </Form.Item>
                <Form.Item label="距皮深度（mm）" name="skin_depth_mm" help="规程要点：距皮深度 < 5mm">
                  <InputNumber style={{ width: '100%' }} min={0} step={0.1} />
                </Form.Item>
              </div>
              <Form.Item
                label="搏动增强试验"
                name="pulsationEnhancementTest"
                rules={[{ required: true, message: '请选择搏动增强试验结果' }]}
                initialValue="增强（远心端搏动增强）"
              >
                <Select
                  options={[
                    { value: '增强（远心端搏动增强）', label: '增强（远心端搏动增强）' },
                    { value: '不明显/异常', label: '不明显/异常' },
                  ]}
                />
              </Form.Item>
              <Form.Item
                label="皮肤/穿刺点部位"
                name="skin"
                rules={[{ required: true, message: '请填写皮肤/穿刺点部位情况' }]}
              >
                <Input placeholder="如：颜色/温度正常；无肿胀疼痛/破溃（按规程要点记录）" />
              </Form.Item>
              <Form.Item
                label="综合评估结论"
                name="result"
                rules={[{ required: true, message: '请输入综合评估结论' }]}
              >
                <Select
                  options={[
                    { value: '功能良好', label: '功能良好' },
                    { value: '需关注', label: '需关注' },
                    { value: '建议进一步检查', label: '建议进一步检查' },
                    { value: '建议介入/手术', label: '建议介入/手术' },
                  ]}
                />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>
    </PageShell>
  );
}
