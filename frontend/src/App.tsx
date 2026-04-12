/**
 * 根组件：路由、Ant Design 中文本地化与鉴权布局
 * 主要作用：定义全站路由表与登录保护，挂载带侧栏的主布局。
 * 主要功能：BrowserRouter + 各业务页面懒加载式导入；RequireAuth；dayjs 中文；ConfigProvider zhCN。
 */
import { useEffect, Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { message } from 'antd';
import { ConfigProvider, App as AntApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';

import { useAuthStore } from './stores/authStore';
import AppLayout from './components/Layout/AppLayout';
import RequireModuleAccess from './components/RequireModuleAccess';
import { usePermission } from './utils/permission';

dayjs.locale('zh-cn');

const LoginPage = lazy(() => import('./pages/Login'));
const DashboardPage = lazy(() => import('./pages/Dashboard'));
const PatientListPage = lazy(() => import('./pages/Patients/PatientList'));
const PatientDetailPage = lazy(() => import('./pages/Patients/PatientDetail'));
const PatientCreatePage = lazy(() => import('./pages/Patients/PatientCreate'));
const PatientImportPage = lazy(() => import('./pages/Patients/PatientImport'));
const DialysisEntryPage = lazy(() => import('./pages/Dialysis/DialysisEntry'));
const DialysisWorkspace = lazy(() => import('./pages/Dialysis/DialysisWorkspace'));
const PrescriptionWorkspacePage = lazy(() => import('./pages/Prescription/PrescriptionWorkspace'));
const LongTermOrderListPage = lazy(() => import('./pages/Orders/LongTermOrderList'));
const LabResultListPage = lazy(() => import('./pages/Labs/LabResultList'));
const AlertCenterPage = lazy(() => import('./pages/Alerts/AlertCenter'));
const QCReportPage = lazy(() => import('./pages/Reports/QCReport'));
const VascularAccessPage = lazy(() => import('./pages/VascularAccess/VascularAccessPage'));
const SchedulePage = lazy(() => import('./pages/Schedule/SchedulePage'));
const DevicesPage = lazy(() => import('./pages/Devices/DevicesPage'));
const InfectionPage = lazy(() => import('./pages/Infection/InfectionPage'));
const CQIPage = lazy(() => import('./pages/CQI/CQIPage'));
const AdminUsersPage = lazy(() => import('./pages/Admin/AdminUsersPage'));
const AIAssistantPage = lazy(() => import('./pages/AI/AIAssistant'));
const GuidelineReaderPage = lazy(() => import('./pages/AI/GuidelineReader'));
const KnowledgeManagerPage = lazy(() => import('./pages/AI/KnowledgeManager'));
const SiteConfigPage = lazy(() => import('./pages/AI/SiteConfig'));
const NoModuleAccessPage = lazy(() => import('./pages/NoAccess/NoModuleAccessPage'));

function RouteLoadingFallback() {
  return (
    <div style={{ padding: 24 }}>
      <div className="hd-empty-state" style={{ maxWidth: 560, margin: '0 auto' }}>
        页面加载中，请稍候…
      </div>
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore(s => s.isAuthenticated);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore(s => s.isAuthenticated);
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const { canManageUsers } = usePermission();

  useEffect(() => {
    if (!canManageUsers) {
      message.warning('仅管理员可访问用户管理');
      navigate('/dashboard', { replace: true });
    }
  }, [canManageUsers, navigate]);

  if (!canManageUsers) return null;
  return <>{children}</>;
}

export default function App() {
  return (
    <ConfigProvider locale={zhCN} theme={{
      token: {
        colorPrimary: '#2A667F',
        borderRadius: 10,
        fontFamily: '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif',
        colorBgLayout: '#F3F6F8',
        colorBorderSecondary: '#D7E0E7',
        colorBgContainer: '#ffffff',
        colorText: '#1A2B37',
        colorTextSecondary: '#4F6372',
      },
      components: {
        Table: {
          headerBg: '#F5F8FA',
          headerColor: '#4F6372',
          borderColor: '#D7E0E7',
          cellPaddingBlock: 10,
          cellPaddingInline: 14,
        },
        Card: {
          colorBorderSecondary: '#D7E0E7',
          paddingLG: 16,
        },
        Tabs: {
          inkBarColor: '#2A667F',
          itemActiveColor: '#2A667F',
          itemSelectedColor: '#2A667F',
        },
        Button: {
          borderRadius: 8,
        },
        Select: {
          borderRadius: 8,
        },
        Input: {
          borderRadius: 8,
        },
        DatePicker: {
          borderRadius: 8,
        },
      },
    }}>
      <AntApp>
        <Suspense fallback={<RouteLoadingFallback />}>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={
                <PublicRoute><LoginPage /></PublicRoute>
              } />

              <Route path="/" element={
                <RequireAuth><AppLayout /></RequireAuth>
              }>
                <Route element={<RequireModuleAccess />}>
                <Route index element={<Navigate to="/dashboard" replace />} />
                <Route path="dashboard"       element={<DashboardPage />} />
                <Route path="patients/new"    element={<PatientCreatePage />} />
                <Route path="patients/import" element={<PatientImportPage />} />
                <Route path="patients"        element={<PatientListPage />} />
                <Route path="patients/:id"    element={<PatientDetailPage />} />
                <Route path="dialysis" element={<DialysisWorkspace />}>
                  <Route index element={<Navigate to="entry" replace />} />
                  <Route path="entry" element={<DialysisEntryPage />} />
                </Route>
                <Route path="dialysis/today" element={<Navigate to="/dialysis" replace />} />
                <Route path="prescription"    element={<PrescriptionWorkspacePage />} />
                <Route path="orders"          element={<LongTermOrderListPage />} />
                <Route path="labs"            element={<LabResultListPage />} />
                <Route path="vascular"        element={<VascularAccessPage />} />
                <Route path="infection"       element={<InfectionPage />} />
                <Route path="alerts"          element={<AlertCenterPage />} />
                <Route path="reports"         element={<QCReportPage />} />
                <Route path="schedule"        element={<SchedulePage />} />
                <Route path="devices"         element={<DevicesPage />} />
                <Route path="cqi"             element={<CQIPage />} />
                <Route path="ai/assistant"    element={<AIAssistantPage />} />
                <Route path="ai/guidelines"   element={<GuidelineReaderPage />} />
                <Route path="ai/knowledge"     element={<KnowledgeManagerPage />} />
                <Route path="ai/sites"        element={<RequireAdmin><SiteConfigPage /></RequireAdmin>} />
                <Route path="admin/users"     element={<RequireAdmin><AdminUsersPage /></RequireAdmin>} />
                <Route path="no-access"       element={<NoModuleAccessPage />} />
                </Route>
              </Route>

              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </BrowserRouter>
        </Suspense>
      </AntApp>
    </ConfigProvider>
  );
}
