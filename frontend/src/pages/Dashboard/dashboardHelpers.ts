/**
 * 今日概览页：将后端统计与排班数据格式化为图表/表格可用结构
 */
import dayjs from 'dayjs';
import type { TodaySchedulePatientRow } from '../../api/schedule';
import type { QCReport, QcTrendRow } from '../../api/reports';

/** 五项率值（月报与 qc-trend 共有字段） */
export type QcRates = Pick<
  QCReport,
  'nurse_patient_ratio' | 'circuit_clotting_rate' | 'membrane_rupture_rate' | 'puncture_injury_rate' | 'crbsi_rate'
>;

export interface QcBarDatum {
  name: string;
  pct: number;
  value: string;
  standard: string;
}
import type { ShiftKey } from '../../api/schedule';

/** 周一起始日 YYYY-MM-DD（与后端 schedule getWeekStart 一致：周一为一周开始） */
export function getWeekStartMonday(d: dayjs.Dayjs): string {
  const day = d.day();
  const offset = day === 0 ? -6 : 1 - day;
  return d.add(offset, 'day').format('YYYY-MM-DD');
}

export function parseNurseRatioPatientsPerNurse(ratio: string): number {
  const m = /1:\s*([\d.]+)/.exec(ratio);
  return m ? parseFloat(m[1]) : 0;
}

export function parsePercentRate(s: string): number {
  const m = /([\d.]+)\s*%/.exec(s);
  return m ? parseFloat(m[1]) : 0;
}

export function parsePerMilleRate(s: string): number {
  const m = /([\d.]+)\s*‰/.exec(s);
  return m ? parseFloat(m[1]) : 0;
}

/** 柱状图：占合规上限的百分比（与原先静态演示逻辑一致） */
export function buildQcBarDataFromReport(r: QcRates): QcBarDatum[] {
  const nurseNum = parseNurseRatioPatientsPerNurse(r.nurse_patient_ratio);
  const nursePct = nurseNum > 0 ? Math.min(160, (nurseNum / 5) * 100) : 0;
  const clot = parsePercentRate(r.circuit_clotting_rate);
  const leak = parsePercentRate(r.membrane_rupture_rate);
  const punct = parsePercentRate(r.puncture_injury_rate);
  const crbsi = parsePerMilleRate(r.crbsi_rate);
  return [
    { name: '护患比', pct: Math.round(nursePct), value: r.nurse_patient_ratio, standard: '≤ 1:5' },
    { name: '凝血率', pct: Math.min(160, clot > 0 ? (clot / 0.5) * 100 : 0), value: r.circuit_clotting_rate, standard: '< 0.5%' },
    { name: '漏血率', pct: Math.min(160, leak > 0 ? (leak / 0.5) * 100 : 0), value: r.membrane_rupture_rate, standard: '< 0.5%' },
    { name: '穿刺损伤', pct: Math.min(160, punct > 0 ? (punct / 1.0) * 100 : 0), value: r.puncture_injury_rate, standard: '< 1.0%' },
    { name: 'CRBSI', pct: Math.min(160, crbsi > 0 ? (crbsi / 1.0) * 100 : 0), value: r.crbsi_rate, standard: '< 1.0‰' },
  ];
}

/** 雷达图与右侧列表行（subject 与 buildQcBarDataFromReport 顺序一致） */
export interface QcRadarRow {
  subject: string;
  本月: number;
  上月: number;
  actual: string;
  prev: string;
  standard: string;
}

export function buildQcRadarFromReports(current: QCReport, previous: QcTrendRow | null): QcRadarRow[] {
  const cur = buildQcBarDataFromReport(current);
  const prevBar = previous ? buildQcBarDataFromReport(previous as QcRates) : null;
  const subjects = ['护患比', '凝血率', '漏血率', '穿刺损伤', 'CRBSI'];
  return subjects.map((subject, i) => ({
    subject,
    本月: cur[i]?.pct ?? 0,
    上月: prevBar ? (prevBar[i]?.pct ?? 0) : 0,
    actual: cur[i]?.value ?? '—',
    prev: prevBar ? (prevBar[i]?.value ?? '—') : '—',
    standard: cur[i]?.standard ?? '',
  }));
}

/** 近若干月趋势（用于折线图） */
/** 卡片视图五项（颜色与进度条宽度随占标率） */
export function buildQcIndicatorCardsFromReport(r: QCReport) {
  const bar = buildQcBarDataFromReport(r);
  const indices = ['① 护患比', '② 凝血发生率', '③ 漏血发生率', '④ 穿刺损伤率', '⑤ CRBSI发生率'] as const;
  const formulas = [
    `${r.total_patient_sessions}患次 ÷ ${r.total_nurse_sessions}护次`,
    `${r.circuit_clotting_count}次 ÷ ${r.total_sessions}次`,
    `${r.membrane_rupture_count}次 ÷ ${r.total_sessions}次`,
    `${r.puncture_injury_count}次 ÷ ${r.avf_sessions}内瘘次`,
    `${r.crbsi_count}例 ÷ ${r.cvc_catheter_days}导管日`,
  ];
  return indices.map((index, i) => {
    const b = bar[i];
    const over = b.pct >= 100;
    return {
      index,
      value: b.value,
      formula: formulas[i],
      color: over ? '#F59E0B' : '#10B981',
      barWidth: `${Math.min(100, Math.round(b.pct))}%`,
      barClass: over ? 'hd-qc-bar-caution' : 'hd-qc-bar-good',
    };
  });
}

export function buildQcTrendFromRows(rows: QcTrendRow[], months = 6) {
  const sorted = [...rows].sort(
    (a, b) => a.report_year - b.report_year || a.report_month - b.report_month,
  );
  const slice = sorted.slice(-months);
  return slice.map((row) => ({
    month: `${row.report_month}月`,
    nurseRatio: parseNurseRatioPatientsPerNurse(row.nurse_patient_ratio),
    coagulation: parsePercentRate(row.circuit_clotting_rate),
    bloodLeak: parsePercentRate(row.membrane_rupture_rate),
    puncture: parsePercentRate(row.puncture_injury_rate),
    crbsi: parsePerMilleRate(row.crbsi_rate),
  }));
}

export interface DashboardSessionRow {
  key: string;
  patientId: string;
  avatar: string;
  name: string;
  gender: string;
  age: number;
  diagnosis: string;
  shift: string;
  machine: string;
  access: string;
  zone: string;
  dryWeight: number | null;
  preWeight: number | null;
  uf: number | null;
  ufAlert: boolean;
  status: 'ongoing' | 'done' | 'critical' | 'warning' | 'pending';
  statusLabel: string;
}

function shiftToLabel(shift: string): string {
  if (shift === 'morning') return '上午班';
  if (shift === 'afternoon') return '下午班';
  if (shift === 'evening') return '晚班';
  return shift;
}

function genderToCn(g: string | undefined): string {
  if (g === 'F') return '女';
  if (g === 'M') return '男';
  return '—';
}

function ageFromDob(dob: string | undefined): number {
  if (!dob) return 0;
  return Math.max(0, dayjs().diff(dayjs(dob), 'year'));
}

function accessDisplay(raw: string | null | undefined): string {
  if (!raw) return '—';
  const u = raw.toUpperCase();
  if (u === 'AVF') return 'AVF';
  if (u === 'AVG') return 'AVG';
  if (u === 'TCC') return 'TCC';
  if (u === 'NCC') return 'NCC';
  return u;
}

/** 排班行 → 今日透析表格行 */
export function mapScheduleRowToDashboardSession(row: TodaySchedulePatientRow): DashboardSessionRow {
  const name = (row.patient_name as string) || '患者';
  const dry = row.prescription_dry_weight != null ? Number(row.prescription_dry_weight) : null;
  const pre = row.dialysis_pre_weight != null ? Number(row.dialysis_pre_weight) : null;
  const uf = row.dialysis_uf_volume != null ? Number(row.dialysis_uf_volume) : null;
  const ufPct = row.dialysis_uf_pct_of_dry_weight != null ? Number(row.dialysis_uf_pct_of_dry_weight) : null;
  const ufAlert = ufPct != null && ufPct > 5;
  const hasRec = Boolean(row.dialysis_record_id);
  const ended = Boolean(row.dialysis_end_time);
  const ktv = row.dialysis_ktv != null ? Number(row.dialysis_ktv) : null;

  let status: DashboardSessionRow['status'] = 'pending';
  let statusLabel = '待上机';

  if (hasRec && ended) {
    status = 'done';
    statusLabel = '已完成';
    if (ktv != null && ktv < 1.2) {
      status = 'warning';
      statusLabel = 'Kt/V不达标';
    }
  } else if (hasRec && !ended) {
    status = 'ongoing';
    statusLabel = '透析中';
  }

  const zone = (row.isolation_zone as string) || 'normal';

  return {
    key: String(row.patient_id),
    patientId: String(row.patient_id),
    avatar: name.slice(0, 1),
    name,
    gender: genderToCn(row.gender as string | undefined),
    age: ageFromDob(row.dob as string | undefined),
    diagnosis: (row.primary_diagnosis as string) || '—',
    shift: shiftToLabel(String(row.shift)),
    machine: row.machine_no ? String(row.machine_no) : '—',
    access: accessDisplay(row.access_type as string | undefined),
    zone,
    dryWeight: dry,
    preWeight: pre,
    uf,
    ufAlert,
    status,
    statusLabel,
  };
}

export function scheduleMatchesShiftFilter(row: TodaySchedulePatientRow, filter: string): boolean {
  if (filter === 'all') return true;
  const map: Record<string, string> = { am: 'morning', pm: 'afternoon', eve: 'evening' };
  return String(row.shift) === map[filter];
}

/** 与排班页一致的时间段，用于「今日排班快照」状态列 */
export function shiftSnapshotMeta(shiftKey: ShiftKey, now: dayjs.Dayjs): { status: string; level: 'done' | 'ongoing' | 'pending' } {
  const h = now.hour();
  if (shiftKey === 'am') {
    if (h >= 12) return { status: '已结束', level: 'done' };
    if (h >= 6) return { status: '进行中', level: 'ongoing' };
    return { status: '待开始', level: 'pending' };
  }
  if (shiftKey === 'pm') {
    if (h >= 18) return { status: '已结束', level: 'done' };
    if (h >= 12) return { status: '进行中', level: 'ongoing' };
    return { status: '待开始', level: 'pending' };
  }
  // eve
  if (h >= 18) return { status: '进行中', level: 'ongoing' };
  return { status: '待开始', level: 'pending' };
}
