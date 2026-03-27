import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider, App as AntApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';

import { useAuthStore } from './stores/authStore';
import AppLayout from './components/Layout/AppLayout';
import LoginPage from './pages/Login';
import DashboardPage from './pages/Dashboard';
import PatientListPage from './pages/Patients/PatientList';
import PatientDetailPage from './pages/Patients/PatientDetail';
import PatientCreatePage from './pages/Patients/PatientCreate';
import DialysisEntryPage from './pages/Dialysis/DialysisEntry';
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
import PageShell from './components/PageShell/PageShell';

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
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="dashboard"       element={<DashboardPage />} />
              <Route path="patients/new"    element={<PatientCreatePage />} />
              <Route path="patients"        element={<PatientListPage />} />
              <Route path="patients/:id"    element={<PatientDetailPage />} />
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
              <Route path="admin/users"     element={<AdminUsersPage />} />
            </Route>

            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </BrowserRouter>
      </AntApp>
    </ConfigProvider>
  );
}

function AdminUsersPage() {
  return (
    <PageShell>
      <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px 0' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }} aria-hidden>👤</div>
        <p style={{ fontSize: 16, color: 'var(--text-primary)', marginBottom: 8 }}>用户管理</p>
        <p>此功能将在后续版本中上线</p>
      </div>
    </PageShell>
  );
}
