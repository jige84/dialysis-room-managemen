/**
 * 处方透析器字段 ↔ 耗材目录 consumable_stocks（category=dialyzer）对齐
 */
import type { ConsumableStockRow } from '../api/devices';
import { getDialyzerSelectOptions } from '../constants/dialyzerConsumables';
import { isUuid } from './anomalyAnalysis';

export const LEGACY_DIALYZER_PREFIX = 'legacy|||';

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

  const rows = stocks.filter((s) => s.category === 'dialyzer');
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

export function buildDialyzerSelectOptions(stocks: ConsumableStockRow[]): { value: string; label: string }[] {
  const rows = stocks.filter((s) => s.category === 'dialyzer');
  if (rows.length === 0) {
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
    if (row) {
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
    if (row) return row.item_name.replace(/^透析器\s*/, '').trim() || row.item_name;
  }
  const t = s.replace(/^透析器\s*/, '').trim();
  return t || '—';
}
