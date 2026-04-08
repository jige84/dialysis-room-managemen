/**
 * 根组件：路由、Ant Design 中文本地化与鉴权布局
 * 主要作用：定义全站路由表与登录保护，挂载带侧栏的主布局。
 * 主要功能：BrowserRouter + 各业务页面懒加载式导入；RequireAuth；dayjs 中文；ConfigProvider zhCN。
 */
import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { message } from 'antd';
import { ConfigProvider, App as AntApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';

import { useAuthStore } from './stores/authStore';
import AppLayout from './components/Layout/AppLayout';
import RequireModuleAccess from './components/RequireModuleAccess';
import LoginPage from './pages/Login';
import DashboardPage from './pages/Dashboard';
import PatientListPage from './pages/Patients/PatientList';
import PatientDetailPage from './pages/Patients/PatientDetail';
import PatientCreatePage from './pages/Patients/PatientCreate';
import DialysisEntryPage from './pages/Dialysis/DialysisEntry';
import DialysisTodayBoardPage from './pages/Dialysis/DialysisTodayBoard';
import PrescriptionWorkspacePage from './pages/Prescription/PrescriptionWorkspace';
import LongTermOrderListPage from './pages/Orders/LongTermOrderList';
import LabResultListPage from './pages/Labs/LabResultList';
import AlertCenterPage from './pages/Alerts/AlertCenter';
import QCReportPage from './pages/Reports/QCReport';
import VascularAccessPage from './pages/VascularAccess/VascularAccessPage';
import SchedulePage from './pages/Schedule/SchedulePage';
import DevicesPage from './pages/Devices/DevicesPage';
import InfectionPage from './pages/Infection/InfectionPage';
import CQIPage from './pages/CQI/CQIPage';
import AdminUsersPage from './pages/Admin/AdminUsersPage';
import AIAssistantPage from './pages/AI/AIAssistant';
import GuidelineReaderPage from './pages/AI/GuidelineReader';
import KnowledgeManagerPage from './pages/AI/KnowledgeManager';
import SiteConfigPage from './pages/AI/SiteConfig';
import NoModuleAccessPage from './pages/NoAccess/NoModuleAccessPage';
import { usePermission } from './utils/permission';

dayjs.locale('zh-cn');

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
        colorPrimary: '#0EA5E9',
        borderRadius: 6,
        fontFamily: '"Noto Sans SC", -apple-system, "PingFang SC", "Helvetica Neue", sans-serif',
        colorBgLayout: '#F0F7FF',
        colorBorderSecondary: '#DBEAFE',
        colorBgContainer: '#ffffff',
      },
      components: {
        Table: {
          headerBg: '#F0F7FF',
          headerColor: '#3D5280',
          borderColor: '#DBEAFE',
        },
        Card: {
          colorBorderSecondary: '#DBEAFE',
        },
        Tabs: {
          inkBarColor: '#0EA5E9',
          itemActiveColor: '#0EA5E9',
          itemSelectedColor: '#0EA5E9',
        },
      },
    }}>
      <AntApp>
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
              <Route path="patients"        element={<PatientListPage />} />
              <Route path="patients/:id"    element={<PatientDetailPage />} />
              <Route path="dialysis/today"  element={<DialysisTodayBoardPage />} />
              <Route path="dialysis/entry"  element={<DialysisEntryPage />} />
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
      </AntApp>
    </ConfigProvider>
  );
}
