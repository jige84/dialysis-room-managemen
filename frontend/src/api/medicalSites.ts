/**
 * 外部医学站点配置 API
 * 主要作用：管理可配置的检索入口、指南链接、限速与可达性探测结果（管理员）。
 * 主要功能：列表、更新启用状态与 URL 等字段，供「站点配置」页与指南/AI 模块引用。
 */
import request, { type ApiResponse } from './request';

export interface MedicalSiteRow {
  id: string;
  site_key: string;
  display_name: string;
  base_url: string | null;
  search_url: string | null;
  guidelines_url: string | null;
  specialty: string[] | null;
  priority: number;
  enabled: boolean;
  rate_limit_ms: number;
  description: string | null;
  last_tested_at: string | null;
  is_reachable: boolean;
  created_at: string;
  updated_at: string;
}

export const medicalSitesApi = {
  list() {
    return request.get<ApiResponse<MedicalSiteRow[]>>('/medical-sites');
  },

  patch(siteKey: string, body: Partial<Pick<MedicalSiteRow,
    'display_name' | 'base_url' | 'search_url' | 'guidelines_url' | 'priority' | 'enabled' | 'rate_limit_ms' | 'description'
  >>) {
    return request.patch<ApiResponse<MedicalSiteRow>>(`/medical-sites/${siteKey}`, body);
  },

  test(siteKey: string) {
    return request.post<ApiResponse<{ ok: boolean; status: number }>>(
      `/medical-sites/${siteKey}/test`,
    );
  },
};
