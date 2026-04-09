/**
 * 今日上机名单卡片：班次、透析方式、通路、年龄等展示与排序
 */
import dayjs from 'dayjs';
import type { TodaySchedulePatientRow } from '../api/schedule';

export function scheduleShiftLabel(shift: string | undefined): string {
  const m: Record<string, string> = {
    morning: '上午',
    afternoon: '下午',
    evening: '晚班',
    am: '上午',
    pm: '下午',
    eve: '晚班',
  };
  if (!shift) return '—';
  return m[String(shift).toLowerCase()] ?? shift;
}

export function sessionDialysisModeShort(mode: string | null | undefined): string {
  if (mode == null || String(mode).trim() === '') return 'HD';
  const u = String(mode).trim().toUpperCase().replace(/\+/g, '_');
  if (u === 'HDF') return 'HDF';
  if (u === 'HD_HP' || u === 'HDHP') return 'HD+HP';
  return u.replace(/_/g, '+');
}

export function accessTypeCn(access: string | null | undefined): string {
  if (!access) return '—';
  const u = String(access).toUpperCase();
  const map: Record<string, string> = {
    AVF: 'AVF',
    AVG: 'AVG',
    TCC: 'TCC',
    NCC: 'NCC',
  };
  return map[u] ?? access;
}

export function isolationTagProps(zone: string | null | undefined): { label: string; color: string } {
  if (zone === 'hbv') return { label: '乙肝区', color: 'orange' };
  if (zone === 'hcv') return { label: '丙肝区', color: 'magenta' };
  return { label: '普通区', color: 'blue' };
}

export function ageFromDob(dob: string | undefined): string | null {
  if (!dob || !String(dob).trim()) return null;
  const raw = String(dob).slice(0, 10);
  const d = dayjs(raw, 'YYYY-MM-DD', true).isValid() ? dayjs(raw) : dayjs(dob);
  if (!d.isValid()) return null;
  const y = dayjs().diff(d, 'year');
  return `${y}岁`;
}

export function sortTodayScheduleRows(rows: TodaySchedulePatientRow[]): TodaySchedulePatientRow[] {
  const order: Record<string, number> = {
    morning: 0, am: 0, afternoon: 1, pm: 1, evening: 2, eve: 2,
  };
  return [...rows].sort((a, b) => {
    const sa = order[String(a.shift ?? '').toLowerCase()] ?? 9;
    const sb = order[String(b.shift ?? '').toLowerCase()] ?? 9;
    if (sa !== sb) return sa - sb;
    return String(a.machine_no ?? '').localeCompare(String(b.machine_no ?? ''), undefined, { numeric: true });
  });
}

export type NormalizedShiftKey = 'morning' | 'afternoon' | 'evening' | 'other';

export type NormalizedZoneKey = 'general' | 'hbv' | 'hcv';

export type TodayScheduleShiftZoneGroup = {
  shiftKey: NormalizedShiftKey;
  /** 区块标题（上午 / 下午 / 晚班 / 其他） */
  shiftLabel: string;
  zones: Array<{
    zoneKey: NormalizedZoneKey;
    zoneLabel: string;
    zoneColor: string;
    rows: TodaySchedulePatientRow[];
  }>;
};

export function normalizeScheduleShiftKey(shift: string | undefined): NormalizedShiftKey {
  const k = String(shift ?? '').toLowerCase();
  if (k === 'morning' || k === 'am') return 'morning';
  if (k === 'afternoon' || k === 'pm') return 'afternoon';
  if (k === 'evening' || k === 'eve') return 'evening';
  return 'other';
}

export function normalizeIsolationZoneKey(zone: string | null | undefined): NormalizedZoneKey {
  if (zone === 'hbv') return 'hbv';
  if (zone === 'hcv') return 'hcv';
  return 'general';
}

function shiftSectionTitle(shiftKey: NormalizedShiftKey, sampleShift: string | undefined): string {
  if (shiftKey === 'morning') return '上午';
  if (shiftKey === 'afternoon') return '下午';
  if (shiftKey === 'evening') return '晚班';
  return scheduleShiftLabel(sampleShift);
}

/**
 * 今日上机名单：先按班次、再按透析分区分组（用于分区块展示）
 */
export function groupTodayScheduleRowsByShiftThenZone(
  rows: TodaySchedulePatientRow[]
): TodayScheduleShiftZoneGroup[] {
  const sorted = sortTodayScheduleRows(rows);
  const shiftOrder: NormalizedShiftKey[] = ['morning', 'afternoon', 'evening', 'other'];
  const zoneOrder: NormalizedZoneKey[] = ['general', 'hbv', 'hcv'];

  const nested = new Map<NormalizedShiftKey, Map<NormalizedZoneKey, TodaySchedulePatientRow[]>>();
  for (const row of sorted) {
    const sk = normalizeScheduleShiftKey(row.shift);
    const zk = normalizeIsolationZoneKey(row.isolation_zone);
    if (!nested.has(sk)) nested.set(sk, new Map());
    const zm = nested.get(sk)!;
    if (!zm.has(zk)) zm.set(zk, []);
    zm.get(zk)!.push(row);
  }

  const result: TodayScheduleShiftZoneGroup[] = [];
  for (const sk of shiftOrder) {
    const zm = nested.get(sk);
    if (!zm) continue;
    const zones: TodayScheduleShiftZoneGroup['zones'] = [];
    for (const zk of zoneOrder) {
      const list = zm.get(zk);
      if (!list?.length) continue;
      const tag = isolationTagProps(zk === 'general' ? null : zk);
      zones.push({
        zoneKey: zk,
        zoneLabel: tag.label,
        zoneColor: tag.color,
        rows: list,
      });
    }
    if (!zones.length) continue;
    const sampleShift = zones[0]?.rows[0]?.shift;
    result.push({
      shiftKey: sk,
      shiftLabel: shiftSectionTitle(sk, sampleShift),
      zones,
    });
  }
  return result;
}

/** 按透析隔离分区聚合（普通区 / 乙肝区 / 丙肝区），组内顺序与 {@link sortTodayScheduleRows} 一致 */
export type TodayScheduleZoneGroup = {
  zoneKey: NormalizedZoneKey;
  zoneLabel: string;
  /** Ant Design Tag color */
  zoneColor: string;
  rows: TodaySchedulePatientRow[];
};

export function groupTodayScheduleRowsByZone(rows: TodaySchedulePatientRow[]): TodayScheduleZoneGroup[] {
  const zoneOrder: NormalizedZoneKey[] = ['general', 'hbv', 'hcv'];
  const nested = new Map<NormalizedZoneKey, TodaySchedulePatientRow[]>();
  for (const zk of zoneOrder) nested.set(zk, []);
  const sorted = sortTodayScheduleRows(rows);
  for (const row of sorted) {
    const zk = normalizeIsolationZoneKey(row.isolation_zone);
    nested.get(zk)!.push(row);
  }
  const result: TodayScheduleZoneGroup[] = [];
  for (const zk of zoneOrder) {
    const list = nested.get(zk)!;
    if (!list.length) continue;
    const tag = isolationTagProps(zk === 'general' ? null : zk);
    result.push({
      zoneKey: zk,
      zoneLabel: tag.label,
      zoneColor: tag.color,
      rows: list,
    });
  }
  return result;
}
