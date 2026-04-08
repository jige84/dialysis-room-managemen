/**
 * 本地知识库 API 封装（kb_documents / kb_chunks）
 * 主要作用：与后端 `/api/knowledge` 路由对接，供知识管理页与 AI 检索使用。
 * 主要功能：文档分页列表、分块查询、删除等；类型定义与分页结构复用 `request` 约定。
 */
import request, { type ApiResponse, type PagedData } from './request';

export interface KbDocumentRow {
  id: string;
  source_type: string;
  title: string;
  source_url: string | null;
  content_hash: string | null;
  status: string;
  is_verified: boolean;
  created_at: string;
  updated_at: string;
}

export interface KbChunkRow {
  id: string;
  chunk_index: number;
  content_text: string;
  tags: string | null;
  created_at: string;
}

export const knowledgeApi = {
  listDocuments(params: { page?: number; pageSize?: number; sourceType?: string }) {
    return request.get<ApiResponse<PagedData<KbDocumentRow>>>(
      '/knowledge/documents',
      { params },
    );
  },

  getDocument(id: string) {
    return request.get<
      ApiResponse<{ document: KbDocumentRow; chunks: KbChunkRow[] }>
    >(`/knowledge/documents/${id}`);
  },

  patchDocument(id: string, body: { is_verified?: boolean; status?: 'draft' | 'published' }) {
    return request.patch<ApiResponse<KbDocumentRow>>(`/knowledge/documents/${id}`, body);
  },
};
