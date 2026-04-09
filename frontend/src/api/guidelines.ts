/**
 * 临床指南阅读与笔记 API
 * 主要作用：对接 `/api/guidelines`，支持文本粘贴、URL、DOI 等来源的指南条目管理。
 * 主要功能：列表、创建、生成阅读笔记、保存至知识库；类型与分页与全局 `request` 一致。
 */
import request, { type ApiResponse, type PagedData } from './request';

export type GuidelineSourceType = 'text_paste' | 'url' | 'doi';

export interface GuidelineDocRow {
  id: string;
  title: string;
  source_type: GuidelineSourceType;
  source_url: string | null;
  source_doi: string | null;
  raw_text: string | null;
  reading_note: { markdown?: string; retrieval?: unknown } | null;
  note_generated_at: string | null;
  note_model: string | null;
  is_saved_to_kb: boolean;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface GuidelineNoticeRow {
  id: string;
  title: string;
  message: string;
  created_at: string;
}

export const guidelinesApi = {
  list(page = 1, pageSize = 20, q?: string) {
    return request.get<ApiResponse<PagedData<GuidelineDocRow>>>(
      '/guidelines',
      { params: { page, pageSize, ...(q != null && q !== '' ? { q } : {}) } },
    );
  },

  get(id: string) {
    return request.get<ApiResponse<GuidelineDocRow>>(`/guidelines/${id}`);
  },

  create(body: {
    title: string;
    sourceType: GuidelineSourceType;
    sourceUrl?: string | null;
    sourceDoi?: string | null;
    rawText?: string | null;
  }) {
    return request.post<ApiResponse<GuidelineDocRow>>('/guidelines', body, { timeout: 120000 });
  },

  generateNote(id: string) {
    return request.post<ApiResponse<GuidelineDocRow>>(`/guidelines/${id}/generate-note`, {}, {
      timeout: 180000,
    });
  },

  saveToKb(id: string) {
    return request.post<ApiResponse<{ saved: boolean; duplicate?: boolean; documentId?: string | null }>>(
      `/guidelines/${id}/save-to-kb`,
    );
  },

  listNotices() {
    return request.get<ApiResponse<{ list: GuidelineNoticeRow[] }>>('/guidelines/notices');
  },

  markAllNoticesRead() {
    return request.post<ApiResponse<{ updated: number }>>('/guidelines/notices/read-all');
  },

  remove(id: string) {
    return request.delete<ApiResponse<{ deleted: boolean }>>(`/guidelines/${id}`);
  },
};
