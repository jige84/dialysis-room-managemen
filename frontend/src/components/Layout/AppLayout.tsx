/**
 * 登录后主布局：顶栏、侧栏导航与内容区 Outlet
 * 主要作用：提供血液透析室管理系统的统一壳子与菜单路由切换。
 * 主要功能：折叠侧栏；用户信息与退出；按路由显示页面标题；消息/预警入口（依实现）。
 */
import { useState, useEffect } from 'react';
import { Badge, Dropdown, Space, Tooltip } from 'antd';
import { LogoutOutlined, SettingOutlined, BellOutlined, MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { authApi } from '../../api/auth';
import alertsApi from '../../api/alerts';
import { message } from 'antd';
import dayjs from 'dayjs';
import { getPageTitle } from '../../utils/pageTitle';

const ROLE_LABELS: Record<string, string> = {
  admin: '超级管理员',
  head_nurse: '护士长',
  nurse: '责任护士',
  doctor: '主治医生',
  quality: '质控人员',
};

type NavItem = { key: string; icon: string; label: string; badge?: number };
type NavSection = { title: string; items: NavItem[] };

const NAV_SECTIONS: NavSection[] = [
  {
    title: '工作台',
    items: [
      { key: '/dashboard', icon: '📊', label: '今日概览' },
      { key: '/alerts',    icon: '🔔', label: '预警中心' },
    ],
  },
  {
    title: '患者管理',
    items: [
      { key: '/patients',       icon: '👥', label: '患者档案' },
      { key: '/dialysis/entry', icon: '💉', label: '透析记录录入' },
      { key: '/prescription',   icon: '💊', label: '透析处方管理' },
      { key: '/orders',         icon: '📋', label: '长期医嘱单' },
      { key: '/labs',           icon: '🧪', label: '检验结果管理' },
      { key: '/vascular',       icon: '🫀', label: '血管通路管理' },
      { key: '/infection',      icon: '🦠', label: '传染病管理' },
    ],
  },
  {
    title: '专项管理',
    items: [
      { key: '/schedule', icon: '📅', label: '排班管理' },
    ],
  },
  {
    title: '质量管理',
    items: [
      { key: '/reports', icon: '📈', label: '质控上报报表' },
      { key: '/cqi',     icon: '🔄', label: 'CQI持续改进' },
    ],
  },
  {
    title: '系统',
    items: [
      { key: '/devices',      icon: '⚙️', label: '设备耗材' },
      { key: '/admin/users',  icon: '👤', label: '用户管理' },
    ],
  },
];

const SIDER_WIDTH = 240;
const SIDER_COLLAPSED_WIDTH = 64;

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [pendingAlerts, setPendingAlerts] = useState(0);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuthStore();

  useEffect(() => {
    const fetchAlertCount = async () => {
      try {
        const res = await alertsApi.getSummary();
        setPendingAlerts(res.data.data?.total || 0);
      } catch { /* 静默失败 */ }
    };
    fetchAlertCount();
    const timer = setInterval(fetchAlertCount, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  const handleLogout = async () => {
    try { await authApi.logout(); } catch { /* 忽略网络错误 */ }
    logout();
    navigate('/login');
    message.success('已安全退出');
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

  const isActive = (key: string) => {
    if (key === '/dashboard') return location.pathname === '/dashboard' || location.pathname === '/';
    return location.pathname.startsWith(key);
  };

  const currentTitle = getPageTitle(location.pathname);

  const userInitial = user?.real_name?.charAt(0) ?? '?';

  const navSectionsWithBadge = NAV_SECTIONS.map(section => ({
    ...section,
    items: section.items.map(item =>
      item.key === '/alerts' ? { ...item, badge: pendingAlerts } : item
    ),
  }));

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* ── 侧边栏 ── */}
      <aside
        aria-label="系统主导航侧栏"
        style={{
        width: collapsed ? SIDER_COLLAPSED_WIDTH : SIDER_WIDTH,
        background: 'linear-gradient(180deg, #0F1C3F 0%, #162352 60%, #0D2060 100%)',
        boxShadow: '2px 0 20px rgba(14,165,233,0.08)',
        borderRight: '1px solid rgba(14,165,233,0.12)',
        position: 'fixed',
        height: '100vh',
        left: 0, top: 0,
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        transition: 'width 0.25s',
        flexShrink: 0,
      }}
      >
        {/* 品牌标识 */}
        <div className="hd-sidebar-brand">
          <div className="hd-sidebar-brand-icon">🩸</div>
          {!collapsed && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', lineHeight: '1.2' }}>
                善谷医院
              </div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 1 }}>
                血液透析室
              </div>
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
              {collapsed && <div style={{ height: 8 }} />}
              {section.items.map(item => {
                const active = isActive(item.key);
                const navItem = (
                  <div
                    key={item.key}
                    role="button"
                    tabIndex={0}
                    className={`hd-nav-item${active ? ' active' : ''}`}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => navigate(item.key)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        navigate(item.key);
                      }
                    }}
                    style={collapsed ? { justifyContent: 'center', padding: '9px 0' } : undefined}
                  >
                    <span className="hd-nav-icon">{item.icon}</span>
                    {!collapsed && (
                      <>
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {item.label}
                        </span>
                        {item.badge !== undefined && item.badge > 0 && (
                          <span className="hd-nav-badge">{item.badge > 99 ? '99+' : item.badge}</span>
                        )}
                      </>
                    )}
                    {collapsed && item.badge !== undefined && item.badge > 0 && (
                      <span style={{
                        position: 'absolute', top: 4, right: 4,
                        width: 8, height: 8, borderRadius: '50%',
                        background: '#F43F5E', border: '1.5px solid rgba(15,28,63,0.8)',
                      }} />
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
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {user?.real_name}
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>
                    {ROLE_LABELS[user?.role || ''] || user?.role}
                  </div>
                </div>
              )}
            </div>
          </Dropdown>
        </div>
      </aside>

      {/* ── 右侧主区域 ── */}
      <div style={{
        marginLeft: collapsed ? SIDER_COLLAPSED_WIDTH : SIDER_WIDTH,
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
        transition: 'margin-left 0.25s',
      }}>
        {/* 顶部栏 */}
        <header style={{
          height: 60,
          background: '#fff',
          padding: '0 24px',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          boxShadow: '0 1px 0 0 #BFDBFE, 0 2px 12px rgba(14,165,233,0.06)',
          position: 'sticky',
          top: 0,
          zIndex: 99,
          flexShrink: 0,
        }}>
          {/* 折叠按钮 */}
          <button
            type="button"
            className="hd-focus-ring"
            aria-expanded={!collapsed}
            aria-controls="sidebar-nav"
            aria-label={collapsed ? '展开侧边导航' : '收起侧边导航'}
            style={{
              fontSize: 18,
              cursor: 'pointer',
              color: '#3D5280',
              flexShrink: 0,
              background: 'none',
              border: 'none',
              padding: 4,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          </button>

          {/* 当前页标题 */}
          <h1 className="hd-topbar-title" style={{ flex: 1 }}>{currentTitle}</h1>

          {/* 右侧信息区 */}
          <Space size={12}>
            <Space size={6}>
              <span style={{ fontSize: 12, color: '#7B92BC' }}>涉县善谷医院 血液透析室</span>
              <span style={{
                background: '#EEF2FF', color: '#4338CA',
                fontSize: 12, padding: '2px 10px', borderRadius: 20,
                border: '1px solid #C7D2FE', fontWeight: 500,
              }}>
                {ROLE_LABELS[user?.role || ''] || user?.role}
              </span>
            </Space>

            <div className="hd-topbar-date">
              {dayjs().format('YYYY年MM月DD日 dddd')}
            </div>

            <Badge
              count={pendingAlerts}
              overflowCount={99}
              offset={[-2, 2]}
              classNames={{ indicator: pendingAlerts > 0 ? 'hd-bell-badge' : '' }}
            >
              <button
                type="button"
                className="hd-focus-ring"
                aria-label={pendingAlerts > 0 ? `预警中心，${pendingAlerts} 条待处理` : '预警中心'}
                style={{
                  width: 36, height: 36, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', fontSize: 18,
                  background: '#F0F9FF',
                  border: '1.5px solid #BAE6FD',
                  transition: 'background 0.15s',
                }}
                onClick={() => navigate('/alerts')}
              >
                <BellOutlined style={{ color: pendingAlerts > 0 ? '#F43F5E' : '#0369A1' }} />
              </button>
            </Badge>

            <div style={{ width: 1, height: 20, background: '#DBEAFE' }} />

            <span
              style={{
                fontSize: 13, color: '#3D5280', cursor: 'pointer',
                padding: '5px 12px', borderRadius: 6,
                border: '1.5px solid #BFDBFE',
                transition: 'all 0.15s',
              }}
              onClick={handleLogout}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.borderColor = '#0EA5E9';
                (e.currentTarget as HTMLElement).style.color = '#0284C7';
                (e.currentTarget as HTMLElement).style.background = '#F0F9FF';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.borderColor = '#BFDBFE';
                (e.currentTarget as HTMLElement).style.color = '#3D5280';
                (e.currentTarget as HTMLElement).style.background = 'transparent';
              }}
            >
              退出
            </span>
          </Space>
        </header>

        {/* 页面内容：内边距由 PageShell 统一承担 */}
        <main className="hd-main-outlet" id="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
