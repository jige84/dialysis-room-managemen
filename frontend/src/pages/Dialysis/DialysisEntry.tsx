import { useState, useCallback } from 'react';
import { Form, Input, InputNumber, Select, Button, Checkbox, DatePicker, message, Alert, Radio } from 'antd';
import { SaveOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import PageShell from '../../components/PageShell/PageShell';

// ── 演示数据 ──────────────────────────────────────────────
const PATIENTS_LIST = [
  {
    value: 'zhang',
    label: '张国华 — 男/56岁/AVF/下午班/5号机',
    dryWeight: 62.0,
    prescription: { bloodFlow: 250, duration: 4.0, dialysateFlow: 500, anticoagulant: '普通肝素 首剂3000IU', dialyzer: 'FX80（高通量）', na: 138, k: 2.0, ca: 1.5 },
    preAssessment: { sbp: 140, dbp: 80, pulse: 78, temp: 36.5, shift: '下午班', machineNo: '5号机' },
  },
  {
    value: 'zhao',
    label: '赵丽萍 — 女/48岁/AVF/下午班/6号机',
    dryWeight: 52.0,
    prescription: { bloodFlow: 230, duration: 4.0, dialysateFlow: 500, anticoagulant: '低分子肝素', dialyzer: 'FX60（低通量）', na: 138, k: 2.0, ca: 1.5 },
    preAssessment: { sbp: 136, dbp: 76, pulse: 82, temp: 36.6, shift: '下午班', machineNo: '6号机' },
  },
  {
    value: 'liu',
    label: '刘明远 — 男/65岁/LTCC/下午班/7号机',
    dryWeight: 50.0,
    prescription: { bloodFlow: 220, duration: 4.0, dialysateFlow: 500, anticoagulant: '普通肝素 首剂3000IU', dialyzer: 'FX80（高通量）', na: 140, k: 2.0, ca: 1.5 },
    preAssessment: { sbp: 145, dbp: 82, pulse: 84, temp: 36.7, shift: '下午班', machineNo: '7号机' },
  },
];

const COMPLICATIONS = [
  { value: 'hypotension',   label: '低血压',     emergency: false },
  { value: 'cramp',         label: '肌肉痉挛',   emergency: false },
  { value: 'nausea',        label: '恶心/呕吐',  emergency: false },
  { value: 'headache',      label: '头痛',       emergency: false },
  { value: 'fever',         label: '发热/寒战',  emergency: false },
  { value: 'pruritus',      label: '皮肤瘙痒',   emergency: false },
  { value: 'coagulation',   label: '体外循环凝血', emergency: false },
  { value: 'air_embolism',  label: '空气栓塞',   emergency: true },
  { value: 'blood_leak',    label: '透析器漏血',  emergency: true },
  { value: 'hemolysis',     label: '急性溶血',   emergency: true },
];

const PENDING_ORDERS = [
  { key: '1', drug: '重组人促红素注射液 6000 IU', detail: '皮下注射 · tiw · 今日应执行', executed: false },
  { key: '2', drug: '蔗糖铁注射液 200mg', detail: '静脉输注（透析中）· qw · 上次 2026-03-12', executed: false },
];

type VitalSignRow = {
  id: string;
  time: string;
  values: Record<string, string>;
};

function createVitalSignRow(): VitalSignRow {
  const now = dayjs();
  return {
    id: `vital-${now.valueOf()}-${Math.random().toString(36).slice(2, 7)}`,
    time: now.format('HH:mm:ss'),
    values: {},
  };
}

// ── Daugirdas II 公式 ────────────────────────────────────
function calcKtv(preBun: number, postBun: number, t: number, uf: number, postWeight: number): number | null {
  if (!preBun || !postBun || postBun >= preBun) return null;
  if (t < 1 || t > 8 || postWeight < 20 || postWeight > 200) return null;
  if (uf < 0 || uf > 10) return null;
  const R = postBun / preBun;
  const ktv = -Math.log(R - 0.008 * t) + (4 - 3.5 * R) * (uf / postWeight);
  return Math.round(ktv * 100) / 100;
}

function calcUrr(preBun: number, postBun: number): number | null {
  if (!preBun || !postBun || postBun >= preBun) return null;
  return Math.round((1 - postBun / preBun) * 100);
}

// ── 表单区块标题 ──────────────────────────────────────────
function SectionHeader({ icon, title }: { icon: string; title: string }) {
  return (
    <div className="hd-form-section-header">
      <span>{icon}</span>
      <span>{title}</span>
    </div>
  );
}

// ── 主组件 ──────────────────────────────────────────────────
export default function DialysisEntryPage() {
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  const [selectedPatient, setSelectedPatient] = useState<string>('');
  const [prescription, setPrescription] = useState<typeof PATIENTS_LIST[0]['prescription'] | null>(null);
  const [preAssessment, setPreAssessment] = useState<typeof PATIENTS_LIST[0]['preAssessment'] | null>(null);
  const [dryWeight, setDryWeight] = useState<number | null>(null);

  const [preWeight, setPreWeight] = useState<number | null>(null);
  const [postWeight, setPostWeight] = useState<number | null>(null);
  const [durationHours, setDurationHours] = useState<number | null>(null);
  const [preBun, setPreBun] = useState<number | null>(null);
  const [postBun, setPostBun] = useState<number | null>(null);

  const [complications, setComplications] = useState<string[]>([]);
  const [orders, setOrders] = useState<Record<string, boolean>>({});
  const [vitalRows, setVitalRows] = useState<VitalSignRow[]>([createVitalSignRow()]);

  const handlePatientChange = useCallback((val: string) => {
    setSelectedPatient(val);
    const p = PATIENTS_LIST.find(p => p.value === val);
    if (p) {
      setPrescription(p.prescription);
      setPreAssessment(p.preAssessment);
      setDryWeight(p.dryWeight);
      setDurationHours(p.prescription.duration);
    }
  }, [form]);

  // 计算超滤量
  const computedUF = preWeight && postWeight ? Math.round((preWeight - postWeight) * 1000) : null;
  const ufToUse = computedUF;
  const ufPercent = dryWeight && ufToUse ? ((ufToUse / (dryWeight * 1000)) * 100).toFixed(1) : null;
  const ufAlert = ufPercent ? parseFloat(ufPercent) > 5 : false;

  // Kt/V 计算
  const ktv = preBun && postBun && durationHours && postWeight
    ? calcKtv(preBun, postBun, durationHours, (ufToUse ?? 0) / 1000, postWeight)
    : null;
  const urr = preBun && postBun ? calcUrr(preBun, postBun) : null;
  const ktvAdequate = ktv !== null ? ktv >= 1.2 : null;
  const urrAdequate = urr !== null ? urr >= 65 : null;

  const handleVitalChange = (rowId: string, field: string, val: string) => {
    setVitalRows(prev => prev.map(row => (
      row.id === rowId
        ? { ...row, values: { ...row.values, [field]: val } }
        : row
    )));
  };

  const handleAddVitalRow = () => {
    setVitalRows(prev => [...prev, createVitalSignRow()]);
  };

  const handleRemoveVitalRow = (rowId: string) => {
    setVitalRows(prev => {
      if (prev.length <= 1) {
        message.warning('至少保留 1 条生命体征记录');
        return prev;
      }
      return prev.filter(row => row.id !== rowId);
    });
  };

  const handleOrderToggle = (key: string, checked: boolean) => {
    setOrders(prev => ({ ...prev, [key]: checked }));
  };

  const handleSubmit = async () => {
    if (!selectedPatient) { message.warning('请先选择患者'); return; }
    if (!preWeight) { message.warning('请填写透析前体重'); return; }
    const hasUnsignedVitalRow = vitalRows.some(row => !row.values.signature?.trim());
    if (hasUnsignedVitalRow) {
      message.warning('透析中生命体征记录每行都需要护士签名');
      return;
    }
    setLoading(true);
    try {
      await new Promise(r => setTimeout(r, 800));
      message.success('透析记录已保存，Kt/V已计算并记录');
      navigate('/dashboard');
    } finally {
      setLoading(false);
    }
  };
  const autoGeneratedDate = dayjs().format('YYYY年M月D日');

  return (
    <PageShell fullWidth>
      {/* 顶部操作栏 */}
      <div className="flex items-center justify-between" style={{ marginBottom: 20 }}>
        <div className="flex items-center gap-12">
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>返回</Button>
          <div>
            <div style={{ fontWeight: 600, fontSize: 15, color: '#0D1B3E' }}>录入透析记录</div>
            <div style={{ fontSize: 12, color: '#7B92BC' }}>{dayjs().format('YYYY年MM月DD日 dddd')}</div>
          </div>
        </div>
        <Button type="primary" icon={<SaveOutlined />} loading={loading} onClick={handleSubmit}>
          保存透析记录
        </Button>
      </div>

      <Form form={form} layout="vertical" size="middle">

        {/* ① 患者选择 + 基本信息 */}
        <div className="hd-form-section">
          <SectionHeader icon="👤" title="患者选择" />
          <div style={{ padding: 20 }}>
            <div className="grid-2" style={{ gap: 20 }}>
              <Form.Item label="选择患者" required style={{ marginBottom: 0 }}>
                <Select
                  placeholder="请选择患者…"
                  value={selectedPatient || undefined}
                  onChange={handlePatientChange}
                  options={PATIENTS_LIST.map(p => ({ value: p.value, label: p.label }))}
                  style={{ width: '100%' }}
                  showSearch
                />
              </Form.Item>
              <Form.Item label="透析日期" required style={{ marginBottom: 0 }}>
                <DatePicker defaultValue={dayjs()} style={{ width: '100%' }} format="YYYY-MM-DD" />
              </Form.Item>
            </div>
            {prescription && (
              <div style={{ marginTop: 16, padding: 16, background: '#F8FAFC', borderRadius: 8, border: '1px solid #DBEAFE' }}>
                <div style={{ fontWeight: 700, color: '#1D4ED8', marginBottom: 10 }}>
                  📋 当前生效透析处方（自动导入，仅查看不可修改）
                </div>
                <div className="grid-4" style={{ gap: 12 }}>
                  <div style={{ fontSize: 13, color: '#334155' }}>血流速：<strong>{prescription.bloodFlow} mL/min</strong></div>
                  <div style={{ fontSize: 13, color: '#334155' }}>标准时长：<strong>{prescription.duration} h</strong></div>
                  <div style={{ fontSize: 13, color: '#334155' }}>透析液流速：<strong>{prescription.dialysateFlow} mL/min</strong></div>
                  <div style={{ fontSize: 13, color: '#334155' }}>透析器：<strong>{prescription.dialyzer}</strong></div>
                  <div style={{ fontSize: 13, color: '#334155' }}>抗凝方案：<strong>{prescription.anticoagulant}</strong></div>
                  <div style={{ fontSize: 13, color: '#334155' }}>干体重目标：<strong>{dryWeight} kg</strong></div>
                  <div style={{ fontSize: 13, color: '#334155' }}>透析液 Na：<strong>{prescription.na} mmol/L</strong></div>
                  <div style={{ fontSize: 13, color: '#334155' }}>透析液 K/Ca：<strong>{prescription.k} / {prescription.ca} mmol/L</strong></div>
                </div>
              </div>
            )}
            {preAssessment && (
              <div style={{ marginTop: 12, padding: 16, background: '#F8FAFC', borderRadius: 8, border: '1px solid #DBEAFE' }}>
                <div style={{ fontWeight: 700, color: '#1D4ED8', marginBottom: 10 }}>
                  📊 透前评估（来自处方，仅查看不可修改）
                </div>
                <div className="grid-4" style={{ gap: 12 }}>
                  <div style={{ fontSize: 13, color: '#334155' }}>透前收缩压：<strong>{preAssessment.sbp} mmHg</strong></div>
                  <div style={{ fontSize: 13, color: '#334155' }}>透前舒张压：<strong>{preAssessment.dbp} mmHg</strong></div>
                  <div style={{ fontSize: 13, color: '#334155' }}>透前脉搏：<strong>{preAssessment.pulse} 次/分</strong></div>
                  <div style={{ fontSize: 13, color: '#334155' }}>透前体温：<strong>{preAssessment.temp} ℃</strong></div>
                  <div style={{ fontSize: 13, color: '#334155' }}>班次：<strong>{preAssessment.shift}</strong></div>
                  <div style={{ fontSize: 13, color: '#334155' }}>默认机器：<strong>{preAssessment.machineNo}</strong></div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ② 护士签名信息 */}
        <div className="hd-form-section">
          <SectionHeader icon="🖊️" title="护士签名信息" />
          <div style={{ padding: 20 }}>
            <div className="grid-4" style={{ gap: 16 }}>
              <Form.Item label="穿刺护士" style={{ marginBottom: 0 }}>
                <Input placeholder="请输入穿刺护士姓名" />
              </Form.Item>
              <Form.Item label="上机护士" style={{ marginBottom: 0 }}>
                <Input placeholder="请输入上机护士姓名" />
              </Form.Item>
              <Form.Item label="二次核对护士" style={{ marginBottom: 0 }}>
                <Input placeholder="请输入二次核对护士姓名" />
              </Form.Item>
            </div>
          </div>
        </div>

        {/* ③ 生命体征记录 */}
        <div className="hd-form-section">
          <SectionHeader icon="💊" title="透析中生命体征记录（每50分钟记录一次）" />
          <div style={{ padding: 20 }}>
            <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: '#64748B' }}>
                时间点由系统按当前时间自动记录，不可修改；可根据病情随时增减记录行。每行操作需护士签名。
              </div>
              <Button onClick={handleAddVitalRow}>新增记录（自动时间）</Button>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    {['记录时间', '收缩压(mmHg)', '舒张压(mmHg)', '脉搏(次/分)', '动脉压(mmHg)', '静脉压(mmHg)', '跨膜压(mmHg)', '血流速(mL/min)', '备注', '护士签名', '操作'].map(h => (
                      <th key={h} style={{ background: 'linear-gradient(90deg,#E0F2FE,#ECFEFF)', color: '#0369A1', padding: '8px 10px', fontSize: 11.5, fontWeight: 600, textAlign: 'center', border: '1px solid #BAE6FD', whiteSpace: 'nowrap' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {vitalRows.map((row) => (
                    <tr key={row.id}>
                      <td style={{ padding: '6px 10px', border: '1px solid #DBEAFE', fontWeight: 600, color: '#3D5280', whiteSpace: 'nowrap', background: '#F8FBFF' }}>
                        {row.time}
                      </td>
                      {['sbp', 'dbp', 'pulse', 'ap', 'vp', 'tmp', 'bloodflow', 'remark', 'signature'].map(field => (
                        <td key={field} style={{ padding: 4, border: '1px solid #DBEAFE', textAlign: 'center' }}>
                          <input
                            type={field === 'remark' || field === 'signature' ? 'text' : 'number'}
                            value={row.values[field] || ''}
                            onChange={e => handleVitalChange(row.id, field, e.target.value)}
                            placeholder={field === 'signature' ? '护士签名' : undefined}
                            style={{ width: '100%', padding: '5px', border: 'none', textAlign: 'center', fontSize: 13, background: 'transparent', outline: 'none', fontFamily: field === 'signature' ? 'inherit' : 'DM Mono, monospace' }}
                            onFocus={e => { e.currentTarget.style.background = '#E0F2FE'; e.currentTarget.style.borderRadius = '4px'; }}
                            onBlur={e => { e.currentTarget.style.background = 'transparent'; }}
                          />
                        </td>
                      ))}
                      <td style={{ padding: 4, border: '1px solid #DBEAFE', textAlign: 'center' }}>
                        <Button danger size="small" onClick={() => handleRemoveVitalRow(row.id)}>
                          删除
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* ④ 医嘱执行确认 */}
        <div className="hd-form-section">
          <SectionHeader icon="✅" title="今日医嘱执行确认" />
          <div style={{ padding: 20 }}>
            {PENDING_ORDERS.map(o => (
              <div
                key={o.key}
                className={`hd-order-exec-item ${orders[o.key] ? 'executed' : ''}`}
                style={{ marginBottom: 10 }}
              >
                <Checkbox
                  checked={!!orders[o.key]}
                  onChange={e => handleOrderToggle(o.key, e.target.checked)}
                  style={{ flexShrink: 0 }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: '#0D1B3E' }}>{o.drug}</div>
                  <div style={{ fontSize: 12, color: '#7B92BC', marginTop: 2 }}>{o.detail}</div>
                </div>
                {orders[o.key] ? (
                  <span style={{ background: '#ECFDF5', color: '#059669', padding: '3px 9px', borderRadius: 20, fontSize: 12, fontWeight: 500 }}>✓ 已执行</span>
                ) : (
                  <span style={{ background: '#FFFBEB', color: '#D97706', padding: '3px 9px', borderRadius: 20, fontSize: 12, fontWeight: 500 }}>待执行</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ⑤ 并发症记录 */}
        <div className="hd-form-section">
          <SectionHeader icon="⚠️" title="并发症记录（可多选）" />
          <div style={{ padding: 20 }}>
            <div className="grid-4" style={{ gap: 10 }}>
              {COMPLICATIONS.map(c => (
                <div
                  key={c.value}
                  onClick={() => setComplications(prev =>
                    prev.includes(c.value)
                      ? prev.filter(x => x !== c.value)
                      : [...prev, c.value]
                  )}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '9px 12px',
                    border: `1.5px solid ${complications.includes(c.value) ? (c.emergency ? '#F43F5E' : '#0EA5E9') : '#DBEAFE'}`,
                    borderRadius: 6,
                    cursor: 'pointer',
                    background: complications.includes(c.value) ? (c.emergency ? '#FFF1F2' : '#E0F2FE') : '#fff',
                    transition: 'all 0.15s',
                    fontSize: 13,
                  }}
                >
                  <Checkbox checked={complications.includes(c.value)} onChange={() => {}} />
                  <span style={{ color: c.emergency ? '#BE123C' : '#0D1B3E' }}>
                    {c.emergency ? '⚡ ' : ''}{c.label}
                  </span>
                </div>
              ))}
            </div>
            {complications.some(c => COMPLICATIONS.find(co => co.value === c)?.emergency) && (
              <Alert
                type="error"
                showIcon
                message="检测到紧急并发症！请立即通知值班医生并按应急流程处理。"
                style={{ marginTop: 12 }}
              />
            )}
            {complications.includes('hypotension') && (
              <div style={{ marginTop: 12, padding: 12, background: '#FFF1F2', border: '1px solid #FECDD3', borderRadius: 6, fontSize: 13 }}>
                <div style={{ fontWeight: 600, color: '#BE123C', marginBottom: 4 }}>低血压处理记录</div>
                <Input.TextArea rows={2} placeholder="请记录处理措施（如：停超滤、头低脚高位、输注生理盐水200mL…）" style={{ fontSize: 13 }} />
              </div>
            )}
          </div>
        </div>

        {/* ⑥ 透析后评估（含 Kt/V 计算） */}
        <div className="hd-form-section">
          <SectionHeader icon="🔚" title="透析后评估（含 Kt/V 计算）" />
          <div style={{ padding: 20 }}>
            <div className="grid-4" style={{ gap: 16, marginBottom: 16 }}>
              <Form.Item label="实际透析时长-小时" style={{ marginBottom: 0 }}>
                <InputNumber min={0} max={8} step={0.1} precision={1} style={{ width: '100%' }} placeholder="小时" value={durationHours ?? undefined} onChange={v => setDurationHours(v)} />
              </Form.Item>
              <Form.Item label="透析期间入量 (mL)" style={{ marginBottom: 0 }}>
                <InputNumber min={0} max={10000} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item label="透析期间出量 (mL)" style={{ marginBottom: 0 }}>
                <InputNumber min={0} max={10000} style={{ width: '100%' }} />
              </Form.Item>
            </div>

            <div className="grid-4" style={{ gap: 16, marginBottom: 16 }}>
              <Form.Item label="实际脱水 (mL)" style={{ marginBottom: 0 }}>
                <InputNumber min={0} max={10000} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item label="滤器凝血级别" style={{ marginBottom: 0 }}>
                <Select defaultValue="1" options={[
                  { value: '0', label: '0级（无凝血）' },
                  { value: '1', label: 'Ⅰ级' },
                  { value: '2', label: 'Ⅱ级' },
                  { value: '3', label: 'Ⅲ级' },
                ]} />
              </Form.Item>
              <Form.Item label="置管封管用药-动脉端" style={{ marginBottom: 0 }}>
                <Input placeholder="如：肝素钠 1mL" />
              </Form.Item>
              <Form.Item label="置管封管用药-静脉端" style={{ marginBottom: 0 }}>
                <Input placeholder="如：肝素钠 1mL" />
              </Form.Item>
            </div>

            <div className="grid-4" style={{ gap: 16, marginBottom: 16 }}>
              <Form.Item label="凝血分级" style={{ marginBottom: 0 }}>
                <Select defaultValue="0" options={[
                  { value: '0', label: '0级（无凝血）' },
                  { value: '1', label: 'Ⅰ级（<20%变黑）' },
                  { value: '2', label: 'Ⅱ级（静脉壶明显）' },
                  { value: '3', label: 'Ⅲ级（>50%或停机）' },
                ]} />
              </Form.Item>
              <Form.Item label="穿刺结果（AVF/AVG）" style={{ marginBottom: 0 }}>
                <Select defaultValue="success" options={[
                  { value: 'success', label: '一针成功' },
                  { value: 'second',  label: '二次穿刺' },
                  { value: 'difficult', label: '穿刺困难' },
                ]} />
              </Form.Item>
              <Form.Item label="渗血部位" style={{ marginBottom: 0 }}>
                <Input placeholder="如：动脉穿刺点" />
              </Form.Item>
              <Form.Item label="透析后用药是否执行" style={{ marginBottom: 0 }}>
                <Radio.Group defaultValue="yes">
                  <Radio value="yes">是</Radio>
                  <Radio value="no">否</Radio>
                </Radio.Group>
              </Form.Item>
            </div>

            <div className="grid-4" style={{ gap: 16, marginBottom: 16 }}>
              <Form.Item label="透后收缩压 (mmHg)" style={{ marginBottom: 0 }}>
                <InputNumber min={60} max={250} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item label="透后舒张压 (mmHg)" style={{ marginBottom: 0 }}>
                <InputNumber min={40} max={160} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item label="透后脉搏 P (次/分)" style={{ marginBottom: 0 }}>
                <InputNumber min={30} max={220} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item label="透析前体重 (kg)" required style={{ marginBottom: 0 }}>
                <InputNumber
                  min={20} max={200} step={0.1} precision={1}
                  style={{ width: '100%' }}
                  value={preWeight}
                  onChange={v => setPreWeight(v)}
                  placeholder="如：64.5"
                />
              </Form.Item>
            </div>

            <div className="grid-4" style={{ gap: 16, marginBottom: 16 }}>
              <Form.Item label="透析后体重 (kg)" style={{ marginBottom: 0 }}>
                <InputNumber
                  min={20} max={200} step={0.1} precision={1}
                  style={{ width: '100%' }}
                  value={postWeight}
                  onChange={v => setPostWeight(v)}
                  placeholder="如：62.0"
                />
              </Form.Item>
              <Form.Item label="透前BUN (mmol/L)" style={{ marginBottom: 0 }}>
                <InputNumber
                  min={1} max={100} step={0.1} precision={1}
                  style={{ width: '100%' }}
                  value={preBun}
                  onChange={v => setPreBun(v)}
                  placeholder="透析前BUN"
                />
              </Form.Item>
              <Form.Item label="透后BUN (mmol/L)" style={{ marginBottom: 0 }}>
                <InputNumber
                  min={1} max={100} step={0.1} precision={1}
                  style={{ width: '100%' }}
                  value={postBun}
                  onChange={v => setPostBun(v)}
                  placeholder="透析后BUN"
                />
              </Form.Item>
              <Form.Item label="下机后机器运行情况" style={{ marginBottom: 0 }}>
                <Select defaultValue="normal" options={[
                  { value: 'normal', label: '正常' },
                  { value: 'abnormal', label: '异常' },
                ]} />
              </Form.Item>
              <Form.Item label="下机后消毒方式" style={{ marginBottom: 0 }}>
                <Select defaultValue="thermal-chemical" options={[
                  { value: 'thermal-chemical', label: '热化学消毒' },
                  { value: 'chemical', label: '化学消毒' },
                  { value: 'other', label: '其他' },
                ]} />
              </Form.Item>
              <Form.Item label="局部皮肤完好" style={{ marginBottom: 0 }}>
                <Radio.Group defaultValue="yes">
                  <Radio value="yes">是</Radio>
                  <Radio value="no">否</Radio>
                </Radio.Group>
              </Form.Item>
              <Form.Item label="透析期间患者状态" style={{ marginBottom: 0 }}>
                <Select defaultValue="stable" options={[
                  { value: 'stable', label: '平稳' },
                  { value: 'general', label: '一般' },
                  { value: 'unstable', label: '不稳定' },
                ]} />
              </Form.Item>
            </div>

            <div className="grid-4" style={{ gap: 16, marginBottom: 16 }}>
              <Form.Item label="透析后用药是否执行" style={{ marginBottom: 0 }}>
                <Radio.Group defaultValue="yes">
                  <Radio value="yes">是</Radio>
                  <Radio value="no">否</Radio>
                </Radio.Group>
              </Form.Item>
            </div>

            {/* 超滤量显示 */}
            {ufToUse !== null && (
              <div style={{ marginTop: 16, marginBottom: 16, padding: 12, background: ufAlert ? '#FFF1F2' : '#F0F9FF', border: `1px solid ${ufAlert ? '#FECDD3' : '#BAE6FD'}`, borderRadius: 8 }}>
                <div className="flex items-center gap-16">
                  <div>
                    <span style={{ fontSize: 12, color: '#7B92BC' }}>实际超滤量</span>
                    <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 22, fontWeight: 700, color: ufAlert ? '#BE123C' : '#0284C7' }}>
                      {ufToUse} mL
                    </div>
                  </div>
                  {ufPercent && (
                    <div>
                      <span style={{ fontSize: 12, color: '#7B92BC' }}>占干体重比例</span>
                      <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 22, fontWeight: 700, color: ufAlert ? '#BE123C' : '#0D1B3E' }}>
                        {ufPercent}%{ufAlert ? ' ⚠️' : ''}
                      </div>
                    </div>
                  )}
                  {ufAlert && (
                    <div style={{ background: '#FFF1F2', color: '#BE123C', padding: '8px 14px', borderRadius: 6, fontSize: 13, fontWeight: 500, flex: 1 }}>
                      ⚠️ 超滤量超过干体重5%（{ufPercent}%），需通知医生！
                    </div>
                  )}
                </div>
                <div style={{ marginTop: 8, background: '#EFF6FF', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 4,
                    width: `${Math.min(100, parseFloat(ufPercent || '0') * 10)}%`,
                    background: ufAlert ? 'linear-gradient(90deg,#F43F5E,#FB7185)' : 'linear-gradient(90deg,#0EA5E9,#06B6D4)',
                    transition: 'width 0.3s',
                  }} />
                </div>
              </div>
            )}

            {/* Kt/V 计算结果 */}
            {ktv !== null ? (
              <div className="grid-2" style={{ gap: 16, marginBottom: 16 }}>
                <div style={{
                  padding: '14px',
                  background: ktvAdequate ? 'linear-gradient(135deg,#ECFDF5,#F0FDF4)' : 'linear-gradient(135deg,#FFFBEB,#FFF9EC)',
                  border: `1.5px solid ${ktvAdequate ? '#6EE7B7' : '#FDE68A'}`,
                  borderRadius: 8, textAlign: 'center',
                }}>
                  <div style={{ fontSize: 12, color: '#7B92BC', marginBottom: 4 }}>spKt/V（Daugirdas II）</div>
                  <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 28, fontWeight: 700, color: ktvAdequate ? '#059669' : '#D97706' }}>
                    {ktv}
                  </div>
                  <div style={{ fontSize: 12, color: ktvAdequate ? '#059669' : '#D97706', marginTop: 4, fontWeight: 500 }}>
                    {ktvAdequate ? '✅ 达标（≥1.2）' : '⚠️ 不达标（<1.2）'}
                  </div>
                </div>
                <div style={{
                  padding: '14px',
                  background: urrAdequate ? 'linear-gradient(135deg,#ECFDF5,#F0FDF4)' : 'linear-gradient(135deg,#FFFBEB,#FFF9EC)',
                  border: `1.5px solid ${urrAdequate ? '#6EE7B7' : '#FDE68A'}`,
                  borderRadius: 8, textAlign: 'center',
                }}>
                  <div style={{ fontSize: 12, color: '#7B92BC', marginBottom: 4 }}>URR（尿素清除率）</div>
                  <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 28, fontWeight: 700, color: urrAdequate ? '#059669' : '#D97706' }}>
                    {urr}%
                  </div>
                  <div style={{ fontSize: 12, color: urrAdequate ? '#059669' : '#D97706', marginTop: 4, fontWeight: 500 }}>
                    {urrAdequate ? '✅ 达标（≥65%）' : '⚠️ 不达标（<65%）'}
                  </div>
                </div>
              </div>
            ) : (
              preBun && postBun ? (
                <div style={{ marginBottom: 16, padding: 12, background: '#FFF1F2', border: '1px solid #FECDD3', borderRadius: 6, fontSize: 13, color: '#BE123C' }}>
                  ⚠️ BUN 数值异常（透后BUN应小于透前BUN），请核查数据。
                </div>
              ) : (
                <div style={{ marginBottom: 16, padding: 12, background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: 6, fontSize: 13, color: '#0369A1' }}>
                  ℹ️ 填写透析前后 BUN 值后，系统将自动计算 spKt/V 和 URR（Daugirdas II 公式）。
                </div>
              )
            )}

            <div style={{ marginTop: 16 }}>
              <Form.Item label="护士备注" style={{ marginBottom: 0 }}>
                <Input.TextArea rows={3} placeholder="记录本次透析特殊情况、护理观察、患者反馈等…" />
              </Form.Item>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <div style={{ width: 360 }}>
                <Form.Item style={{ marginBottom: 10 }}>
                  <Input addonBefore="护士签名：" placeholder="请输入护士姓名" />
                </Form.Item>
                <Form.Item style={{ marginBottom: 0 }}>
                  <Input addonBefore="日期：" value={autoGeneratedDate} readOnly />
                </Form.Item>
              </div>
            </div>
          </div>
        </div>

        {/* 底部操作 */}
        <div className="flex justify-between items-center" style={{ padding: '16px 0' }}>
          <Button onClick={() => navigate(-1)}>取消</Button>
          <Button type="primary" icon={<SaveOutlined />} loading={loading} onClick={handleSubmit} size="large">
            保存透析记录
          </Button>
        </div>
      </Form>
    </PageShell>
  );
}
