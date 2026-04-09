/**
 * 侧栏功能模块定义（与 AppLayout 导航一致，供权限配置与菜单过滤共用）
 */
export type SidebarMenuKey = (typeof ALL_SIDEBAR_MENU_KEYS)[number];

/** 与后端 users.menu_permissions 白名单一致 */
export const ALL_SIDEBAR_MENU_KEYS = [
  '/dashboard',
  '/alerts',
  '/patients',
  '/dialysis/today',
  '/dialysis/entry',
  '/prescription',
  '/orders',
  '/labs',
  '/vascular',
  '/infection',
  '/schedule',
  '/reports',
  '/cqi',
  '/ai/assistant',
  '/ai/guidelines',
  '/ai/knowledge',
  '/ai/sites',
  '/devices',
  '/admin/users',
] as const;

export const ADMIN_ONLY_MENU_KEYS: SidebarMenuKey[] = ['/admin/users', '/ai/sites'];

/** 临床 AI 子模块（不含仅管理员的专业网站配置），与用户管理中勾选项一致 */
export const AI_CLINICAL_MENU_KEYS: readonly SidebarMenuKey[] = [
  '/ai/assistant',
  '/ai/guidelines',
  '/ai/knowledge',
];

export type SidebarNavItem = {
  key: SidebarMenuKey;
  /** 与 key 不一致时的实际路由（如透析工作台挂载在 /dialysis） */
  routePath?: string;
  icon: string;
  label: string;
  adminOnly?: boolean;
  /** 侧栏运行时注入（如预警条数） */
  badge?: number;
};

export type SidebarNavSection = { title: string; items: SidebarNavItem[] };

/** 侧栏分组（与 AppLayout 展示一致） */
export const SIDEBAR_NAV_SECTIONS: SidebarNavSection[] = [
  {
    title: '工作台',
    items: [
      { key: '/dashboard', icon: '📊', label: '今日概览' },
      { key: '/alerts', icon: '🔔', label: '预警中心' },
    ],
  },
  {
    title: '患者管理',
    items: [
      { key: '/patients', icon: '👥', label: '患者档案' },
      { key: '/dialysis/today', routePath: '/dialysis', icon: '💉', label: '透析工作台' },
      { key: '/prescription', icon: '💊', label: '透析处方管理' },
      { key: '/orders', icon: '📋', label: '长期医嘱单' },
      { key: '/labs', icon: '🧪', label: '检验结果管理' },
      { key: '/vascular', icon: '🫀', label: '血管通路管理' },
      { key: '/infection', icon: '🦠', label: '传染病管理' },
    ],
  },
  {
    title: '专项管理',
    items: [{ key: '/schedule', icon: '📅', label: '排班管理' }],
  },
  {
    title: '质量管理',
    items: [
      { key: '/reports', icon: '📈', label: '质控上报报表' },
      { key: '/cqi', icon: '🔄', label: 'CQI持续改进' },
    ],
  },
  {
    title: 'AI 临床分析',
    items: [
      { key: '/ai/assistant', icon: '🤖', label: 'AI 分析助手' },
      { key: '/ai/guidelines', icon: '📖', label: '指南阅读中心' },
      { key: '/ai/knowledge', icon: '📚', label: '知识库管理' },
      { key: '/ai/sites', icon: '🌐', label: '专业网站配置', adminOnly: true },
    ],
  },
  {
    title: '系统',
    items: [
      { key: '/devices', icon: '⚙️', label: '设备耗材' },
      { key: '/admin/users', icon: '👤', label: '用户管理', adminOnly: true },
    ],
  },
];

/** 某角色可配置的模块 key（非管理员不可勾选仅管理员侧栏项） */
export function menuKeysConfigurableForRole(role: string): SidebarMenuKey[] {
  const isAdmin = role === 'admin';
  if (isAdmin) return [...ALL_SIDEBAR_MENU_KEYS];
  return ALL_SIDEBAR_MENU_KEYS.filter(k => !ADMIN_ONLY_MENU_KEYS.includes(k));
}
