import type { AiKbSaveOverview } from '../api/ai';

/** 将入库概览格式化为一句可读说明（用于 message / Alert） */
export function formatKbSaveOverviewLine(overview: AiKbSaveOverview | undefined): string {
  if (!overview) return '';
  const parts: string[] = [];
  parts.push(`资料片段 ${overview.chunk_count} 条`);
  if (overview.kb_query?.trim()) {
    const q = overview.kb_query.trim();
    parts.push(`检索 ${q.length > 72 ? `${q.slice(0, 72)}…` : q}`);
  }
  if (overview.subcategory?.trim()) {
    parts.push(`分类 ${overview.subcategory.trim()}`);
  }
  if (overview.text_preview?.trim()) {
    const t = overview.text_preview.trim();
    parts.push(`首段 ${t.length > 100 ? `${t.slice(0, 100)}…` : t}`);
  }
  return parts.join(' ');
}
