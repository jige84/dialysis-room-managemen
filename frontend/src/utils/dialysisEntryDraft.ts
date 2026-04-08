/**
 * 透析录入页本地临时草稿（sessionStorage），未点「保存记录」前不入库。
 * 按患者 ID + 透析日期分桶，切换患者后再返回可恢复。
 */

export const DIALYSIS_ENTRY_DRAFT_VERSION = 1 as const;

export type DialysisEntryDraftSnapshot = {
  v: typeof DIALYSIS_ENTRY_DRAFT_VERSION;
  savedAt: string;
  sessionDateStr: string;
  formValues: Record<string, unknown>;
  vitalRows: Array<{ id: string; time: string; values: Record<string, string> }>;
  complications: string[];
  complicationRecords: Record<string, Record<string, unknown>>;
  orders: Record<string, boolean>;
  accessType: 'AVF' | 'AVG' | 'TCC' | 'NCC';
  catheterLocation: string;
  catheterPlacedDate: string | null;
  postWeight: number | null;
  durationHours: number | null;
  preBun: number | null;
  postBun: number | null;
  dryWeight: number | null;
};

const PREFIX = 'dialysisEntryDraft:v1:';

export function dialysisEntryDraftStorageKey(patientId: string, sessionDateStr: string): string {
  return `${PREFIX}${patientId}:${sessionDateStr}`;
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function isSnapshot(x: unknown): x is DialysisEntryDraftSnapshot {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return (
    o.v === DIALYSIS_ENTRY_DRAFT_VERSION &&
    typeof o.savedAt === 'string' &&
    typeof o.sessionDateStr === 'string' &&
    o.formValues != null &&
    typeof o.formValues === 'object' &&
    Array.isArray(o.vitalRows) &&
    Array.isArray(o.complications)
  );
}

export function loadDialysisEntryDraft(key: string): DialysisEntryDraftSnapshot | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = safeJsonParse(raw);
    return isSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveDialysisEntryDraft(key: string, snapshot: DialysisEntryDraftSnapshot): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(key, JSON.stringify(snapshot));
  } catch {
    // 配额或隐私模式：忽略
  }
}

export function removeDialysisEntryDraft(key: string): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}

/** 将表单值序列化为可 JSON 存储的结构（处理 dayjs 等） */
export function serializeFormValuesForDraft(values: Record<string, unknown>): Record<string, unknown> {
  const walk = (v: unknown): unknown => {
    if (v == null) return v;
    if (typeof v === 'object' && v !== null && '$isDayjsObject' in (v as object)) {
      const d = v as { format?: (s: string) => string };
      if (typeof d.format === 'function') return d.format('YYYY-MM-DD');
    }
    if (Array.isArray(v)) return v.map(walk);
    if (typeof v === 'object') {
      const o = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(o)) out[k] = walk(o[k]);
      return out;
    }
    return v;
  };
  return walk(values) as Record<string, unknown>;
}
