import { useState } from 'react';
import { Card, Tag, Button, Select, Table, Segmented } from 'antd';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine,
  ResponsiveContainer, Cell,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Legend,
} from 'recharts';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';

// ── 静态演示数据 ──────────────────────────────────────────
const STATS = {
  totalActive: 79,
  vaDetail: 'AVF 61 · AVG 1 · TCC 4 · LTCC 4 · NCC 9',
  completedToday: 24,
  shiftDetail: '上午 8 · 下午 10 · 晚班 6 / 计划27例',
  alertCount: 7,
  alertDetail: '危急值 2 · 复查到期 5',
  nurseRatio: '1:5.4',
  ratioDetail: '5名护士 · 27例患者 · 符合规程',
};

const TODAY_SESSIONS = [
  { key: '1', avatar: '张', name: '张国华', gender: '男', age: 56, diagnosis: '糖尿病肾病', shift: '下午班', machine: '5号机', access: 'AVF', zone: 'normal', dryWeight: 62.0, preWeight: 64.5, uf: 2500, ufAlert: false, status: 'ongoing', statusLabel: '透析中' },
  { key: '2', avatar: '赵', name: '赵丽萍', gender: '女', age: 48, diagnosis: '糖尿病肾病', shift: '下午班', machine: '6号机', access: 'AVF', zone: 'normal', dryWeight: 52.0, preWeight: 55.2, uf: 3200, ufAlert: true, status: 'critical', statusLabel: 'K⁺危急值' },
  { key: '3', avatar: '刘', name: '刘明远', gender: '男', age: 65, diagnosis: '多囊肾',    shift: '下午班', machine: '7号机', access: 'LTCC', zone: 'normal', dryWeight: 50.0, preWeight: 52.8, uf: 2800, ufAlert: false, status: 'ongoing', statusLabel: '透析中' },
  { key: '4', avatar: '王', name: '王建军', gender: '男', age: 71, diagnosis: '高血压肾病', shift: '下午班', machine: 'HBV-01', access: 'AVF', zone: 'hbv', dryWeight: 57.5, preWeight: 60.0, uf: 2500, ufAlert: false, status: 'warning', statusLabel: 'Kt/V不达标' },
];

const ALERTS = [
  { id: 1, level: 'danger',  icon: '⚡', title: '危急值 — 赵丽萍 血清钾 K⁺', desc: 'K⁺ = 6.8 mmol/L（正常 3.5–5.5）· 已超危急值6.5', time: '今日 09:42 · 责护：陈燕' },
  { id: 2, level: 'warning', icon: '⚠️', title: 'Kt/V 不达标 — 王建军', desc: 'spKt/V = 1.05（标准 ≥1.2）· URR 58%（标准 ≥65%）', time: '2026-03-15 上次检测' },
  { id: 3, level: 'warning', icon: '🦠', title: '传染病复查到期 — 李秀珍等3人', desc: 'HCV复查已到期（上次 2025-09-12）逾期 7 天', time: '应于 2026-03-12 前复查' },
  { id: 4, level: 'info',    icon: '💧', title: '超滤量 > 5%干体重 — 刘明远', desc: '本次超滤 2800mL / 干体重 50kg · 比例 5.6%', time: '今日 14:30 · 已通知医生' },
];

const SCHEDULES = [
  { shift: '上午班', count: 8,  nurses: '杨晨、陈燕',        ratio: '1:4.0', status: '已完成', level: 'done' },
  { shift: '下午班', count: 10, nurses: '李梅、张颖、王芳',   ratio: '1:3.3', status: '进行中', level: 'ongoing' },
  { shift: '晚班',   count: 9,  nurses: '刘娜、赵丽',        ratio: '1:4.5', status: '待开始', level: 'pending' },
];

const QC_INDICATORS = [
  { index: '① 护患比',         value: '1:6.2', formula: '469次 ÷ 75护次',   color: '#10B981', barWidth: '85%', barClass: 'hd-qc-bar-good' },
  { index: '② 凝血发生率',     value: '0.000', formula: '0次 ÷ 469次',       color: '#10B981', barWidth: '5%',  barClass: 'hd-qc-bar-good' },
  { index: '③ 漏血发生率',     value: '0.000', formula: '0次 ÷ 469次',       color: '#10B981', barWidth: '5%',  barClass: 'hd-qc-bar-good' },
  { index: '④ 穿刺损伤率',     value: '0.0046', formula: '2次 ÷ 433内瘘次', color: '#F59E0B', barWidth: '40%', barClass: 'hd-qc-bar-caution' },
  { index: '⑤ CRBSI发生率',   value: '0.000‰', formula: '0例 ÷ 导管天数',   color: '#10B981', barWidth: '5%',  barClass: 'hd-qc-bar-good' },
];

// ── 图表专用数据 ───────────────────────────────────────────
// 各指标占合规上限的百分比（护患比：实际值/标准×100%，其余同理）
const QC_BAR_DATA = [
  { name: '护患比',   pct: 124, value: '1:6.2',   standard: '≤ 1:5' },
  { name: '凝血率',   pct: 0,   value: '0.000%',  standard: '< 0.5%' },
  { name: '漏血率',   pct: 0,   value: '0.000%',  standard: '< 0.5%' },
  { name: '穿刺损伤', pct: 46,  value: '0.46%',   standard: '< 1.0%' },
  { name: 'CRBSI',   pct: 0,   value: '0.000‰',  standard: '< 1.0‰' },
];

// 雷达图：本月 vs 上月，均为占合规上限的百分比（100% = 合规边界）
const QC_RADAR_DATA = [
  { subject: '护患比',   本月: 124, 上月: 102, actual: '1:6.2',  prev: '1:5.1',  standard: '≤ 1:5' },
  { subject: '凝血率',   本月: 0,   上月: 0,   actual: '0.000%', prev: '0.000%', standard: '< 0.5%' },
  { subject: '漏血率',   本月: 0,   上月: 0,   actual: '0.000%', prev: '0.000%', standard: '< 0.5%' },
  { subject: '穿刺损伤', 本月: 46,  上月: 38,  actual: '0.46%',  prev: '0.38%',  standard: '< 1.0%' },
  { subject: 'CRBSI',   本月: 0,   上月: 0,   actual: '0.000‰', prev: '0.000‰', standard: '< 1.0‰' },
];

const TREND_OPTIONS = [
  { key: 'nurseRatio',  label: '护患比',      standard: 5.0, unit: '',  color: '#6366F1' },
  { key: 'coagulation', label: '凝血发生率',   standard: 0.5, unit: '%', color: '#F59E0B' },
  { key: 'bloodLeak',   label: '漏血发生率',   standard: 0.5, unit: '%', color: '#EC4899' },
  { key: 'puncture',    label: '穿刺损伤率',   standard: 1.0, unit: '%', color: '#8B5CF6' },
  { key: 'crbsi',       label: 'CRBSI发生率', standard: 1.0, unit: '‰', color: '#EF4444' },
] as const;

type TrendKey = typeof TREND_OPTIONS[number]['key'];

// 近6个月实际值（2025年10月 — 2026年3月）
const QC_TREND_DATA = [
  { month: '10月', nurseRatio: 5.8, coagulation: 0.42, bloodLeak: 0.00, puncture: 0.42, crbsi: 0.00 },
  { month: '11月', nurseRatio: 5.2, coagulation: 0.21, bloodLeak: 0.00, puncture: 0.39, crbsi: 0.00 },
  { month: '12月', nurseRatio: 6.0, coagulation: 0.00, bloodLeak: 0.21, puncture: 0.44, crbsi: 0.00 },
  { month: '1月',  nurseRatio: 5.5, coagulation: 0.00, bloodLeak: 0.00, puncture: 0.51, crbsi: 0.00 },
  { month: '2月',  nurseRatio: 5.1, coagulation: 0.00, bloodLeak: 0.00, puncture: 0.38, crbsi: 0.00 },
  { month: '3月',  nurseRatio: 6.2, coagulation: 0.00, bloodLeak: 0.00, puncture: 0.46, crbsi: 0.00 },
];

// ── 图表 Tooltip 组件 ──────────────────────────────────────
interface QcBarTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: typeof QC_BAR_DATA[number] }>;
}

const QcBarTooltip = ({ active, payload }: QcBarTooltipProps) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 8, padding: '10px 14px', fontSize: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
      <div style={{ fontWeight: 600, marginBottom: 6, color: '#0D1B3E' }}>{d.name}</div>
      <div style={{ color: '#64748B' }}>实际值：<strong style={{ color: '#0D1B3E' }}>{d.value}</strong></div>
      <div style={{ color: '#64748B' }}>合规标准：{d.standard}</div>
      <div style={{ marginTop: 6, fontWeight: 500, color: d.pct >= 100 ? '#F43F5E' : '#10B981' }}>
        {d.pct >= 100 ? '⚠ 超标' : '✓ 达标'}（占标率 {d.pct}%）
      </div>
    </div>
  );
};

interface QcTrendTooltipProps {
  active?: boolean;
  payload?: ReadonlyArray<{ value?: unknown; name?: unknown; color?: string }>;
  label?: string | number;
  unit: string;
  standard: number;
}

const QcTrendTooltip = ({ active, payload, label, unit, standard }: QcTrendTooltipProps) => {
  if (!active || !payload?.length) return null;
  const val = typeof payload[0]?.value === 'number' ? payload[0].value : 0;
  const isOver = val > standard;
  return (
    <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 8, padding: '10px 14px', fontSize: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
      <div style={{ fontWeight: 600, marginBottom: 6, color: '#0D1B3E' }}>{label}</div>
      <div style={{ color: payload[0].color ?? '#6366F1' }}>
        {String(payload[0].name)}：<strong>{val}{unit}</strong>
      </div>
      <div style={{ marginTop: 4, color: '#64748B' }}>合规上限：{standard}{unit}</div>
      <div style={{ marginTop: 4, fontWeight: 500, color: isOver ? '#F43F5E' : '#10B981' }}>
        {isOver ? '⚠ 超标' : '✓ 达标'}
      </div>
    </div>
  );
};

interface QcRadarTooltipProps {
  active?: boolean;
  payload?: ReadonlyArray<{ value?: unknown; name?: unknown; color?: string }>;
  label?: string | number;
}

const QcRadarTooltip = ({ active, payload, label }: QcRadarTooltipProps) => {
  if (!active || !payload?.length) return null;
  const row = QC_RADAR_DATA.find(d => d.subject === String(label));
  return (
    <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 8, padding: '10px 14px', fontSize: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.08)', minWidth: 180 }}>
      <div style={{ fontWeight: 600, marginBottom: 6, color: '#0D1B3E' }}>{label}</div>
      {row && <div style={{ color: '#64748B', marginBottom: 4 }}>合规标准：{row.standard}</div>}
      {payload.map((p) => {
        const val = typeof p.value === 'number' ? p.value : 0;
        const isOver = val >= 100;
        return (
          <div key={String(p.name)} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, display: 'inline-block', flexShrink: 0 }} />
            <span style={{ color: '#4B5563' }}>{String(p.name)}：</span>
            <strong style={{ color: isOver ? '#F43F5E' : '#10B981' }}>
              {val}% {isOver ? '▲超标' : '✓达标'}
            </strong>
          </div>
        );
      })}
    </div>
  );
};

// ── 辅助组件 ──────────────────────────────────────────────
const AccessBadge = ({ type }: { type: string }) => {
  const styles: Record<string, { bg: string; color: string }> = {
    AVF:  { bg: '#ECFDF5', color: '#059669' },
    AVG:  { bg: '#EFF6FF', color: '#2563EB' },
    TCC:  { bg: '#FFFBEB', color: '#D97706' },
    LTCC: { bg: '#FAF5FF', color: '#7C3AED' },
    NCC:  { bg: '#FFF7ED', color: '#C2410C' },
  };
  const s = styles[type] || { bg: '#F1F5F9', color: '#64748B' };
  return (
    <span style={{ background: s.bg, color: s.color, padding: '2px 8px', borderRadius: 20, fontSize: 12, fontWeight: 500 }}>
      {type}
    </span>
  );
};

export default function DashboardPage() {
  const navigate = useNavigate();
  const [shiftFilter, setShiftFilter] = useState('pm');
  const [qcViewType, setQcViewType] = useState<'card' | 'bar' | 'radar' | 'trend'>('card');
  const [trendKey, setTrendKey] = useState<TrendKey>('nurseRatio');

  const currentTrendOpt = TREND_OPTIONS.find(o => o.key === trendKey)!;

  const filteredSessions = shiftFilter === 'all'
    ? TODAY_SESSIONS
    : TODAY_SESSIONS.filter(s => {
        if (shiftFilter === 'pm') return s.shift === '下午班';
        if (shiftFilter === 'am') return s.shift === '上午班';
        if (shiftFilter === 'eve') return s.shift === '晚班';
        return true;
      });

  return (
    <div>
      {/* ── 4个统计卡 ── */}
      <div className="grid-4" style={{ marginBottom: 20 }}>
        <div className="hd-stat-card teal">
          <div className="hd-stat-icon">👥</div>
          <div className="hd-stat-label">在透患者总数</div>
          <div className="hd-stat-value num">{STATS.totalActive}</div>
          <div className="hd-stat-meta">{STATS.vaDetail}</div>
        </div>
        <div className="hd-stat-card blue">
          <div className="hd-stat-icon">💉</div>
          <div className="hd-stat-label">今日已完成透析</div>
          <div className="hd-stat-value num">{STATS.completedToday}</div>
          <div className="hd-stat-meta">{STATS.shiftDetail}</div>
        </div>
        <div className="hd-stat-card amber">
          <div className="hd-stat-icon">🔔</div>
          <div className="hd-stat-label">活跃预警</div>
          <div className="hd-stat-value num">{STATS.alertCount}</div>
          <div className="hd-stat-meta">{STATS.alertDetail}</div>
        </div>
        <div className="hd-stat-card teal">
          <div className="hd-stat-icon">👩‍⚕️</div>
          <div className="hd-stat-label">今日护患比</div>
          <div className="hd-stat-value num">{STATS.nurseRatio}</div>
          <div className="hd-stat-meta">{STATS.ratioDetail}</div>
        </div>
      </div>

      {/* ── 今日透析患者 ── */}
      <Card
        style={{ marginBottom: 20, border: '1px solid #DBEAFE' }}
        styles={{ header: { background: '#FAFCFF', borderBottom: '1px solid #DBEAFE' } }}
        title={
          <span style={{ fontWeight: 600, color: '#0D1B3E' }}>
            💉 今日透析患者 ({dayjs().format('YYYY年MM月DD日')})
          </span>
        }
        extra={
          <div className="flex gap-8 items-center">
            <Select
              value={shiftFilter}
              onChange={setShiftFilter}
              size="small"
              style={{ width: 150 }}
              options={[
                { value: 'all', label: '全部班次（27人）' },
                { value: 'am',  label: '上午班（8人）' },
                { value: 'pm',  label: '下午班（10人）' },
                { value: 'eve', label: '晚班（9人）' },
              ]}
            />
            <Button type="primary" size="small" onClick={() => navigate('/dialysis/entry')}>
              ＋ 录入透析记录
            </Button>
          </div>
        }
      >
        <div style={{ padding: 0, margin: '-20px' }}>
          <Table
            dataSource={filteredSessions}
            size="small"
            pagination={false}
            style={{ borderTop: 'none' }}
            columns={[
              {
                title: '患者信息',
                dataIndex: 'name',
                render: (_, r) => (
                  <div className="flex items-center gap-8">
                    <div className={`hd-avatar ${r.gender === '女' ? 'hd-avatar-f' : 'hd-avatar-m'}`}>
                      {r.avatar}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, color: '#0D1B3E' }}>{r.name}</div>
                      <div className="text-sm text-muted">{r.gender}·{r.age}岁·{r.diagnosis}</div>
                    </div>
                  </div>
                ),
              },
              {
                title: '班次/机器',
                render: (_, r) => (
                  <div>
                    <Tag color="orange" style={{ fontSize: 11 }}>{r.shift}</Tag>
                    <div className="text-sm text-muted">{r.machine}</div>
                  </div>
                ),
              },
              { title: '通路', render: (_, r) => <AccessBadge type={r.access} /> },
              { title: '干体重', dataIndex: 'dryWeight', render: v => <span className="num">{v} kg</span> },
              { title: '上机前体重', dataIndex: 'preWeight', render: v => <span className="num">{v} kg</span> },
              {
                title: '目标超滤',
                render: (_, r) => (
                  <span className="num" style={{ color: r.ufAlert ? '#F43F5E' : '#0284C7', fontWeight: r.ufAlert ? 600 : 400 }}>
                    {r.uf} mL{r.ufAlert ? ' ⚠' : ''}
                  </span>
                ),
              },
              {
                title: '透析状态',
                render: (_, r) => {
                  const statusMap: Record<string, { color: string; bg: string }> = {
                    ongoing:  { color: '#059669', bg: '#ECFDF5' },
                    done:     { color: '#0369A1', bg: '#E0F2FE' },
                    critical: { color: '#BE123C', bg: '#FFF1F2' },
                    warning:  { color: '#D97706', bg: '#FFFBEB' },
                  };
                  const s = statusMap[r.status] || { color: '#64748B', bg: '#F1F5F9' };
                  return (
                    <span style={{ background: s.bg, color: s.color, padding: '3px 9px', borderRadius: 20, fontSize: 12, fontWeight: 500 }}>
                      {r.statusLabel}
                    </span>
                  );
                },
              },
              {
                title: '操作',
                render: (_, r) => (
                  <div className="flex gap-4">
                    <Button size="small" onClick={() => navigate(`/patients/${r.key}`)}>档案</Button>
                    <Button
                      size="small"
                      type={r.status === 'critical' ? 'default' : 'primary'}
                      danger={r.status === 'critical'}
                      onClick={() => navigate('/dialysis/entry')}
                    >
                      {r.status === 'critical' ? '处理' : '记录'}
                    </Button>
                  </div>
                ),
              },
            ]}
          />
          <div style={{ padding: '10px 16px', textAlign: 'right', color: '#7B92BC', fontSize: 12 }}>
            下午班共10人 · 显示{filteredSessions.length}条 ·
            <a href="#" onClick={e => { e.preventDefault(); }} style={{ color: '#0EA5E9', marginLeft: 4 }}>查看全部</a>
          </div>
        </div>
      </Card>

      {/* ── 双栏：活跃预警 + 今日排班 ── */}
      <div className="grid-2" style={{ marginBottom: 20 }}>
        {/* 活跃预警 */}
        <Card
          style={{ border: '1px solid #DBEAFE' }}
          styles={{ header: { background: '#FAFCFF', borderBottom: '1px solid #DBEAFE' } }}
          title={<span style={{ fontWeight: 600, color: '#0D1B3E' }}>🚨 活跃预警</span>}
          extra={<Button size="small" onClick={() => navigate('/alerts')}>查看全部</Button>}
        >
          {ALERTS.map(a => (
            <div key={a.id} className={`hd-alert-item ${a.level}`}>
              <span className="hd-alert-icon">{a.icon}</span>
              <div className="hd-alert-content">
                <div className="hd-alert-title">{a.title}</div>
                <div className="hd-alert-desc">{a.desc}</div>
                <div className="hd-alert-time">⏱ {a.time}</div>
              </div>
            </div>
          ))}
        </Card>

        {/* 今日排班快照 */}
        <Card
          style={{ border: '1px solid #DBEAFE' }}
          styles={{ header: { background: '#FAFCFF', borderBottom: '1px solid #DBEAFE' } }}
          title={<span style={{ fontWeight: 600, color: '#0D1B3E' }}>📅 今日排班 ({dayjs().format('M月D日')})</span>}
          extra={<Button size="small" onClick={() => navigate('/schedule')}>排班管理</Button>}
        >
          <Table
            dataSource={SCHEDULES.map((s, i) => ({ ...s, key: i }))}
            size="small"
            pagination={false}
            columns={[
              {
                title: '班次',
                render: (_, r) => {
                  const colorMap: Record<string, string> = { done: 'blue', ongoing: 'orange', pending: 'default' };
                  return <Tag color={colorMap[r.level]}>{r.shift}</Tag>;
                },
              },
              { title: '患者数', dataIndex: 'count', render: v => <span className="num">{v}</span> },
              { title: '责护', dataIndex: 'nurses' },
              { title: '护患比', dataIndex: 'ratio', render: v => <span className="num">{v}</span> },
              {
                title: '状态',
                render: (_, r) => {
                  const m: Record<string, { color: string; bg: string }> = {
                    done: { color: '#059669', bg: '#ECFDF5' },
                    ongoing: { color: '#0369A1', bg: '#E0F2FE' },
                    pending: { color: '#7B92BC', bg: '#F1F5F9' },
                  };
                  const s = m[r.level];
                  return <span style={{ background: s.bg, color: s.color, padding: '2px 8px', borderRadius: 20, fontSize: 11.5, fontWeight: 500 }}>{r.status}</span>;
                },
              },
            ]}
          />
        </Card>
      </div>

      {/* ── 本月5项质控指标 ── */}
      <Card
        style={{ border: '1px solid #DBEAFE' }}
        styles={{ header: { background: '#FAFCFF', borderBottom: '1px solid #DBEAFE' } }}
        title={
          <span style={{ fontWeight: 600, color: '#0D1B3E' }}>
            📊 本月质控指标 ({dayjs().format('YYYY年MM月')} 截至{dayjs().date() - 1}日)
          </span>
        }
        extra={
          <div className="flex gap-8 items-center">
            <Segmented
              size="small"
              options={[
                { label: '卡片', value: 'card' },
                { label: '柱状图', value: 'bar' },
                { label: '雷达图', value: 'radar' },
                { label: '趋势图', value: 'trend' },
              ]}
              value={qcViewType}
              onChange={(v) => setQcViewType(v as 'card' | 'bar' | 'radar' | 'trend')}
            />
            <Button size="small" onClick={() => navigate('/reports')}>查看完整报表</Button>
          </div>
        }
      >
        {/* 卡片视图 */}
        {qcViewType === 'card' && (
          <div className="grid-5">
            {QC_INDICATORS.map(q => (
              <div key={q.index} className="hd-qc-card">
                <div className="hd-qc-index">{q.index}</div>
                <div className="hd-qc-value" style={{ color: q.color }}>{q.value}</div>
                <div className="hd-qc-formula">{q.formula}</div>
                <div className="hd-qc-bar-wrap">
                  <div className={`hd-qc-bar ${q.barClass}`} style={{ width: q.barWidth }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 柱状图视图：各指标占合规上限百分比 */}
        {qcViewType === 'bar' && (
          <div>
            <div style={{ color: '#7B92BC', fontSize: 12, marginBottom: 12 }}>
              各指标实际值占合规上限的百分比，
              <span style={{ color: '#F43F5E', fontWeight: 500 }}>超过 100%</span> 表示超标，悬停查看详情
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={QC_BAR_DATA} margin={{ top: 24, right: 60, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E8F0FB" />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#4B5563' }} />
                <YAxis
                  tickFormatter={(v) => `${v}%`}
                  tick={{ fontSize: 11, fill: '#9CA3AF' }}
                  domain={[0, 160]}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<QcBarTooltip />} />
                <ReferenceLine
                  y={100}
                  stroke="#F43F5E"
                  strokeDasharray="6 4"
                  label={{ value: '合规上限 100%', position: 'right', fontSize: 11, fill: '#F43F5E' }}
                />
                <Bar dataKey="pct" radius={[4, 4, 0, 0]} maxBarSize={64} label={{ position: 'top', fontSize: 11, formatter: (v: unknown) => v != null && v !== false ? `${v}%` : '' }}>
                  {QC_BAR_DATA.map((entry) => (
                    <Cell key={entry.name} fill={entry.pct >= 100 ? '#F43F5E' : '#10B981'} fillOpacity={0.85} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* 雷达图视图：本月 vs 上月 全维度对比 */}
        {qcViewType === 'radar' && (
          <div>
            <div style={{ color: '#7B92BC', fontSize: 12, marginBottom: 14 }}>
              各轴刻度为占合规上限的百分比，<span style={{ color: '#F43F5E', fontWeight: 600 }}>100%</span>
              为合规阈值；霓虹蓝面 = 本月，星云灰面 = 上月（2月）
            </div>
            <div
              style={{
                display: 'flex',
                gap: 20,
                alignItems: 'stretch',
                border: '1px solid #DBEAFE',
                borderRadius: 16,
                padding: 14,
                background:
                  'radial-gradient(120% 120% at 10% 0%, rgba(59,130,246,0.14) 0%, rgba(14,165,233,0.08) 28%, rgba(248,250,252,0.9) 65%, #ffffff 100%)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.9), 0 8px 24px rgba(15,23,42,0.06)',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>多维质控雷达对比</span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <span style={{ padding: '2px 10px', borderRadius: 999, background: 'rgba(59,130,246,0.12)', color: '#1D4ED8', fontSize: 11, fontWeight: 600 }}>本月</span>
                    <span style={{ padding: '2px 10px', borderRadius: 999, background: 'rgba(148,163,184,0.18)', color: '#475569', fontSize: 11, fontWeight: 600 }}>上月</span>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={320}>
                  <RadarChart data={QC_RADAR_DATA} margin={{ top: 6, right: 24, bottom: 6, left: 24 }}>
                    <defs>
                      <linearGradient id="qcRadarMonth" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#38BDF8" stopOpacity={0.48} />
                        <stop offset="100%" stopColor="#2563EB" stopOpacity={0.14} />
                      </linearGradient>
                      <linearGradient id="qcRadarPrev" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#CBD5E1" stopOpacity={0.34} />
                        <stop offset="100%" stopColor="#94A3B8" stopOpacity={0.08} />
                      </linearGradient>
                    </defs>
                    <PolarGrid stroke="#D9E6FB" strokeDasharray="4 4" />
                    <PolarAngleAxis dataKey="subject" tick={{ fontSize: 12, fill: '#334155', fontWeight: 600 }} />
                    <PolarRadiusAxis
                      angle={90}
                      domain={[0, 150]}
                      tickCount={4}
                      tick={{ fontSize: 10, fill: '#64748B' }}
                      tickFormatter={(v) => `${v}%`}
                      axisLine={false}
                    />
                    <Radar
                      name="上月"
                      dataKey="上月"
                      stroke="#64748B"
                      fill="url(#qcRadarPrev)"
                      strokeDasharray="6 4"
                      fillOpacity={1}
                      strokeWidth={1.6}
                      dot={false}
                    />
                    <Radar
                      name="本月"
                      dataKey="本月"
                      stroke="#2563EB"
                      fill="url(#qcRadarMonth)"
                      fillOpacity={1}
                      strokeWidth={2.2}
                      dot={{ r: 4, fill: '#38BDF8', stroke: '#fff', strokeWidth: 1.5 }}
                    />
                    <Legend
                      iconType="circle"
                      iconSize={9}
                      wrapperStyle={{ paddingTop: 6 }}
                      formatter={(value) => <span style={{ fontSize: 12, color: '#334155', fontWeight: 500 }}>{value}</span>}
                    />
                    <Tooltip content={<QcRadarTooltip />} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>

              <div
                style={{
                  width: 230,
                  flexShrink: 0,
                  borderRadius: 12,
                  border: '1px solid #DCEBFF',
                  background: 'linear-gradient(180deg, rgba(255,255,255,0.92) 0%, rgba(248,251,255,0.95) 100%)',
                  padding: '10px 12px',
                  boxShadow: '0 4px 14px rgba(37,99,235,0.08)',
                }}
              >
                <div style={{ fontWeight: 700, color: '#0F172A', fontSize: 13, marginBottom: 10 }}>
                  本月达标雷达看板
                </div>
                {QC_RADAR_DATA.map((row) => (
                  <div
                    key={row.subject}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '8px 0',
                      borderBottom: '1px dashed #E2E8F0',
                      gap: 10,
                    }}
                  >
                    <span style={{ fontSize: 12, color: '#334155', fontWeight: 500 }}>{row.subject}</span>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                      <span
                        style={{
                          fontSize: 11.5,
                          fontWeight: 700,
                          color: row.本月 >= 100 ? '#BE123C' : '#047857',
                          background: row.本月 >= 100 ? '#FFE4E6' : '#D1FAE5',
                          padding: '1px 8px',
                          borderRadius: 999,
                        }}
                      >
                        {row.actual} {row.本月 >= 100 ? '超标' : '达标'}
                      </span>
                      <span style={{ fontSize: 11, color: '#94A3B8' }}>上月：{row.prev}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 趋势折线图：近6个月单指标趋势 */}
        {qcViewType === 'trend' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <span style={{ color: '#4B5563', fontSize: 13, fontWeight: 500 }}>查看指标：</span>
              <Select
                value={trendKey}
                onChange={(v) => setTrendKey(v as TrendKey)}
                size="small"
                style={{ width: 160 }}
                options={TREND_OPTIONS.map(o => ({ value: o.key, label: o.label }))}
              />
              <span style={{ color: '#7B92BC', fontSize: 12 }}>
                红色虚线为合规上限（{currentTrendOpt.standard}{currentTrendOpt.unit}）
              </span>
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={QC_TREND_DATA} margin={{ top: 10, right: 60, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E8F0FB" />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#4B5563' }} />
                <YAxis
                  tick={{ fontSize: 11, fill: '#9CA3AF' }}
                  tickFormatter={(v) => `${v}${currentTrendOpt.unit}`}
                  axisLine={false}
                  tickLine={false}
                  domain={['auto', 'auto']}
                />
                <Tooltip
                  content={(props) => (
                    <QcTrendTooltip
                      {...props}
                      unit={currentTrendOpt.unit}
                      standard={currentTrendOpt.standard}
                    />
                  )}
                />
                <ReferenceLine
                  y={currentTrendOpt.standard}
                  stroke="#F43F5E"
                  strokeDasharray="6 4"
                  label={{
                    value: `上限 ${currentTrendOpt.standard}${currentTrendOpt.unit}`,
                    position: 'right',
                    fontSize: 10,
                    fill: '#F43F5E',
                  }}
                />
                <Line
                  type="monotone"
                  dataKey={currentTrendOpt.key}
                  name={currentTrendOpt.label}
                  stroke={currentTrendOpt.color}
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: currentTrendOpt.color, strokeWidth: 0 }}
                  activeDot={{ r: 6, strokeWidth: 0 }}
                />
              </LineChart>
            </ResponsiveContainer>

            {/* 各月达标状态小标签 */}
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              {QC_TREND_DATA.map((row) => {
                const val = row[currentTrendOpt.key as keyof typeof row] as number;
                const isOver = val > currentTrendOpt.standard;
                return (
                  <span
                    key={row.month}
                    style={{
                      background: isOver ? '#FFF1F2' : '#ECFDF5',
                      color: isOver ? '#BE123C' : '#059669',
                      border: `1px solid ${isOver ? '#FECDD3' : '#A7F3D0'}`,
                      padding: '2px 10px',
                      borderRadius: 20,
                      fontSize: 12,
                      fontWeight: 500,
                    }}
                  >
                    {row.month} {val}{currentTrendOpt.unit} {isOver ? '▲' : '✓'}
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
