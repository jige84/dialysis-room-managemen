/**
 * 路由路径 → 顶栏中文标题映射
 * 主要作用：与 AppLayout 顶栏标题保持一致，便于设置 document.title 或面包屑。
 * 主要功能：PAGE_TITLES 表；getPageTitle(pathname) 解析函数（见文件内实现）。
 */

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': '今日概览',
  '/patients': '患者档案',
  '/dialysis': '透析工作台',
  '/dialysis/today': '透析工作台',
  '/dialysis/entry': '透析工作台',
  '/prescription': '透析处方管理',
  '/orders': '长期医嘱单',
  '/labs': '检验结果管理',
  '/vascular': '血管通路管理',
  '/infection': '传染病管理',
  '/alerts': '预警中心',
  '/reports': '质控上报报表',
  '/cqi': 'CQI持续改进',
  '/schedule': '排班管理',
  '/devices': '设备耗材',
  '/admin/users': '用户管理',
  '/no-access': '无可用菜单权限',
  '/ai/assistant': 'AI 分析助手',
  '/ai/guidelines': '指南阅读中心',
  '/ai/knowledge': '知识库管理',
  '/ai/sites': '专业网站配置',
};

export function getPageTitle(pathname: string): string {
  if (pathname === '/patients') return PAGE_TITLES['/patients'];
  if (pathname === '/patients/new') return '新建患者档案';
  if (/^\/patients\/[^/]+$/.test(pathname)) return '患者详情';
  if (pathname === '/dialysis' || pathname === '/dialysis/') return PAGE_TITLES['/dialysis'];

  const exact = PAGE_TITLES[pathname];
  if (exact) return exact;

  const match = Object.entries(PAGE_TITLES).find(
    ([key]) => key !== '/' && pathname.startsWith(key),
  );
  return match?.[1] ?? '血液透析室管理系统';
}
