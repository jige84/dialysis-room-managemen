/**
 * 侧栏模块路径与当前 URL 的对应关系（用于菜单过滤与路由守卫）
 */
import type { SidebarMenuKey } from '../constants/sidebarModules';
import { ALL_SIDEBAR_MENU_KEYS } from '../constants/sidebarModules';
import type { AiAssistantFeaturePermissionKey } from '../constants/aiAssistantFeatures';
import { AI_FEAT_PREFIX } from '../constants/aiAssistantFeatures';

const KEY_SET = new Set<string>(ALL_SIDEBAR_MENU_KEYS);

/**
 * 将 users.menu_permissions 规范为 string[]，避免 JSONB/缓存导致非数组形态时误判为「无权限」。
 * 无法解析时视为空数组（与后端白名单不一致时由路由层处理）。
 */
export function normalizeMenuPermissions(raw: unknown): string[] | null | undefined {
  if (raw === null || raw === undefined) return raw;
  if (Array.isArray(raw)) {
    return raw.filter((x): x is string => typeof x === 'string').map(k => k.trim());
  }
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return [];
    try {
      const p = JSON.parse(t) as unknown;
      if (Array.isArray(p)) {
        return p.filter((x): x is string => typeof x === 'string').map(k => k.trim());
      }
    } catch {
      return [];
    }
  }
  return [];
}

/** 将当前路径映射为侧栏模块 key */
export function pathToMenuKey(pathname: string): SidebarMenuKey | null {
  const p = pathname.replace(/\/$/, '') || '/';
  if (p === '/' || p.startsWith('/dashboard')) return '/dashboard';
  if (p.startsWith('/patients')) return '/patients';
  if (p.startsWith('/dialysis/today')) return '/dialysis/entry';
  if (p.startsWith('/dialysis/entry')) return '/dialysis/entry';
  if (p.startsWith('/ai/assistant')) return '/ai/assistant';
  if (p.startsWith('/ai/guidelines')) return '/ai/guidelines';
  if (p.startsWith('/ai/knowledge')) return '/ai/knowledge';
  if (p.startsWith('/ai/sites')) return '/ai/sites';
  if (p.startsWith('/admin/users')) return '/admin/users';
  const m = p.match(/^(\/[^/]+)/);
  const first = m ? m[1] : p;
  if (KEY_SET.has(first)) return first as SidebarMenuKey;
  return null;
}

/** menu_permissions 为 null/undefined 时不额外限制；空数组表示不可访问任何模块（由路由层先处理） */
export function isMenuKeyAllowed(
  key: SidebarMenuKey | null,
  menuPermissions: string[] | null | undefined
): boolean {
  const mp = normalizeMenuPermissions(menuPermissions);
  if (mp === null || mp === undefined) return true;
  if (mp.length === 0) return false;
  if (key === null) return true;
  return mp.includes(key);
}

export function isPathAllowedByMenuPermissions(
  pathname: string,
  menuPermissions: string[] | null | undefined
): boolean {
  const key = pathToMenuKey(pathname);
  return isMenuKeyAllowed(key, menuPermissions);
}

/**
 * AI 分析助手子功能：须能进入 /ai/assistant；若无任一 ai_feat:* → 全部子功能可用。
 */
export function hasAiAssistantFeature(
  menuPermissions: string[] | null | undefined,
  featureKey: AiAssistantFeaturePermissionKey
): boolean {
  if (!isMenuKeyAllowed('/ai/assistant', menuPermissions)) return false;
  const mp = normalizeMenuPermissions(menuPermissions);
  if (mp === null || mp === undefined) return true;
  const granular = mp.filter(k => k.startsWith(AI_FEAT_PREFIX));
  if (granular.length === 0) return true;
  return granular.includes(featureKey);
}
