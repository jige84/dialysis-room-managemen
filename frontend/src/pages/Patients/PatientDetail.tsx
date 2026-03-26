import { useState } from 'react';
import { Card, Tabs, Button, Table, Tag, Space, Descriptions, Divider, message } from 'antd';
import { ArrowLeftOutlined, PrinterOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';

const MOCK_PATIENT = {
  id: 'P20210315', name: '张国华', avatar: '张', gender: '男', age: 56,
  diagnosis: '糖尿病肾病 · CKD-5期', comorbidities: '糖尿病、高血压、轻度心衰',
  phone: '138****7823', emergency: '张某某（妻）138****9012',
  address: '涉县县城×××', dialysisMode: 'HD（血液透析）',
  startDate: '2021-08-22', dialysisAge: '4年7月',
  nurse: '杨晨', zone: 'normal', status: 'active',
  consents: [
    { name: '透析知情同意书', status: 'signed', date: '2021-03-15' },
    { name: '透析器复用同意书', status: 'signed', date: '2021-03-15' },
    { name: 'CVC置管同意书', status: 'na' },
  ],
};

const MOCK_INFECTION = [
  { item: 'HBsAg',      result: '阴性', date: '2025-12-10', next: '2026-06-10', status: 'normal' },
  { item: '抗-HCV',     result: '阴性', date: '2025-12-10', next: '2026-06-10', status: 'normal' },
  { item: '抗-HIV',     result: '阴性', date: '2025-12-10', next: '2026-06-10', status: 'normal' },
  { item: '梅毒（TPPA）', result: '阴性', date: '2025-12-10', next: '2026-06-10', status: 'normal' },
];

const MOCK_LABS = [
  { key: '1', date: '2026-03-15', item: '血清钾 K⁺', value: '5.8', unit: 'mmol/L', range: '3.5–5.5', status: 'high' },
  { key: '2', date: '2026-03-15', item: '血清肌酐 Cr', value: '862', unit: 'μmol/L', range: '<115', status: 'high' },
  { key: '3', date: '2026-03-15', item: '血红蛋白 Hb', value: '98', unit: 'g/L', range: '110–160', status: 'low' },
  { key: '4', date: '2026-03-15', item: 'iPTH', value: '312', unit: 'pg/mL', range: '150–300', status: 'high' },
  { key: '5', date: '2026-03-01', item: 'spKt/V', value: '1.25', unit: '', range: '≥1.2', status: 'normal' },
  { key: '6', date: '2026-03-01', item: 'URR', value: '68%', unit: '', range: '≥65%', status: 'normal' },
];

const MOCK_DIALYSIS_HISTORY = [
  { key: '1', date: '2026-03-19', shift: '下午班', machine: '5号机', preWeight: 64.5, postWeight: 62.1, uf: 2400, duration: 4.0, ktv: 1.25, complications: '无', nurse: '陈燕' },
  { key: '2', date: '2026-03-17', shift: '上午班', machine: '5号机', preWeight: 64.2, postWeight: 62.0, uf: 2200, duration: 4.0, ktv: 1.22, complications: '无', nurse: '杨晨' },
  { key: '3', date: '2026-03-15', shift: '下午班', machine: '5号机', preWeight: 65.0, postWeight: 62.3, uf: 2700, duration: 4.0, ktv: 1.28, complications: '轻度低血压', nurse: '陈燕' },
];

const MOCK_ORDERS = [
  { key: '1', drug: '重组人促红素注射液', dose: '6000 IU', route: '皮下注射', freq: 'tiw（每透析日）', doctor: '任计阁', status: 'active' },
  { key: '2', drug: '碳酸钙片', dose: '0.6g', route: '口服 随餐', freq: 'tid（每日三次）', doctor: '任计阁', status: 'active' },
  { key: '3', drug: '蔗糖铁注射液', dose: '200mg', route: '静脉输注（透析中）', freq: 'qw（每周1次）', doctor: '任计阁', status: 'active' },
  { key: '4', drug: '骨化三醇胶囊', dose: '0.25μg', route: '口服', freq: 'tiw（每透析日）', doctor: '任计阁', status: 'stopped' },
];

const MOCK_VASCULAR = {
  current: { type: 'AVF', side: '左前臂', method: '绳梯穿刺', startDate: '2021-03-20', bloodflow: 800, status: 'good' },
  assessments: [
    { date: '2026-03-01', bloodflow: 820, thrill: '震颤良好', bruit: '血管杂音清晰', skin: '正常', result: '功能良好' },
    { date: '2026-01-15', bloodflow: 780, thrill: '震颤良好', bruit: '血管杂音清晰', skin: '正常', result: '功能良好' },
  ],
};

const MOCK_PRESCRIPTION = {
  frequency: '每周 3 次', duration: '4.0 小时', mode: 'HD（血液透析）', dialyzer: 'FX80（高通量）',
  dryWeight: 62.0, assessDate: '2026-03-01',
  anticoagulant: '普通肝素', heparinFirst: '3000IU', heparinMaint: '500IU/h',
  bloodFlow: 250, dialysateFlow: 500,
  na: 138, k: 2.0, ca: 1.5, temp: 36.5,
  doctor: '任计阁', startDate: '2026-01-10',
};

// ── 标签页内容 ──────────────────────────────────────────────
function TabBasic() {
  return (
    <div className="grid-2" style={{ gap: 20 }}>
      <Card title="👤 基本信息" size="small" style={{ border: '1px solid #DBEAFE' }}
        extra={<Button size="small">编辑</Button>}
        styles={{ header: { background: '#FAFCFF' } }}>
        <table style={{ width: '100%', fontSize: 13.5, borderCollapse: 'collapse' }}>
          {[
            ['姓名', MOCK_PATIENT.name],
            ['性别 / 年龄', `${MOCK_PATIENT.gender} / ${MOCK_PATIENT.age}岁（1970-07-22）`],
            ['主要诊断', MOCK_PATIENT.diagnosis],
            ['合并症', MOCK_PATIENT.comorbidities],
            ['联系电话', MOCK_PATIENT.phone],
            ['家属联系人', MOCK_PATIENT.emergency],
            ['家庭住址', MOCK_PATIENT.address],
            ['透析方式', MOCK_PATIENT.dialysisMode],
            ['透析开始日期', `${MOCK_PATIENT.startDate}（透析龄 ${MOCK_PATIENT.dialysisAge}）`],
            ['责任护士', MOCK_PATIENT.nurse],
          ].map(([label, value]) => (
            <tr key={label}>
              <td style={{ color: '#7B92BC', padding: '7px 0', width: 120, verticalAlign: 'top' }}>{label}</td>
              <td style={{ fontWeight: label === '姓名' || label === '责任护士' ? 600 : 400, color: label === '责任护士' ? '#0EA5E9' : '#0D1B3E' }}>{value}</td>
            </tr>
          ))}
        </table>
      </Card>

      <Card title="🦠 传染病筛查" size="small" style={{ border: '1px solid #DBEAFE' }}
        extra={<Button size="small">录入新结果</Button>}
        styles={{ header: { background: '#FAFCFF' } }}>
        <Table
          dataSource={MOCK_INFECTION.map((r, i) => ({ ...r, key: i }))}
          size="small"
          pagination={false}
          columns={[
            { title: '项目', dataIndex: 'item' },
            {
              title: '结果',
              render: (_, r) => (
                <span style={{
                  background: r.result === '阴性' ? '#ECFDF5' : '#FFF1F2',
                  color: r.result === '阴性' ? '#059669' : '#BE123C',
                  padding: '2px 8px', borderRadius: 20, fontSize: 11.5,
                }}>{r.result}</span>
              ),
            },
            { title: '检测日期', dataIndex: 'date', render: v => <span className="num text-sm">{v}</span> },
            {
              title: '下次复查',
              dataIndex: 'next',
              render: v => <span className="num text-sm" style={{ color: '#D97706' }}>{v}</span>,
            },
          ]}
        />
      </Card>

      <Card title="📝 简要病史" size="small" style={{ border: '1px solid #DBEAFE', gridColumn: 'span 2' }}
        extra={<Button size="small">编辑</Button>}
        styles={{ header: { background: '#FAFCFF' } }}>
        <div className="grid-3" style={{ gap: 24, fontSize: 13.5 }}>
          <div>
            <div style={{ fontWeight: 600, color: '#7B92BC', marginBottom: 8, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>现病史</div>
            <p style={{ color: '#0D1B3E', lineHeight: 1.8, margin: 0 }}>患者2型糖尿病病史20余年，肾功能减退10年，自2021年8月起规律血液透析（每周3次）。近期血压控制尚可，干体重较上月评估上调0.5kg。</p>
          </div>
          <div>
            <div style={{ fontWeight: 600, color: '#7B92BC', marginBottom: 8, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>既往史</div>
            <p style={{ color: '#0D1B3E', lineHeight: 1.8, margin: 0 }}>高血压病史15年，服用氨氯地平控制中；轻度心衰，心功能II级；否认手术史、外伤史。无药物过敏史。</p>
          </div>
          <div>
            <div style={{ fontWeight: 600, color: '#7B92BC', marginBottom: 8, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>近期病情变化</div>
            <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 6, padding: 10, lineHeight: 1.8 }}>
              <span style={{ color: '#D97706', fontWeight: 600 }}>⚠ 2026-03-19：</span>
              血清钾K⁺偏高（5.8 mmol/L），已嘱低钾饮食，次日复查。
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

function TabPrescription() {
  const p = MOCK_PRESCRIPTION;
  return (
    <div>
      <Card title="💊 当前透析处方" size="small" style={{ border: '1px solid #DBEAFE', marginBottom: 20 }}
        extra={<Space size={8}><Button size="small">处方历史</Button><Button size="small" type="primary">修改处方</Button></Space>}
        styles={{ header: { background: '#FAFCFF' } }}>
        <div className="grid-4" style={{ gap: 20, marginBottom: 16 }}>
          {[['透析频次', p.frequency], ['标准时长', p.duration], ['透析方式', p.mode], ['透析器型号', p.dialyzer]].map(([l, v]) => (
            <div key={l}>
              <div style={{ fontSize: 12, color: '#7B92BC', marginBottom: 4 }}>{l}</div>
              <div style={{ fontWeight: 600 }}>{v}</div>
            </div>
          ))}
        </div>
        <Divider style={{ margin: '12px 0', borderColor: '#DBEAFE' }} />
        <div className="grid-4" style={{ gap: 20, marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 12, color: '#7B92BC', marginBottom: 4 }}>干体重目标</div>
            <div style={{ fontWeight: 700, fontSize: 18, color: '#0284C7' }} className="num">{p.dryWeight} kg</div>
            <div style={{ fontSize: 12, color: '#7B92BC' }}>评估日期 {p.assessDate}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: '#7B92BC', marginBottom: 4 }}>抗凝方案</div>
            <div style={{ fontWeight: 600 }}>{p.anticoagulant}</div>
            <div style={{ fontSize: 12, color: '#7B92BC' }}>首剂{p.heparinFirst} · 维持{p.heparinMaint}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: '#7B92BC', marginBottom: 4 }}>血流速</div>
            <div style={{ fontWeight: 600 }} className="num">{p.bloodFlow} mL/min</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: '#7B92BC', marginBottom: 4 }}>透析液流速</div>
            <div style={{ fontWeight: 600 }} className="num">{p.dialysateFlow} mL/min</div>
          </div>
        </div>
        <div style={{ background: '#F8FAFC', borderRadius: 8, padding: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#7B92BC', marginBottom: 10 }}>透析液参数</div>
          <div className="grid-4" style={{ gap: 16 }}>
            {[['钠浓度', `${p.na} mmol/L`], ['钾浓度', `${p.k} mmol/L`], ['钙浓度', `${p.ca} mmol/L`], ['温度', `${p.temp} ℃`]].map(([l, v]) => (
              <div key={l}>
                <div style={{ fontSize: 12, color: '#7B92BC', marginBottom: 2 }}>{l}</div>
                <div style={{ fontWeight: 700 }} className="num">{v}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ marginTop: 12, fontSize: 12.5, color: '#7B92BC' }}>
          📝 处方医生：{p.doctor} · 开具时间：{p.startDate} · 有效期：长期有效
        </div>
      </Card>
    </div>
  );
}

function TabVascular() {
  const v = MOCK_VASCULAR;
  return (
    <div>
      <div className="hd-vascular-card avf" style={{ marginBottom: 20 }}>
        <div className="flex justify-between items-center" style={{ marginBottom: 12 }}>
          <span style={{ background: '#ECFDF5', color: '#059669', padding: '3px 10px', borderRadius: 20, fontSize: 13, fontWeight: 500 }}>
            🫀 动静脉内瘘（AVF）— 当前使用
          </span>
          <Space size={8}>
            <Button size="small">评估记录</Button>
            <Button size="small" type="primary">编辑</Button>
          </Space>
        </div>
        <div className="grid-4" style={{ gap: 16 }}>
          {[['位置', v.current.side], ['穿刺方法', v.current.method], ['建立日期', v.current.startDate], ['平均血流量', `${v.current.bloodflow} mL/min`]].map(([l, val]) => (
            <div key={l}>
              <div style={{ fontSize: 12, color: '#7B92BC', marginBottom: 3 }}>{l}</div>
              <div style={{ fontWeight: 600 }}>{val}</div>
            </div>
          ))}
        </div>
      </div>

      <Card title="📋 评估记录" size="small" style={{ border: '1px solid #DBEAFE' }}
        extra={<Button size="small" type="primary">＋ 录入评估</Button>}
        styles={{ header: { background: '#FAFCFF' } }}>
        <Table
          dataSource={v.assessments.map((r, i) => ({ ...r, key: i }))}
          size="small"
          pagination={false}
          columns={[
            { title: '评估日期', dataIndex: 'date' },
            { title: '血流量', dataIndex: 'bloodflow', render: v => <span className="num">{v} mL/min</span> },
            { title: '震颤', dataIndex: 'thrill' },
            { title: '杂音', dataIndex: 'bruit' },
            { title: '皮肤', dataIndex: 'skin' },
            { title: '评估结果', dataIndex: 'result', render: v => <span style={{ color: '#059669', fontWeight: 500 }}>{v}</span> },
          ]}
        />
      </Card>
    </div>
  );
}

function TabLabs() {
  const statusStyle: Record<string, { className: string }> = {
    normal: { className: 'lab-normal' },
    high:   { className: 'lab-high' },
    low:    { className: 'lab-low' },
    critical: { className: 'lab-critical' },
  };

  return (
    <Card title="🧪 检验结果" size="small" style={{ border: '1px solid #DBEAFE' }}
      extra={<Button size="small" type="primary">录入新结果</Button>}
      styles={{ header: { background: '#FAFCFF' } }}>
      <Table
        dataSource={MOCK_LABS}
        size="small"
        pagination={false}
        columns={[
          { title: '检测日期', dataIndex: 'date', render: v => <span className="num text-sm">{v}</span> },
          { title: '检验项目', dataIndex: 'item', render: v => <span style={{ fontWeight: 500 }}>{v}</span> },
          {
            title: '结果值',
            render: (_, r) => (
              <span className={`num ${statusStyle[r.status]?.className || 'lab-normal'}`}>
                {r.value} {r.unit}
              </span>
            ),
          },
          { title: '参考范围', dataIndex: 'range', render: v => <span className="text-sm text-muted">{v}</span> },
          {
            title: '状态',
            render: (_, r) => {
              const m: Record<string, { label: string; color: string; bg: string }> = {
                normal:   { label: '正常',   color: '#059669', bg: '#ECFDF5' },
                high:     { label: '偏高',   color: '#D97706', bg: '#FFFBEB' },
                low:      { label: '偏低',   color: '#4338CA', bg: '#EEF2FF' },
                critical: { label: '危急值', color: '#BE123C', bg: '#FFF1F2' },
              };
              const s = m[r.status] || m.normal;
              return <span style={{ background: s.bg, color: s.color, padding: '2px 8px', borderRadius: 20, fontSize: 11.5, fontWeight: 500 }}>{s.label}</span>;
            },
          },
        ]}
      />
    </Card>
  );
}

function TabHistory() {
  return (
    <Card title="📖 透析历史记录" size="small" style={{ border: '1px solid #DBEAFE' }}
      styles={{ header: { background: '#FAFCFF' } }}>
      <Table
        dataSource={MOCK_DIALYSIS_HISTORY}
        size="small"
        pagination={{ pageSize: 10, showTotal: total => `共 ${total} 条` }}
        columns={[
          { title: '透析日期', dataIndex: 'date' },
          { title: '班次', dataIndex: 'shift', render: v => <Tag color="orange" style={{ fontSize: 11 }}>{v}</Tag> },
          { title: '机器', dataIndex: 'machine' },
          { title: '上机体重', dataIndex: 'preWeight', render: v => <span className="num">{v} kg</span> },
          { title: '下机体重', dataIndex: 'postWeight', render: v => <span className="num">{v} kg</span> },
          { title: '超滤量', dataIndex: 'uf', render: v => <span className="num">{v} mL</span> },
          { title: '实际时长', dataIndex: 'duration', render: v => <span className="num">{v} h</span> },
          { title: 'Kt/V', dataIndex: 'ktv', render: v => <span className={`num ${v < 1.2 ? 'lab-critical' : 'lab-normal'}`}>{v}</span> },
          { title: '并发症', dataIndex: 'complications' },
          { title: '责护', dataIndex: 'nurse' },
        ]}
      />
    </Card>
  );
}

function TabOrders() {
  const active = MOCK_ORDERS.filter(o => o.status === 'active');
  const stopped = MOCK_ORDERS.filter(o => o.status === 'stopped');

  const columns = [
    { title: '药品名称', dataIndex: 'drug', render: (v: string) => <span style={{ fontWeight: 600 }}>{v}</span> },
    { title: '剂量', dataIndex: 'dose', render: (v: string) => <span className="num">{v}</span> },
    { title: '用法', dataIndex: 'route' },
    { title: '执行频次', dataIndex: 'freq', render: (v: string) => <Tag color="blue" style={{ fontSize: 11 }}>{v}</Tag> },
    { title: '开具医生', dataIndex: 'doctor' },
  ];

  return (
    <div>
      <Card title={<span>✅ 有效医嘱 <span style={{ color: '#7B92BC', fontSize: 12 }}>({active.length}条)</span></span>}
        size="small" style={{ border: '1px solid #DBEAFE', marginBottom: 16 }}
        extra={<Button size="small" type="primary">开具新医嘱</Button>}
        styles={{ header: { background: '#FAFCFF' } }}>
        <Table dataSource={active} columns={columns} size="small" pagination={false} rowKey="key" />
      </Card>
      {stopped.length > 0 && (
        <Card title={<span>⛔ 已停止医嘱 <span style={{ color: '#7B92BC', fontSize: 12 }}>({stopped.length}条)</span></span>}
          size="small" style={{ border: '1px solid #DBEAFE', opacity: 0.7 }}
          styles={{ header: { background: '#F8FAFC' } }}>
          <Table dataSource={stopped} columns={columns} size="small" pagination={false} rowKey="key" />
        </Card>
      )}
    </div>
  );
}

function TabInfection() {
  return (
    <Card title="🦠 传染病筛查完整记录" size="small" style={{ border: '1px solid #DBEAFE' }}
      extra={<Button size="small" type="primary">录入新结果</Button>}
      styles={{ header: { background: '#FAFCFF' } }}>
      <Table
        dataSource={MOCK_INFECTION.map((r, i) => ({ ...r, key: i }))}
        size="small"
        pagination={false}
        columns={[
          { title: '筛查项目', dataIndex: 'item', render: v => <span style={{ fontWeight: 500 }}>{v}</span> },
          {
            title: '结果',
            render: (_, r) => (
              <span style={{
                background: r.result === '阴性' ? '#ECFDF5' : '#FFF1F2',
                color: r.result === '阴性' ? '#059669' : '#BE123C',
                padding: '2px 8px', borderRadius: 20, fontSize: 12, fontWeight: 500,
              }}>{r.result}</span>
            ),
          },
          { title: '检测日期', dataIndex: 'date', render: v => <span className="num">{v}</span> },
          { title: '下次复查', dataIndex: 'next', render: v => <span className="num" style={{ color: '#D97706' }}>{v}</span> },
          {
            title: '状态',
            render: (_, r) => {
              const s = r.status === 'normal'
                ? { label: '正常', color: '#059669', bg: '#ECFDF5' }
                : { label: '即将到期', color: '#D97706', bg: '#FFFBEB' };
              return <span style={{ background: s.bg, color: s.color, padding: '2px 8px', borderRadius: 20, fontSize: 11.5 }}>{s.label}</span>;
            },
          },
        ]}
      />
      <div style={{ marginTop: 16, padding: 14, background: '#F0F9FF', borderRadius: 8, border: '1px solid #BAE6FD', fontSize: 13 }}>
        <span style={{ fontWeight: 600, color: '#0369A1' }}>📋 隔离分区：</span>
        <span style={{ marginLeft: 8 }}>普通区（HBsAg、抗HCV 均为阴性）</span>
      </div>
    </Card>
  );
}

// ── 主组件 ──────────────────────────────────────────────────
export default function PatientDetailPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [activeTab, setActiveTab] = useState('basic');

  const p = MOCK_PATIENT;

  const handlePrint = () => { message.info('打印功能开发中'); };

  return (
    <div>
      {/* 顶部操作栏 */}
      <div className="flex items-center" style={{ marginBottom: 16, gap: 12 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/patients')}>返回列表</Button>
        <span style={{ fontSize: 13, color: '#7B92BC' }}>患者ID: {id || p.id}</span>
      </div>

      {/* 患者基本信息条 */}
      <Card
        style={{ marginBottom: 16, border: '1px solid #0EA5E9', borderLeft: '4px solid #0EA5E9' }}
        styles={{ body: { padding: '16px 20px' } }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-16">
            <div className="hd-avatar hd-avatar-m" style={{ width: 52, height: 52, fontSize: 20, borderRadius: 12 }}>
              {p.avatar}
            </div>
            <div>
              <div className="flex items-center gap-8">
                <span style={{ fontSize: 20, fontWeight: 700, color: '#0D1B3E' }}>{p.name}</span>
                <span style={{ background: '#ECFDF5', color: '#059669', padding: '2px 9px', borderRadius: 20, fontSize: 13, fontWeight: 500 }}>在透</span>
                <span style={{ background: '#E0F2FE', color: '#0369A1', border: '1px solid #7DD3FC', padding: '2px 9px', borderRadius: 20, fontSize: 13 }}>普通区</span>
              </div>
              <div style={{ fontSize: 13, color: '#7B92BC', marginTop: 4 }}>
                {p.gender} · {p.age}岁 · ID: {p.id} · {p.diagnosis} · 透析龄 {p.dialysisAge}
              </div>
            </div>
          </div>
          <Space size={8}>
            <Button icon={<PrinterOutlined />} onClick={handlePrint}>打印档案</Button>
            <Button type="primary" onClick={() => navigate('/dialysis/entry')}>💉 录入今日透析</Button>
          </Space>
        </div>
      </Card>

      {/* 知情同意书状态 */}
      <div className="flex gap-8" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
        {p.consents.map(c => (
          <span key={c.name} style={{
            background: c.status === 'signed' ? '#ECFDF5' : '#F1F5F9',
            color: c.status === 'signed' ? '#059669' : '#64748B',
            border: `1px solid ${c.status === 'signed' ? '#6EE7B7' : '#CBD5E1'}`,
            padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 500,
          }}>
            {c.status === 'signed' ? `✅ ${c.name} 已签 (${c.date})` : `— ${c.name} 不适用`}
          </span>
        ))}
      </div>

      {/* 7个标签页 */}
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          { key: 'basic',     label: '📋 基本信息',  children: <TabBasic /> },
          { key: 'rx',        label: '💊 透析处方',  children: <TabPrescription /> },
          { key: 'vascular',  label: '🫀 血管通路',  children: <TabVascular /> },
          { key: 'labs',      label: '🧪 检验结果',  children: <TabLabs /> },
          { key: 'history',   label: '📖 透析历史',  children: <TabHistory /> },
          { key: 'orders',    label: '📋 长期医嘱',  children: <TabOrders /> },
          { key: 'infection', label: '🦠 传染病',    children: <TabInfection /> },
        ]}
        style={{ background: '#fff', padding: '0 0 16px', borderRadius: 10, border: '1px solid #DBEAFE' }}
        tabBarStyle={{ padding: '0 20px', borderBottom: '2px solid #DBEAFE' }}
      />
    </div>
  );
}
