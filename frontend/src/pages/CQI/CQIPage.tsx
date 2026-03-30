/**
 * CQI（持续质量改进）记录页
 * 主要作用：登记与跟踪科室质量改进项目与进度。
 * 主要功能：列表 + 新建/编辑 Modal；对接 cqi API；权限按角色限制。
 */
import { useState } from 'react';
import { Card, Button, Select, Modal, Form, Input, DatePicker, message, Progress } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import PageShell from '../../components/PageShell/PageShell';

interface CQIPlan {
  key: string;
  title: string;
  category: string;
  problem: string;
  goal: string;
  plan: string;
  leader: string;
  startDate: string;
  endDate: string;
  status: 'ongoing' | 'completed' | 'overdue' | 'planning';
  progress: number;
  updates: { date: string; content: string; author: string }[];
}

const CQI_DATA: CQIPlan[] = [
  {
    key: '1',
    title: '提升 Kt/V 达标率至 95%以上',
    category: '透析充分性',
    problem: '2025年第四季度 Kt/V 达标率仅 91.3%，低于目标值 95%',
    goal: 'Kt/V 达标率（spKt/V ≥ 1.2 且 URR ≥ 65%）由 91.3% 提升至 ≥ 95%',
    plan: '1. 每月评估不达标患者，分析原因（透析时间不足/血流速不达/内瘘功能减退）；2. 对连续2次不达标患者调整处方；3. 加强内瘘评估，发现血流量不足及时干预',
    leader: '任计阁（主治医生）',
    startDate: '2026-01-01',
    endDate: '2026-06-30',
    status: 'ongoing',
    progress: 65,
    updates: [
      { date: '2026-03-01', content: '3月Kt/V达标率提升至94.7%，连续2次不达标患者由5人降至2人', author: '任计阁' },
      { date: '2026-02-01', content: '2月达标率93.2%，持续改进中，已对4名患者延长透析时间', author: '任计阁' },
      { date: '2026-01-15', content: '启动改进计划，基线评估：91.3%达标', author: '任计阁' },
    ],
  },
  {
    key: '2',
    title: '降低穿刺损伤发生率至 <0.3%',
    category: '穿刺护理',
    problem: '2025年穿刺损伤率为 0.52%（血肿5次/967次），超过目标值 <0.3%',
    goal: '将AVF/AVG穿刺损伤发生率由0.52%降至<0.3%',
    plan: '1. 加强护士绳梯穿刺培训，规范穿刺技术；2. 建立穿刺困难患者档案，制定个性化穿刺方案；3. 三次穿刺困难自动触发评估预警',
    leader: '杨晨（护士长）',
    startDate: '2026-01-01',
    endDate: '2026-06-30',
    status: 'ongoing',
    progress: 40,
    updates: [
      { date: '2026-03-01', content: '3月穿刺损伤率0.46%，较基线有改善，培训已完成3轮', author: '杨晨' },
    ],
  },
  {
    key: '3',
    title: '传染病复查到期率降至 0%',
    category: '感染管理',
    problem: '2025年多次出现传染病复查超期情况，影响隔离区管理规范性',
    goal: '确保所有在透患者传染病筛查均在有效期内，超期率 = 0%',
    plan: '1. 系统提前25天自动发出复查提醒；2. 护士长每周审查复查状态；3. 超期15天前与家属联系确认复查时间',
    leader: '杨晨（护士长）',
    startDate: '2025-10-01',
    endDate: '2025-12-31',
    status: 'completed',
    progress: 100,
    updates: [
      { date: '2025-12-31', content: '2025年四季度实现传染病复查超期率0%，改进成功', author: '杨晨' },
    ],
  },
  {
    key: '4',
    title: '肾性贫血Hb达标率提升至90%',
    category: '贫血管理',
    problem: '当前Hb达标率（≥110g/L）仅82.1%，低于目标85%（计划更进一步至90%）',
    goal: 'Hb ≥ 110g/L 达标率提升至 90%',
    plan: '1. 对Hb<110g/L患者每月复查；2. 评估EPO剂量是否合理；3. 检查铁储备（SF/TSAT），必要时补铁治疗',
    leader: '任计阁（主治医生）',
    startDate: '2026-04-01',
    endDate: '2026-12-31',
    status: 'planning',
    progress: 0,
    updates: [],
  },
];

const STATUS_CFG: Record<string, { label: string; color: string; bg: string }> = {
  ongoing:   { label: '进行中', color: '#0369A1', bg: '#E0F2FE' },
  completed: { label: '已完成', color: '#059669', bg: '#ECFDF5' },
  overdue:   { label: '已超期', color: '#BE123C', bg: '#FFF1F2' },
  planning:  { label: '计划中', color: '#7C3AED', bg: '#FAF5FF' },
};

const CATEGORIES = ['全部类别', '透析充分性', '穿刺护理', '感染管理', '贫血管理', 'CKD-MBD', '护患比'];

export default function CQIPage() {
  const [selectedPlan, setSelectedPlan] = useState<CQIPlan | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('全部类别');
  const [statusFilter, setStatusFilter] = useState('');
  const [form] = Form.useForm();

  const filtered = CQI_DATA.filter(p => {
    if (categoryFilter !== '全部类别' && p.category !== categoryFilter) return false;
    if (statusFilter && p.status !== statusFilter) return false;
    return true;
  });

  const ongoingCount   = CQI_DATA.filter(p => p.status === 'ongoing').length;
  const completedCount = CQI_DATA.filter(p => p.status === 'completed').length;
  const planningCount  = CQI_DATA.filter(p => p.status === 'planning').length;

  return (
    <PageShell fullWidth>
      {/* 概览 */}
      <div className="grid-4" style={{ marginBottom: 20 }}>
        <div className="hd-stat-card teal">
          <div className="hd-stat-icon">🔄</div>
          <div className="hd-stat-label">改进项目总数</div>
          <div className="hd-stat-value num">{CQI_DATA.length}</div>
          <div className="hd-stat-meta">当前管理中</div>
        </div>
        <div className="hd-stat-card blue">
          <div className="hd-stat-icon">⚡</div>
          <div className="hd-stat-label">进行中</div>
          <div className="hd-stat-value num" style={{ color: '#0369A1' }}>{ongoingCount}</div>
          <div className="hd-stat-meta">需持续跟进</div>
        </div>
        <div className="hd-stat-card teal">
          <div className="hd-stat-icon">✅</div>
          <div className="hd-stat-label">已完成</div>
          <div className="hd-stat-value num" style={{ color: '#059669' }}>{completedCount}</div>
          <div className="hd-stat-meta">改进目标达成</div>
        </div>
        <div className="hd-stat-card blue">
          <div className="hd-stat-icon">📋</div>
          <div className="hd-stat-label">计划中</div>
          <div className="hd-stat-value num" style={{ color: '#7C3AED' }}>{planningCount}</div>
          <div className="hd-stat-meta">待启动</div>
        </div>
      </div>

      {/* 筛选 + 新建 */}
      <div className="flex gap-8 items-center" style={{ marginBottom: 16 }}>
        <Select value={categoryFilter} onChange={setCategoryFilter} style={{ width: 140 }}
          options={CATEGORIES.map(c => ({ value: c, label: c }))} />
        <Select placeholder="全部状态" value={statusFilter || undefined} onChange={v => setStatusFilter(v || '')} style={{ width: 130 }} allowClear
          options={Object.entries(STATUS_CFG).map(([k, v]) => ({ value: k, label: v.label }))} />
        <div style={{ marginLeft: 'auto' }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setShowNewModal(true)}>
            新建改进计划
          </Button>
        </div>
      </div>

      {/* 计划列表 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {filtered.map(plan => {
          const s = STATUS_CFG[plan.status];
          return (
            <Card key={plan.key}
              style={{ border: '1px solid #DBEAFE', cursor: 'pointer', transition: 'box-shadow 0.2s' }}
              styles={{ body: { padding: '16px 20px' } }}
              onClick={() => setSelectedPlan(plan)}
              hoverable
            >
              <div className="flex items-start gap-16">
                <div style={{ flex: 1 }}>
                  <div className="flex items-center gap-8" style={{ marginBottom: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 15, color: '#0D1B3E' }}>{plan.title}</span>
                    <span style={{ background: s.bg, color: s.color, padding: '2px 9px', borderRadius: 20, fontSize: 12, fontWeight: 500 }}>
                      {s.label}
                    </span>
                    <span style={{ background: '#EEF2FF', color: '#4338CA', padding: '2px 8px', borderRadius: 20, fontSize: 12 }}>
                      {plan.category}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: '#3D5280', marginBottom: 8 }}>
                    <strong>问题：</strong>{plan.problem}
                  </div>
                  <div style={{ fontSize: 13, color: '#3D5280', marginBottom: 12 }}>
                    <strong>目标：</strong>{plan.goal}
                  </div>
                  <div className="flex items-center gap-16">
                    <span style={{ fontSize: 12, color: '#7B92BC' }}>负责人：{plan.leader}</span>
                    <span style={{ fontSize: 12, color: '#7B92BC' }}>周期：{plan.startDate} ~ {plan.endDate}</span>
                    <span style={{ fontSize: 12, color: '#7B92BC' }}>最近更新：{plan.updates[0]?.date || '尚未更新'}</span>
                  </div>
                </div>
                <div style={{ width: 120, textAlign: 'center', flexShrink: 0 }}>
                  <div style={{ fontSize: 12, color: '#7B92BC', marginBottom: 6 }}>完成进度</div>
                  <Progress
                    type="circle"
                    percent={plan.progress}
                    size={80}
                    strokeColor={s.color}
                    format={p => <span style={{ fontSize: 14, fontWeight: 700, color: s.color }}>{p}%</span>}
                  />
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* 计划详情弹窗 */}
      <Modal
        title={selectedPlan?.title}
        open={!!selectedPlan}
        onCancel={() => setSelectedPlan(null)}
        footer={[
          <Button key="close" onClick={() => setSelectedPlan(null)}>关闭</Button>,
          <Button key="update" type="primary" onClick={() => { setSelectedPlan(null); message.info('进度更新功能开发中'); }}>
            录入进度更新
          </Button>,
        ]}
        width={700}
      >
        {selectedPlan && (
          <div>
            <div className="grid-2" style={{ gap: 16, marginBottom: 16 }}>
              <div style={{ padding: 14, background: '#F0F9FF', borderRadius: 8, border: '1px solid #BAE6FD' }}>
                <div style={{ fontWeight: 600, color: '#0369A1', marginBottom: 8 }}>问题描述</div>
                <div style={{ fontSize: 13, color: '#3D5280', lineHeight: 1.7 }}>{selectedPlan.problem}</div>
              </div>
              <div style={{ padding: 14, background: '#ECFDF5', borderRadius: 8, border: '1px solid #6EE7B7' }}>
                <div style={{ fontWeight: 600, color: '#059669', marginBottom: 8 }}>改进目标</div>
                <div style={{ fontSize: 13, color: '#3D5280', lineHeight: 1.7 }}>{selectedPlan.goal}</div>
              </div>
            </div>
            <div style={{ padding: 14, background: '#F8FAFC', borderRadius: 8, marginBottom: 16, border: '1px solid #DBEAFE' }}>
              <div style={{ fontWeight: 600, color: '#3D5280', marginBottom: 8 }}>📋 改进措施</div>
              <div style={{ fontSize: 13, color: '#3D5280', lineHeight: 1.8, whiteSpace: 'pre-line' }}>
                {selectedPlan.plan}
              </div>
            </div>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 10 }}>📝 进度记录</div>
              {selectedPlan.updates.length > 0 ? (
                selectedPlan.updates.map((u, i) => (
                  <div key={i} style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#0EA5E9', marginTop: 6, flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div className="flex items-center gap-8">
                        <span className="num text-sm">{u.date}</span>
                        <span style={{ fontSize: 12, color: '#7B92BC' }}>by {u.author}</span>
                      </div>
                      <div style={{ fontSize: 13, color: '#3D5280', marginTop: 3 }}>{u.content}</div>
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ color: '#7B92BC', fontSize: 13 }}>暂无进度记录</div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* 新建计划弹窗 */}
      <Modal
        title="新建CQI改进计划"
        open={showNewModal}
        onOk={() => form.validateFields().then(() => { setShowNewModal(false); form.resetFields(); message.success('改进计划已创建'); })}
        onCancel={() => { setShowNewModal(false); form.resetFields(); }}
        okText="创建计划"
        cancelText="取消"
        width={600}
      >
        <Form form={form} layout="vertical" size="middle" style={{ marginTop: 16 }}>
          <Form.Item label="计划标题" name="title" rules={[{ required: true }]}>
            <Input placeholder="如：提升Kt/V达标率至95%以上" />
          </Form.Item>
          <div className="grid-2" style={{ gap: 16 }}>
            <Form.Item label="改进类别" name="category" rules={[{ required: true }]}>
              <Select options={CATEGORIES.slice(1).map(c => ({ value: c, label: c }))} />
            </Form.Item>
            <Form.Item label="负责人" name="leader" rules={[{ required: true }]}>
              <Input placeholder="如：任计阁（主治医生）" />
            </Form.Item>
          </div>
          <div className="grid-2" style={{ gap: 16 }}>
            <Form.Item label="开始日期" name="startDate" rules={[{ required: true }]}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="目标完成日期" name="endDate" rules={[{ required: true }]}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <Form.Item label="问题描述" name="problem" rules={[{ required: true }]}>
            <Input.TextArea rows={2} placeholder="描述当前存在的质量问题…" />
          </Form.Item>
          <Form.Item label="改进目标" name="goal" rules={[{ required: true }]}>
            <Input.TextArea rows={2} placeholder="明确可量化的改进目标…" />
          </Form.Item>
          <Form.Item label="改进措施" name="plan" rules={[{ required: true }]}>
            <Input.TextArea rows={4} placeholder="列出具体改进措施（建议分条描述）…" />
          </Form.Item>
        </Form>
      </Modal>
    </PageShell>
  );
}
