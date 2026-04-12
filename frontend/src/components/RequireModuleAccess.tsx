/**
 * 按用户 menu_permissions 限制主内容区路由（侧栏过滤在 AppLayout；服务端仍以 RBAC 为准）
 */
import { useMemo } from 'react';
import { Navigate, useLocation, Outlet } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { isPathAllowedByMenuPermissions } from '../utils/menuAccess';

export default function RequireModuleAccess() {
  const location = useLocation();
  const menuPermissions = useAuthStore(s => s.user?.menu_permissions);
  const role = useAuthStore(s => s.user?.role);

  const redirect = useMemo(() => {
    if (menuPermissions === null || menuPermissions === undefined) {
      return null;
    }
    if (menuPermissions.length > 0 && location.pathname === '/no-access') {
      return menuPermissions[0];
    }
    if (menuPermissions.length === 0) {
      if (location.pathname === '/no-access') return null;
      return '/no-access';
    }
    if (isPathAllowedByMenuPermissions(location.pathname, menuPermissions, role)) {
      return null;
    }
    return menuPermissions[0] ?? '/dashboard';
  }, [location.pathname, menuPermissions, role]);

  if (redirect) {
    return <Navigate to={redirect} replace />;
  }
  return <Outlet />;
}
