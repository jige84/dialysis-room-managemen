/**
 * 管理员将侧栏权限清空时，无可访问模块的提示页
 */
import { Button } from 'antd';
import { useNavigate } from 'react-router-dom';
import PageShell from '../../components/PageShell/PageShell';
import { useAuthStore } from '../../stores/authStore';

export default function NoModuleAccessPage() {
  const navigate = useNavigate();
  const logout = useAuthStore(s => s.logout);

  return (
    <PageShell>
      <div style={{ marginTop: 48, textAlign: 'center', color: '#64748B' }}>
        <p style={{ fontSize: 16, marginBottom: 16 }}>
          当前账号未分配任何侧栏功能权限，请联系管理员。
        </p>
        <Button
          type="primary"
          onClick={() => {
            logout();
            navigate('/login');
          }}
        >
          返回登录
        </Button>
      </div>
    </PageShell>
  );
}
