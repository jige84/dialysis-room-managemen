/**
 * 登录后主布局：顶栏、侧栏导航与内容区 Outlet
 * 主要作用：提供血液透析室管理系统的统一壳子与菜单路由切换。
 * 主要功能：折叠侧栏；用户信息与退出；按路由显示页面标题；消息/预警入口（依实现）。
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import { Badge, Dropdown, Tooltip, message } from 'antd';
import { LogoutOutlined, SettingOutlined, BellOutlined, MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { authApi } from '../../api/auth';
import alertsApi from '../../api/alerts';
import dayjs from 'dayjs';
import { getPageTitle } from '../../utils/pageTitle';
import { ROLE_LABELS } from '../../constants/roleLabels';
import { usePermission } from '../../utils/permission';
import { SIDEBAR_NAV_SECTIONS, canRoleAccessClinicalAi, isClinicalAiMenuKey } from '../../constants/sidebarModules';
import type { SidebarMenuKey, SidebarNavItem } from '../../constants/sidebarModules';

const SIDER_WIDTH = 240;
const SIDER_COLLAPSED_WIDTH = 64;

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [mobileNavOpenPath, setMobileNavOpenPath] = useState<string | null>(null);
  const [pendingAlerts, setPendingAlerts] = useState(0);
  const navigate = useNavigate();
  const location = useLocation();
  const mobileNavOpen = isMobileViewport && mobileNavOpenPath === location.pathname;
  const { user, logout } = useAuthStore();
  const menuPermissions = useAuthStore(s => s.user?.menu_permissions);
  const { canManageUsers, canManageMedicalSites } = usePermission();

  /** 用于检测「从非 AI 路由进入 /ai/*」，便于管理员改权限后刷新页面即可拉取最新 menu_permissions */
  const prevPathForAiRef = useRef<string>('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authApi.me();
        if (res.data.code !== 200 || !res.data.data) return;
        const u = res.data.data;
        if (!cancelled) useAuthStore.getState().updateUser(u);
      } catch {
        /* 静默失败，沿用本地缓存 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const prev = prevPathForAiRef.current;
    prevPathForAiRef.current = location.pathname;
    if (!location.pathname.startsWith('/ai')) return;
    if (prev.startsWith('/ai')) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await authApi.me();
        if (res.data.code !== 200 || !res.data.data) return;
        if (!cancelled) useAuthStore.getState().updateUser(res.data.data);
      } catch {
        /* 静默失败 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  useEffect(() => {
    const fetchAlertCount = async () => {
      try {
        const res = await alertsApi.summary();
        setPendingAlerts(res.data.data?.total || 0);
      } catch { /* 静默失败 */ }
    };
    fetchAlertCount();
    const timer = setInterval(fetchAlertCount, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 960px)');
    const syncViewport = (matches: boolean) => {
      setIsMobileViewport(matches);
      if (!matches) {
        setMobileNavOpenPath(null);
      }
    };
    syncViewport(media.matches);
    const handler = (event: MediaQueryListEvent) => syncViewport(event.matches);
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    if (!isMobileViewport || !mobileNavOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileNavOpenPath(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isMobileViewport, mobileNavOpen]);

  const handleLogout = async () => {
    try { await authApi.logout(); } catch { /* 忽略网络错误 */ }
    logout();
    setMobileNavOpenPath(null);
    navigate('/login');
    message.success('已安全退出');
  };

  const handleNavigate = (target: string) => {
    navigate(target);
    if (isMobileViewport) {
      setMobileNavOpenPath(null);
    }
  };

  const userMenu = {
    items: [
      { key: 'change-pwd', icon: <SettingOutlined />, label: '修改密码' },
      { type: 'divider' as const },
      { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', danger: true },
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === 'logout') handleLogout();
    },
  };

  const isNavItemActive = (item: SidebarNavItem) => {
    const path = item.routePath ?? item.key;
    if (path === '/dashboard') return location.pathname === '/dashboard' || location.pathname === '/';
    if (path === '/dialysis') return location.pathname.startsWith('/dialysis');
    return location.pathname.startsWith(path);
  };

  const currentTitle = getPageTitle(location.pathname);

  const userInitial = user?.real_name?.charAt(0) ?? '?';

  const navSectionsWithBadge = useMemo(() => {
    const restrictMenu = menuPermissions !== null && menuPermissions !== undefined;
    return SIDEBAR_NAV_SECTIONS.map(section => ({
      ...section,
      items: section.items
        .filter(item => {
          if (item.key === '/admin/users' && !canManageUsers) return false;
          if ('adminOnly' in item && item.adminOnly && !canManageMedicalSites) return false;
          if (isClinicalAiMenuKey(item.key) && !canRoleAccessClinicalAi(user?.role)) return false;
          if (restrictMenu) {
            const k = item.key as SidebarMenuKey;
            if (k === '/dialysis/today') {
              const ok =
                menuPermissions.includes('/dialysis/today') || menuPermissions.includes('/dialysis/entry');
              if (!ok) return false;
            } else if (!menuPermissions.includes(k)) {
              return false;
            }
          }
          return true;
        })
        .map(item =>
          item.key === '/alerts' ? { ...item, badge: pendingAlerts } : item
        ),
    }));
  }, [canManageUsers, canManageMedicalSites, pendingAlerts, menuPermissions, user?.role]);

  const canSeeAlertsNav = useMemo(() => {
    if (menuPermissions === null || menuPermissions === undefined) return true;
    return menuPermissions.includes('/alerts');
  }, [menuPermissions]);

  return (
    <div className="hd-app-frame">
      {/* ── 侧边栏 ── */}
      <aside
        aria-label="系统主导航侧栏"
        className={`hd-app-sidebar${collapsed ? ' is-collapsed' : ''}${isMobileViewport ? ' is-mobile' : ''}${mobileNavOpen ? ' is-mobile-open' : ''}`}
        style={{
          width: isMobileViewport ? SIDER_WIDTH : (collapsed ? SIDER_COLLAPSED_WIDTH : SIDER_WIDTH),
        }}
      >
        {/* 品牌标识 */}
        <div className="hd-sidebar-brand">
          <div className="hd-sidebar-brand-icon">HD</div>
          {!collapsed && (
            <div className="hd-sidebar-brand-copy">
              <div className="hd-sidebar-brand-name">善谷医院</div>
              <div className="hd-sidebar-brand-unit">血液透析室管理系统</div>
            </div>
          )}
        </div>

        {/* 导航菜单 */}
        <nav id="sidebar-nav" className="hd-sidebar-nav" aria-label="主导航">
          {navSectionsWithBadge.map(section => (
            <div key={section.title}>
              {!collapsed && (
                <div className="hd-nav-section-title">{section.title}</div>
              )}
              {collapsed && <div className="hd-nav-section-gap" />}
              {section.items.map(item => {
                const navTarget = item.routePath ?? item.key;
                const active = isNavItemActive(item);
                const navItem = (
                  <div
                    key={item.key}
                    role="button"
                    tabIndex={0}
                    className={`hd-nav-item${active ? ' active' : ''}`}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => handleNavigate(navTarget)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleNavigate(navTarget);
                      }
                    }}
                    style={!isMobileViewport && collapsed ? { justifyContent: 'center', padding: '9px 0' } : undefined}
                  >
                    <span className="hd-nav-icon">{item.icon}</span>
                    {!collapsed && (
                      <>
                        <span className="hd-nav-label">
                          {item.label}
                        </span>
                        {item.badge !== undefined && item.badge > 0 && (
                          <span className="hd-nav-badge">{item.badge > 99 ? '99+' : item.badge}</span>
                        )}
                      </>
                    )}
                    {collapsed && item.badge !== undefined && item.badge > 0 && (
                      <span className="hd-nav-dot" />
                    )}
                  </div>
                );
                return collapsed ? (
                  <Tooltip key={item.key} title={item.label} placement="right">
                    {navItem}
                  </Tooltip>
                ) : navItem;
              })}
            </div>
          ))}
        </nav>

        {/* 底部用户信息 */}
        <div className="hd-sidebar-footer">
          <Dropdown menu={userMenu} placement="topLeft" trigger={['click']}>
            <div className="hd-sidebar-user">
              <div className="hd-user-avatar">{userInitial}</div>
              {!collapsed && (
                <div className="hd-sidebar-user-meta">
                  <div className="hd-sidebar-user-name">
                    {user?.real_name}
                  </div>
                  <div className="hd-sidebar-user-role">
                    {ROLE_LABELS[user?.role || ''] || user?.role}
                  </div>
                </div>
              )}
            </div>
          </Dropdown>
        </div>
      </aside>
      {isMobileViewport && mobileNavOpen ? (
        <button
          type="button"
          className="hd-mobile-backdrop"
          aria-label="关闭导航"
          onClick={() => setMobileNavOpenPath(null)}
        />
      ) : null}

      {/* ── 右侧主区域 ── */}
      <div
        className="hd-app-main"
        style={{ marginLeft: isMobileViewport ? 0 : (collapsed ? SIDER_COLLAPSED_WIDTH : SIDER_WIDTH) }}
      >
        {/* 顶部栏 */}
        <header className="hd-topbar">
          {/* 折叠按钮 */}
          <button
            type="button"
            className="hd-topbar-toggle hd-focus-ring"
            aria-expanded={isMobileViewport ? mobileNavOpen : !collapsed}
            aria-controls="sidebar-nav"
            aria-label={isMobileViewport ? (mobileNavOpen ? '关闭侧边导航' : '打开侧边导航') : (collapsed ? '展开侧边导航' : '收起侧边导航')}
            onClick={() => {
              if (isMobileViewport) {
                setMobileNavOpenPath(prev => (prev === location.pathname ? null : location.pathname));
                return;
              }
              setCollapsed(!collapsed);
            }}
          >
            {isMobileViewport
              ? (mobileNavOpen ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />)
              : (collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />)}
          </button>

          <div className="hd-topbar-context">
            <h1 className="hd-topbar-title">{currentTitle}</h1>
          </div>

          <div className="hd-topbar-meta">
            <div className="hd-topbar-date">
              {dayjs().format('MM月DD日 dddd')}
            </div>

            {canSeeAlertsNav ? (
              <Badge
                count={pendingAlerts}
                overflowCount={99}
                offset={[-2, 2]}
                classNames={{ indicator: pendingAlerts > 0 ? 'hd-bell-badge' : '' }}
              >
                <button
                  type="button"
                  className="hd-topbar-alert-btn hd-focus-ring"
                  aria-label={pendingAlerts > 0 ? `预警中心，${pendingAlerts} 条待处理` : '预警中心'}
                  onClick={() => navigate('/alerts')}
                >
                  <BellOutlined className={pendingAlerts > 0 ? 'is-warning' : ''} />
                </button>
              </Badge>
            ) : null}

            <Tooltip title="退出登录" placement="bottom">
              <button
                type="button"
                className="hd-topbar-logout hd-focus-ring"
                aria-label="退出登录"
                onClick={handleLogout}
              >
                <LogoutOutlined />
              </button>
            </Tooltip>
          </div>
        </header>

        {/* 页面内容：内边距由 PageShell 统一承担 */}
        <main className="hd-main-outlet" id="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
