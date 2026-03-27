import { useState } from 'react';
import { Card, Select, Button, Table, Tabs, Modal, Form, Input, DatePicker, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import PageShell from '../../components/PageShell/PageShell';

const PATIENTS = [
  { value: 'zhang', label: '张国华', access: 'AVF', zone: 'normal' },
  { value: 'liu',   label: '刘明远', access: 'LTCC', zone: 'normal' },
  { value: 'wang',  label: '王建军', access: 'AVF', zone: 'hbv' },
  { value: 'zhao',  label: '赵丽萍', access: 'AVF', zone: 'normal' },
  { value: 'sun',   label: '孙红梅', access: 'AVG', zone: 'normal' },
];

const ACCESS_DETAIL: Record<string, {
  current: { type: string; side: string; method: string; startDate: string; bloodflow: number; status: string; cathStatus?: string };
  assessments: { key: string; date: string; bloodflow: string; thrill: string; bruit: string; skin: string; result: string; doctor: string }[];
  punctures: { key: string; date: string; nurse: string; arterial: string; venous: string; attempts: string; result: string; note: string }[];
  cvcRisk?: { diabetesMellitus: boolean; immunosuppressed: boolean; recentHospitalization: boolean; catheterDaysOver90: boolean; previousCrbsi: boolean; poorHygiene: boolean };
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
      { key: '1', date: '2026-02-15', bloodflow: '260 mL/min', thrill: '—', bruit: '—', skin: '出口处干燥清洁', result: '功能良好', doctor: '任计阁' },
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

  const detail = ACCESS_DETAIL[selectedPatient];
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
      <PageShell>
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px 0' }}>暂无该患者的血管通路数据</div>
      </PageShell>
    );
  }

  const assessmentColumns = [
    { title: '评估日期', dataIndex: 'date' },
    { title: '血流量', dataIndex: 'bloodflow', render: (v: string) => <span className="num">{v}</span> },
    { title: '震颤', dataIndex: 'thrill' },
    { title: '杂音', dataIndex: 'bruit' },
    { title: '皮肤/导管出口', dataIndex: 'skin' },
    { title: '综合评估', dataIndex: 'result', render: (v: string) => <span style={{ color: '#059669', fontWeight: 500 }}>{v}</span> },
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
            <Button icon={<PlusOutlined />} onClick={() => setShowAssessModal(true)}>录入评估</Button>
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
        onOk={() => assessForm.validateFields().then(() => { setShowAssessModal(false); assessForm.resetFields(); message.success('评估记录已保存'); })}
        onCancel={() => { setShowAssessModal(false); assessForm.resetFields(); }}
        okText="保存评估"
        cancelText="取消"
        width={560}
      >
        <Form form={assessForm} layout="vertical" size="middle" style={{ marginTop: 16 }}>
          <div className="grid-2" style={{ gap: 16 }}>
            <Form.Item label="评估日期" name="date" initialValue={dayjs()} rules={[{ required: true }]}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="血流量 (mL/min)" name="bloodflow" rules={[{ required: true }]}>
              <Input placeholder="如：820" />
            </Form.Item>
          </div>
          <div className="grid-2" style={{ gap: 16 }}>
            <Form.Item label="震颤" name="thrill">
              <Input placeholder="如：有力 / 减弱" />
            </Form.Item>
            <Form.Item label="杂音" name="bruit">
              <Input placeholder="如：清晰 / 粗糙" />
            </Form.Item>
          </div>
          <Form.Item label="皮肤/出口部位" name="skin">
            <Input placeholder="如：正常 / 红肿 / 渗液" />
          </Form.Item>
          <Form.Item label="综合评估结论" name="result" rules={[{ required: true }]}>
            <Input placeholder="如：功能良好 / 需关注 / 建议手术" />
          </Form.Item>
        </Form>
      </Modal>
    </PageShell>
  );
}
