/**
 * 处方透析器 / HD+HP 灌流器 ↔ 耗材目录 consumable_stocks（category=dialyzer）对齐。
 * 灌流器与透析器同属 dialyzer 大类：优先 hemodialysis_piece_role，其次名称含「灌流」识别。
 */
import type { ConsumableStockRow } from '../api/devices';
import { getDialyzerSelectOptions } from '../constants/dialyzerConsumables';
import { isUuid } from './anomalyAnalysis';

export const LEGACY_DIALYZER_PREFIX = 'legacy|||';

/** 离线或未关联目录的灌流器字符串 */
export const LEGACY_HP_PREFIX = 'legacy_hp|||';

const PERFUSION_NAME_RE = /灌流/u;

export function isHemoperfusionCatalogRow(row: ConsumableStockRow): boolean {
  if (row.category !== 'dialyzer') return false;
  if (row.hemodialysis_piece_role === 'hemoperfusion') return true;
  if (row.hemodialysis_piece_role === 'membrane') return false;
  return PERFUSION_NAME_RE.test(row.item_name);
}

export function isDialysisMembraneCatalogRow(row: ConsumableStockRow): boolean {
  if (row.category !== 'dialyzer') return false;
  if (row.hemodialysis_piece_role === 'hemoperfusion') return false;
  if (row.hemodialysis_piece_role === 'membrane') return true;
  return !PERFUSION_NAME_RE.test(row.item_name);
}

export function dialyzerStringForForm(model: string | null | undefined): string {
  if (!model) return '';
  const s = String(model).trim();
  if (!s) return '';
  return s.startsWith('透析器') ? s : `透析器 ${s}`;
}

function inferDialyzerFluxFromLabel(model: string): 'high' | 'low' | null {
  const s = model.trim();
  if (!s) return null;
  if (/高通/u.test(s)) return 'high';
  if (/低通/u.test(s)) return 'low';
  return null;
}

function normalizeDialyzerCatalogKey(s: string): string {
  return s
    .trim()
    .replace(/^透析器\s*/u, '')
    .replace(/[（(]/g, '(')
    .replace(/[）)]/g, ')')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function formatDialyzerStockLabel(row: ConsumableStockRow): string {
  const fluxNote =
    row.dialyzer_flux === 'high' ? '高通量' : row.dialyzer_flux === 'low' ? '低通量' : '';
  if (fluxNote && !row.item_name.includes(fluxNote) && !/(高通|低通)/u.test(row.item_name)) {
    return `${row.item_name}（${fluxNote}）`;
  }
  return row.item_name;
}

/** 去掉型号末尾「（高通量）/（低通量）」等（含半角括号、括号前空格），便于与 dialyzer_flux 列重新组合 */
const DIALYZER_FLUX_SUFFIX_RE = /\s*[(（]\s*(?:高通量|低通量)\s*[)）]\s*$/iu;

function stripDialyzerFluxSuffixFromModelText(s: string): string {
  return s.replace(DIALYZER_FLUX_SUFFIX_RE, '').trim();
}

export function pickDialyzerFluxFromRx(rx: unknown): string | null | undefined {
  if (rx == null || typeof rx !== 'object') return null;
  const o = rx as Record<string, unknown>;
  const v = o.dialyzer_flux ?? o.dialyzerFlux;
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/**
 * 透析工作台 / 报表等：处方库表 dialyzer_model 可能与 dialyzer_flux 不同步（历史内置预设、旧文案）。
 * 展示以 dialyzer_flux 为准（含 high/low）。
 * 若库未存通量：不再沿用型号字段里自带的「高/低通量」字样（易与耗材目录不一致），只展示去通量后的型号。
 */
export function dialyzerShortFromPrescriptionFields(
  dialyzerModel: string | null | undefined,
  dialyzerFlux: string | null | undefined,
): string {
  const raw = String(dialyzerModel ?? '').trim();
  if (!raw) return '—';
  const withoutPrefix = raw.replace(/^透析器\s*/u, '').trim();
  const base = stripDialyzerFluxSuffixFromModelText(withoutPrefix);
  if (!base) return '—';
  const flux = String(dialyzerFlux ?? '')
    .trim()
    .toLowerCase();
  if (flux === 'high') return `${base}（高通量）`;
  if (flux === 'low') return `${base}（低通量）`;
  return base;
}

function dialysisMembraneRows(stocks: ConsumableStockRow[]): ConsumableStockRow[] {
  return stocks.filter(isDialysisMembraneCatalogRow);
}

function hemoperfusionRows(stocks: ConsumableStockRow[]): ConsumableStockRow[] {
  return stocks.filter(isHemoperfusionCatalogRow);
}

/**
 * 将当前处方中的透析器映射为表单选项 value：优先耗材目录行 id；无目录时用 legacy 前缀字符串。
 */
export function resolveDialyzerFormValue(
  rx: { dialyzer_model?: string | null; dialyzer_flux?: string | null },
  stocks: ConsumableStockRow[],
): string {
  const rawModel = rx.dialyzer_model?.trim() ?? '';
  const fluxRaw = rx.dialyzer_flux?.trim() || null;
  const inferredFlux = fluxRaw ?? inferDialyzerFluxFromLabel(rawModel);

  if (!rawModel && !inferredFlux) return '';

  const rows = dialysisMembraneRows(stocks);
  if (rows.length === 0) {
    return rawModel ? `${LEGACY_DIALYZER_PREFIX}${dialyzerStringForForm(rawModel)}` : '';
  }

  if (!rawModel && inferredFlux) {
    const byFlux = rows.filter((r) => r.dialyzer_flux === inferredFlux);
    const picked = byFlux[0] ?? rows[0];
    return picked ? picked.id : '';
  }

  const nm = normalizeDialyzerCatalogKey(rawModel);
  const candidates = rows.filter((row) => {
    const im = normalizeDialyzerCatalogKey(row.item_name);
    if (!nm || !im) return false;
    return (
      nm === im ||
      nm.includes(im) ||
      im.includes(nm) ||
      rawModel.includes(row.item_name) ||
      row.item_name.includes(rawModel)
    );
  });

  if (candidates.length === 0) {
    return `${LEGACY_DIALYZER_PREFIX}${dialyzerStringForForm(rawModel)}`;
  }

  let narrowed = candidates;
  if (inferredFlux) {
    const fluxMatch = candidates.filter(
      (c) => c.dialyzer_flux === inferredFlux || c.dialyzer_flux == null,
    );
    if (fluxMatch.length > 0) narrowed = fluxMatch;
  } else if (fluxRaw) {
    const fluxMatch = candidates.filter((c) => c.dialyzer_flux === fluxRaw || c.dialyzer_flux == null);
    if (fluxMatch.length > 0) narrowed = fluxMatch;
  }

  return narrowed[0].id;
}

export function buildDialyzerSelectOptions(
  stocks: ConsumableStockRow[],
  /** API 已成功同步仓库后：仅展示仓库中的透析膜材，不再混入内置预设 */
  strictWarehouseOnly = false,
): { value: string; label: string }[] {
  const rows = dialysisMembraneRows(stocks);
  if (rows.length === 0) {
    if (strictWarehouseOnly) return [];
    return getDialyzerSelectOptions().map((o) => ({
      value: `${LEGACY_DIALYZER_PREFIX}${o.value}`,
      label: o.label,
    }));
  }
  return [...rows]
    .sort((a, b) => a.item_name.localeCompare(b.item_name, 'zh-CN'))
    .map((row) => ({
      value: row.id,
      label: formatDialyzerStockLabel(row),
    }));
}

export function buildHemoperfusionSelectOptions(stocks: ConsumableStockRow[]): { value: string; label: string }[] {
  const rows = hemoperfusionRows(stocks);
  return [...rows]
    .sort((a, b) => a.item_name.localeCompare(b.item_name, 'zh-CN'))
    .map((row) => ({
      value: row.id,
      label: row.item_name,
    }));
}

/**
 * 历史处方 / 患者偏好中的灌流器型号 → 表单下拉 value
 */
export function resolveHpCartridgeFormValue(model: string | null | undefined, stocks: ConsumableStockRow[]): string {
  const rawModel = model?.trim() ?? '';
  if (!rawModel) return '';

  const rows = hemoperfusionRows(stocks);
  if (rows.length === 0) {
    return `${LEGACY_HP_PREFIX}${rawModel}`;
  }

  const nm = normalizeDialyzerCatalogKey(rawModel);
  const candidates = rows.filter((row) => {
    const im = normalizeDialyzerCatalogKey(row.item_name);
    if (!nm || !im) return false;
    return (
      nm === im ||
      nm.includes(im) ||
      im.includes(nm) ||
      rawModel.includes(row.item_name) ||
      row.item_name.includes(rawModel)
    );
  });

  if (candidates.length === 0) {
    return `${LEGACY_HP_PREFIX}${rawModel}`;
  }

  return candidates[0].id;
}

/** 提交处方：解析表单里的透析器选项 → DB 字段 */
export function parseDialyzerFormSelection(
  raw: string | undefined,
  stockById: Map<string, ConsumableStockRow>,
): { dialyzer_model: string; dialyzer_flux?: string } {
  const s = String(raw ?? '').trim();
  if (!s) return { dialyzer_model: '' };
  if (s.startsWith(LEGACY_DIALYZER_PREFIX)) {
    const inner = s.slice(LEGACY_DIALYZER_PREFIX.length).trim();
    const inferred = inferDialyzerFluxFromLabel(inner);
    return {
      dialyzer_model: inner,
      ...(inferred ? { dialyzer_flux: inferred } : {}),
    };
  }
  if (isUuid(s)) {
    const row = stockById.get(s);
    if (row && !isHemoperfusionCatalogRow(row)) {
      return {
        dialyzer_model: row.item_name,
        ...(row.dialyzer_flux ? { dialyzer_flux: row.dialyzer_flux } : {}),
      };
    }
  }
  const inferred = inferDialyzerFluxFromLabel(s);
  return {
    dialyzer_model: s,
    ...(inferred ? { dialyzer_flux: inferred } : {}),
  };
}

/** 表单灌流器选项 → 写入 form_extra / 展示的型号文本 */
export function parseHpCartridgeFormSelection(
  raw: string | undefined,
  stockById: Map<string, ConsumableStockRow>,
): { hemoperfusion_model: string } {
  const s = String(raw ?? '').trim();
  if (!s) return { hemoperfusion_model: '' };
  if (s.startsWith(LEGACY_HP_PREFIX)) {
    return { hemoperfusion_model: s.slice(LEGACY_HP_PREFIX.length).trim() };
  }
  if (isUuid(s)) {
    const row = stockById.get(s);
    if (row) return { hemoperfusion_model: row.item_name };
  }
  return { hemoperfusion_model: s };
}

export function dialyzerDisplayShort(
  raw: string | undefined,
  stockById: Map<string, ConsumableStockRow>,
): string {
  if (raw == null || raw === '') return '—';
  const s = String(raw);
  if (s.startsWith(LEGACY_DIALYZER_PREFIX)) {
    const inner = s.slice(LEGACY_DIALYZER_PREFIX.length).replace(/^透析器\s*/, '').trim();
    return inner || '—';
  }
  if (isUuid(s)) {
    const row = stockById.get(s);
    if (row && !isHemoperfusionCatalogRow(row)) {
      const label = formatDialyzerStockLabel(row);
      return label.replace(/^透析器\s*/u, '').trim() || label;
    }
    if (row) return row.item_name.replace(/^透析器\s*/u, '').trim() || row.item_name;
  }
  const t = s.replace(/^透析器\s*/, '').trim();
  return t || '—';
}

export function hpCartridgeDisplayShort(
  raw: string | undefined,
  stockById: Map<string, ConsumableStockRow>,
): string {
  if (raw == null || raw === '') return '—';
  const s = String(raw);
  if (s.startsWith(LEGACY_HP_PREFIX)) {
    return s.slice(LEGACY_HP_PREFIX.length).trim() || '—';
  }
  if (isUuid(s)) {
    const row = stockById.get(s);
    if (row) return row.item_name.trim() || row.item_name;
  }
  return s.trim() || '—';
}
