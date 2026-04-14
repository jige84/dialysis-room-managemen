/**
 * 今日概览 / 工作台仪表盘页
 * 主要作用：展示关键运营与质控概览图表、快捷入口，登录后默认落地页之一。
 * 主要功能：Recharts 图表；对接患者统计、透析日统计、今日排班、预警与月度质控月报。
 */
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Card, Tag, Button, Select, Table, Segmented, Spin, Empty, message } from 'antd';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine,
  ResponsiveContainer, Cell,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Legend,
} from 'recharts';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import PageShell from '../../components/PageShell/PageShell';
import { patientsApi, type PatientStats } from '../../api/patients';
import dialysisApi, { type DailyDialysisStats } from '../../api/dialysis';
import { scheduleApi, type TodaySchedulePatientRow, type WeekScheduleResponse, type ShiftKey } from '../../api/schedule';
import alertsApi, { type AlertItem, type AlertSummary } from '../../api/alerts';
import reportsApi, { type QCReport, type QcTrendRow } from '../../api/reports';
import {
  buildQcBarDataFromReport,
  buildQcIndicatorCardsFromReport,
  buildQcRadarFromReports,
  buildQcTrendFromRows,
  getWeekStartMonday,
  mapScheduleRowToDashboardSession,
  scheduleMatchesShiftFilter,
  shiftSnapshotMeta,
  type DashboardSessionRow,
  type QcRadarRow,
} from './dashboardHelpers';

const TREND_OPTIONS = [
  { key: 'nurseRatio',  label: '护患比',      standard: 5.0, unit: '',  color: '#6366F1' },
  { key: 'coagulation', label: '凝血发生率',   standard: 0.5, unit: '%', color: '#F59E0B' },
  { key: 'bloodLeak',   label: '漏血发生率',   standard: 0.5, unit: '%', color: '#EC4899' },
  { key: 'puncture',    label: '穿刺损伤率',   standard: 1.0, unit: '%', color: '#8B5CF6' },
  { key: 'crbsi',       label: 'CRBSI发生率', standard: 1.0, unit: '‰', color: '#EF4444' },
] as const;

type TrendKey = typeof TREND_OPTIONS[number]['key'];

type QcBarDatum = ReturnType<typeof buildQcBarDataFromReport>[number];

// ── 图表 Tooltip 组件 ──────────────────────────────────────
interface QcBarTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: QcBarDatum }>;
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
  radarRows: QcRadarRow[];
}

const QcRadarTooltip = ({ active, payload, label, radarRows }: QcRadarTooltipProps) => {
  if (!active || !payload?.length) return null;
  const row = radarRows.find(d => d.subject === String(label));
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

function alertDisplayMeta(a: AlertItem): { level: string; icon: string } {
  if (a.severity === 'emergency' || a.severity === 'critical') return { level: 'danger', icon: '⚡' };
  if (a.severity === 'warning') return { level: 'warning', icon: '⚠️' };
  return { level: 'info', icon: 'ℹ️' };
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [shiftFilter, setShiftFilter] = useState('all');
  const [qcViewType, setQcViewType] = useState<'card' | 'bar' | 'radar' | 'trend'>('card');
  const [trendKey, setTrendKey] = useState<TrendKey>('nurseRatio');

  const [patientStats, setPatientStats] = useState<PatientStats | null>(null);
  const [dailyStats, setDailyStats] = useState<DailyDialysisStats | null>(null);
  const [todaySchedule, setTodaySchedule] = useState<TodaySchedulePatientRow[]>([]);
  const [weekData, setWeekData] = useState<WeekScheduleResponse | null>(null);
  const [alertSummary, setAlertSummary] = useState<AlertSummary | null>(null);
  const [alertItems, setAlertItems] = useState<AlertItem[]>([]);
  const [qcReport, setQcReport] = useState<QCReport | null>(null);
  const [qcTrendRows, setQcTrendRows] = useState<QcTrendRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const todayStr = dayjs().format('YYYY-MM-DD');
        const y = dayjs().year();
        const m = dayjs().month() + 1;
        const weekStart = getWeekStartMonday(dayjs());

        const [stRes, dailyRes, scheduleRows, weekDataResult, sumRes, listRes, qcRes] = await Promise.all([
          patientsApi.stats(),
          dialysisApi.statsDaily(todayStr),
          scheduleApi.getToday(),
          scheduleApi.getWeek(weekStart),
          alertsApi.summary(),
          alertsApi.list({ status: 'active', page_size: 8 }),
          reportsApi.getQCUpload(y, m),
        ]);

        let trendRows: QcTrendRow[] = [];
        try {
          const trendRes = await reportsApi.trend();
          trendRows = trendRes.data.data;
        } catch {
          message.warning('质控趋势加载失败，已显示其余工作台数据');
        }

        if (cancelled) return;
        setPatientStats(stRes.data.data);
        setDailyStats(dailyRes.data.data);
        setTodaySchedule(scheduleRows);
        setWeekData(weekDataResult);
        setAlertSummary(sumRes.data.data);
        setAlertItems(listRes.data.data.data);
        setQcReport(qcRes.data.data);
        setQcTrendRows(trendRows);
      } catch {
        message.error('工作台数据加载失败，请稍后重试');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const currentTrendOpt = TREND_OPTIONS.find((o) => o.key === trendKey)!;

  const statCards = useMemo(() => {
    if (!patientStats || !dailyStats || !alertSummary) return null;
    const va = `AVF ${patientStats.va_avf} · AVG ${patientStats.va_avg} · TCC ${patientStats.va_tcc} · NCC ${patientStats.va_ncc}`;
    const d = dailyStats;
    const m = Number(d.morning_sessions ?? 0);
    const a = Number(d.afternoon_sessions ?? 0);
    const e = Number(d.evening_sessions ?? 0);
    const done = Number(d.total_sessions ?? 0);
    const planned = todaySchedule.length;
    const shiftDetail = `上午 ${m} · 下午 ${a} · 晚班 ${e} / 计划${planned}例`;
    const em = (alertSummary.emergency ?? 0) + (alertSummary.critical ?? 0);
    const wr = (alertSummary.warning ?? 0) + (alertSummary.info ?? 0);
    const alertDetail = `紧急/危重 ${em} · 警示/提示 ${wr}`;
    const nc = Number(d.nurse_count ?? 0);
    const ratio = nc > 0 ? (done / nc).toFixed(1) : '—';
    const nurseRatio = nc > 0 ? `1:${ratio}` : '—';
    const ratioDetail = `${nc}名当班护士（透析记录）· ${done} 场次`;
    return {
      totalActive: patientStats.total_active,
      vaDetail: va,
      completedToday: done,
      shiftDetail,
      alertCount: alertSummary.total,
      alertDetail,
      nurseRatio,
      ratioDetail,
    };
  }, [patientStats, dailyStats, alertSummary, todaySchedule.length]);

  const shiftCounts = useMemo(() => {
    const am = todaySchedule.filter((r) => r.shift === 'morning').length;
    const pm = todaySchedule.filter((r) => r.shift === 'afternoon').length;
    const eve = todaySchedule.filter((r) => r.shift === 'evening').length;
    return { am, pm, eve, total: todaySchedule.length };
  }, [todaySchedule]);

  const filteredSessions: DashboardSessionRow[] = useMemo(() => {
    const rows = todaySchedule.filter((r) => scheduleMatchesShiftFilter(r, shiftFilter));
    return rows.map(mapScheduleRowToDashboardSession);
  }, [todaySchedule, shiftFilter]);

  const scheduleSnapshot = useMemo(() => {
    if (!weekData) return [];
    const todayStr = dayjs().format('YYYY-MM-DD');
    const keys: ShiftKey[] = ['am', 'pm', 'eve'];
    const labels: Record<ShiftKey, string> = { am: '上午班', pm: '下午班', eve: '晚班' };
    const now = dayjs();
    return keys.map((k) => {
      const cell = weekData.cells[k]?.[todayStr];
      const meta = shiftSnapshotMeta(k, now);
      return {
        key: k,
        shift: labels[k],
        count: cell?.patients?.length ?? 0,
        nurses: cell?.nurses?.map((n) => n.name).join('、') || '—',
        ratio: cell?.ratio ?? '—',
        status: meta.status,
        level: meta.level,
      };
    });
  }, [weekData]);

  const qcBarData = useMemo(() => (qcReport ? buildQcBarDataFromReport(qcReport) : []), [qcReport]);
  const qcRadarData: QcRadarRow[] = useMemo(() => {
    if (!qcReport) return [];
    const prevMonth = dayjs().subtract(1, 'month');
    const prev =
      qcTrendRows.find(
        (x) => x.report_year === prevMonth.year() && x.report_month === prevMonth.month() + 1,
      ) ?? null;
    return buildQcRadarFromReports(qcReport, prev);
  }, [qcReport, qcTrendRows]);
  const qcTrendChart = useMemo(() => buildQcTrendFromRows(qcTrendRows, 6), [qcTrendRows]);
  const qcIndicatorCards = useMemo(() => (qcReport ? buildQcIndicatorCardsFromReport(qcReport) : []), [qcReport]);

  const asOfDay = Math.max(0, dayjs().date() - 1);

  return (
    <PageShell fullWidth>
      <div className="hd-page-intro">
        <div>
          <div className="hd-page-intro__eyebrow">科室运行概览</div>
          <div className="hd-page-intro__title">今日透析工作台</div>
          <div className="hd-page-intro__desc">
            优先展示今日排班、风险预警与质控摘要，方便医生、护士长和值班护士快速进入工作。
          </div>
        </div>
        <div className="hd-page-intro__chips">
          <span className="hd-page-intro__chip">今日排班 {shiftCounts.total} 人</span>
          <span className="hd-page-intro__chip">在透患者 {patientStats?.total_active ?? '—'} 人</span>
          <span className="hd-page-intro__chip">活跃预警 {alertSummary?.total ?? '—'} 条</span>
        </div>
      </div>
      <Spin spinning={loading}>
      {/* ── 4个统计卡 ── */}
      <div className="grid-4 hd-stat-grid" style={{ marginBottom: 20 }}>
        <div className="hd-stat-card teal">
          <div className="hd-stat-icon">患者</div>
          <div className="hd-stat-label">在透患者总数</div>
          <div className="hd-stat-value num">{statCards?.totalActive ?? '—'}</div>
          <div className="hd-stat-meta">{statCards?.vaDetail ?? '加载中…'}</div>
        </div>
        <div className="hd-stat-card blue">
          <div className="hd-stat-icon">透析</div>
          <div className="hd-stat-label">今日已完成透析</div>
          <div className="hd-stat-value num">{statCards?.completedToday ?? '—'}</div>
          <div className="hd-stat-meta">{statCards?.shiftDetail ?? '—'}</div>
        </div>
        <div className="hd-stat-card amber">
          <div className="hd-stat-icon">预警</div>
          <div className="hd-stat-label">活跃预警</div>
          <div className="hd-stat-value num">{statCards?.alertCount ?? '—'}</div>
          <div className="hd-stat-meta">{statCards?.alertDetail ?? '—'}</div>
        </div>
        <div className="hd-stat-card teal">
          <div className="hd-stat-icon">排班</div>
          <div className="hd-stat-label">今日护患比（透析记录）</div>
          <div className="hd-stat-value num">{statCards?.nurseRatio ?? '—'}</div>
          <div className="hd-stat-meta">{statCards?.ratioDetail ?? '—'}</div>
        </div>
      </div>

      {/* ── 今日透析患者 ── */}
      <Card
        className="hd-panel-card"
        style={{ marginBottom: 20 }}
        styles={{ header: { background: '#FAFCFF', borderBottom: '1px solid #DBEAFE' } }}
        title={
          <span className="hd-panel-card__title">
            今日透析安排 ({dayjs().format('YYYY年MM月DD日')})
          </span>
        }
        extra={
          <div className="hd-panel-card__actions">
            <Select
              value={shiftFilter}
              onChange={setShiftFilter}
              size="small"
              style={{ width: 150 }}
              options={[
                { value: 'all', label: `全部班次（${shiftCounts.total}人）` },
                { value: 'am', label: `上午班（${shiftCounts.am}人）` },
                { value: 'pm', label: `下午班（${shiftCounts.pm}人）` },
                { value: 'eve', label: `晚班（${shiftCounts.eve}人）` },
              ]}
            />
            <Button type="primary" size="small" onClick={() => navigate('/dialysis/entry')}>
              录入透析
            </Button>
          </div>
        }
      >
        <div style={{ padding: 0, margin: '-20px' }}>
          <Table
            dataSource={filteredSessions}
            locale={{ emptyText: <Empty description="今日暂无排班患者" /> }}
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
              {
                title: '干体重',
                dataIndex: 'dryWeight',
                render: (v: number | null) => (
                  <span className="num">{v != null ? `${v} kg` : '—'}</span>
                ),
              },
              {
                title: '上机前体重',
                dataIndex: 'preWeight',
                render: (v: number | null) => (
                  <span className="num">{v != null ? `${v} kg` : '—'}</span>
                ),
              },
              {
                title: '超滤量',
                render: (_, r) => (
                  <span className="num" style={{ color: r.ufAlert ? '#F43F5E' : '#0284C7', fontWeight: r.ufAlert ? 600 : 400 }}>
                    {r.uf != null ? `${r.uf} mL` : '—'}
                    {r.ufAlert ? ' ⚠' : ''}
                  </span>
                ),
              },
              {
                title: '透析状态',
                render: (_, r) => {
                  const statusMap: Record<string, { color: string; bg: string }> = {
                    ongoing:  { color: '#059669', bg: '#ECFDF5' },
                    done:     { color: '#0369A1', bg: '#E0F2FE' },
                    pending:  { color: '#64748B', bg: '#F1F5F9' },
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
                    <Button size="small" onClick={() => navigate(`/patients/${r.patientId}`)}>档案</Button>
                    <Button
                      size="small"
                      type="primary"
                      onClick={() => navigate('/dialysis/entry')}
                    >
                      记录
                    </Button>
                  </div>
                ),
              },
            ]}
          />
          <div className="hd-table-footnote">
            今日排班共 {shiftCounts.total} 人 · 当前筛选显示 {filteredSessions.length} 条 ·
            <Button type="link" size="small" style={{ padding: 0, height: 'auto' }} onClick={() => navigate('/schedule')}>
              查看排班
            </Button>
          </div>
        </div>
      </Card>

      {/* ── 双栏：活跃预警 + 今日排班 ── */}
      <div className="grid-2" style={{ marginBottom: 20 }}>
        {/* 活跃预警 */}
        <Card
          className="hd-panel-card"
          styles={{ header: { background: '#FAFCFF', borderBottom: '1px solid #DBEAFE' } }}
          title={<span className="hd-panel-card__title">活跃预警</span>}
          extra={<Button size="small" onClick={() => navigate('/alerts')}>查看全部</Button>}
        >
          {alertItems.length === 0 ? (
            <Empty description="暂无活跃预警" />
          ) : (
            alertItems.map((a) => {
              const { level, icon } = alertDisplayMeta(a);
              return (
                <div key={a.id} className={`hd-alert-item ${level}`}>
                  <span className="hd-alert-icon">{icon}</span>
                  <div className="hd-alert-content">
                    <div className="hd-alert-title">{a.title}</div>
                    <div className="hd-alert-desc">{a.message}</div>
                    <div className="hd-alert-time">⏱ {dayjs(a.created_at).format('YYYY-MM-DD HH:mm')}</div>
                  </div>
                </div>
              );
            })
          )}
        </Card>

        {/* 今日排班快照 */}
        <Card
          className="hd-panel-card"
          styles={{ header: { background: '#FAFCFF', borderBottom: '1px solid #DBEAFE' } }}
          title={<span className="hd-panel-card__title">今日排班 ({dayjs().format('M月D日')})</span>}
          extra={<Button size="small" onClick={() => navigate('/schedule')}>排班管理</Button>}
        >
          <Table
            dataSource={scheduleSnapshot}
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
        className="hd-panel-card"
        styles={{ header: { background: '#FAFCFF', borderBottom: '1px solid #DBEAFE' } }}
        title={
          <span className="hd-panel-card__title">
            本月质控指标 ({dayjs().format('YYYY年MM月')} 截至{asOfDay}日)
          </span>
        }
        extra={
          <div className="hd-panel-card__actions">
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
            {qcIndicatorCards.length === 0 ? (
              <Empty description="质控月报加载中或暂无数据" />
            ) : (
              qcIndicatorCards.map((q) => (
                <div key={q.index} className="hd-qc-card">
                  <div className="hd-qc-index">{q.index}</div>
                  <div className="hd-qc-value" style={{ color: q.color }}>{q.value}</div>
                  <div className="hd-qc-formula">{q.formula}</div>
                  <div className="hd-qc-bar-wrap">
                    <div className={`hd-qc-bar ${q.barClass}`} style={{ width: q.barWidth }} />
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* 柱状图视图：各指标占合规上限百分比 */}
        {qcViewType === 'bar' && (
          <div>
            <div style={{ color: '#7B92BC', fontSize: 12, marginBottom: 12 }}>
              各指标实际值占合规上限的百分比，
              <span style={{ color: '#F43F5E', fontWeight: 500 }}>超过 100%</span> 表示超标，悬停查看详情（数据来自本月质控月报草稿/已报）
            </div>
            {qcBarData.length === 0 ? (
              <Empty description="暂无质控月报数据" />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={qcBarData} margin={{ top: 24, right: 60, left: 0, bottom: 4 }}>
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
                    {qcBarData.map((entry) => (
                      <Cell key={entry.name} fill={entry.pct >= 100 ? '#F43F5E' : '#10B981'} fillOpacity={0.85} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        )}

        {/* 雷达图视图：本月 vs 上月 全维度对比 */}
        {qcViewType === 'radar' && (
          <div>
            <div style={{ color: '#7B92BC', fontSize: 12, marginBottom: 14 }}>
              各轴刻度为占合规上限的百分比，<span style={{ color: '#F43F5E', fontWeight: 600 }}>100%</span>
              为合规阈值；霓虹蓝面 = 本月，星云灰面 = 上月（取自已提交/已确认月报趋势）
            </div>
            {qcRadarData.length === 0 ? (
              <Empty description="暂无雷达图数据" />
            ) : (
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
                  <RadarChart data={qcRadarData} margin={{ top: 6, right: 24, bottom: 6, left: 24 }}>
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
                    <Tooltip content={<QcRadarTooltip radarRows={qcRadarData} />} />
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
                {qcRadarData.map((row) => (
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
            )}
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
            {qcTrendChart.length === 0 ? (
              <Empty description="暂无质控趋势数据（需 qc_reports 中存在已提交/已确认记录）" />
            ) : (
              <Fragment>
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={qcTrendChart} margin={{ top: 10, right: 60, left: 0, bottom: 4 }}>
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
                <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                  {qcTrendChart.map((row) => {
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
              </Fragment>
            )}
          </div>
        )}
      </Card>
      </Spin>
    </PageShell>
  );
}
