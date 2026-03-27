/**
 * 隔离区与血管通路类型展示 — 单一数据源（与 hd-frontend 隔离区规范一致）
 */

export const ISOLATION_ZONES = ['normal', 'hbv', 'hcv'] as const;
export type IsolationZone = (typeof ISOLATION_ZONES)[number];

export const ISOLATION_ZONE_DISPLAY: Record<IsolationZone, { label: string; className: string }> = {
  normal: { label: '普通区', className: 'hd-isolation-normal' },
  hbv: { label: '乙肝隔离区', className: 'hd-isolation-hbv' },
  hcv: { label: '丙肝隔离区（末班）', className: 'hd-isolation-hcv' },
};

/** 血管通路缩写（列表展示用） */
export const ACCESS_TYPES = ['AVF', 'AVG', 'TCC', 'LTCC', 'NCC'] as const;
export type AccessTypeKey = (typeof ACCESS_TYPES)[number];

export const ACCESS_TYPE_STYLE: Record<
  AccessTypeKey,
  { bg: string; color: string; label?: string }
> = {
  AVF: { bg: '#ECFDF5', color: '#059669' },
  AVG: { bg: '#EFF6FF', color: '#2563EB' },
  TCC: { bg: '#FFFBEB', color: '#D97706' },
  LTCC: { bg: '#FAF5FF', color: '#7C3AED' },
  NCC: { bg: '#FFF7ED', color: '#C2410C' },
};

const ACCESS_FALLBACK = { bg: '#F1F5F9', color: '#64748B' };

export function getAccessTypeStyle(key: string): { bg: string; color: string } {
  if (key in ACCESS_TYPE_STYLE) return ACCESS_TYPE_STYLE[key as AccessTypeKey];
  return ACCESS_FALLBACK;
}
