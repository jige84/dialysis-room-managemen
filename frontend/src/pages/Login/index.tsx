/**
 * 登录页
 * 主要作用：用户名密码登录，成功后写入 token 并跳转主界面。
 * 主要功能：Ant Design Form；调用 authApi.login；错误提示与加载态。
 */
import { useState } from 'react';
import { Form, Input, Button, message } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { authApi } from '../../api/auth';
import { useAuthStore } from '../../stores/authStore';

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const login = useAuthStore(s => s.login);

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      const res = await authApi.login(values);
      if (res.data.code === 200 && res.data.data) {
        const { token, user } = res.data.data;
        login(token, user);
        message.success(`欢迎回来，${user.real_name}！`);
        navigate('/dashboard', { replace: true });
      } else {
        message.error(res.data.message || '登录失败');
      }
    } catch {
      // 错误已由 axios 拦截器处理
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-bg">
      <div className="login-glow" />

      <div className="login-card-animate login-card">
        <div className="login-brand-row">
          <div className="login-brand-mark">HD</div>
          <div>
            <div className="login-brand-name">涉县善谷医院</div>
            <div className="login-brand-system">血液透析室管理系统</div>
          </div>
        </div>

        <div className="login-content">
          <div className="login-heading">账号登录</div>
          <p className="login-subheading">
            适用于医生、责任护士、护士长及质控人员的院内业务登录。
          </p>
        </div>

        <Form
          name="login"
          onFinish={onFinish}
          size="large"
          autoComplete="off"
        >
          <Form.Item
            name="username"
            rules={[{ required: true, message: '请输入用户名' }]}
            style={{ marginBottom: 16 }}
          >
            <Input
              prefix={<UserOutlined className="login-input-icon" />}
              placeholder="用户名"
              className="login-input"
            />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[{ required: true, message: '请输入密码' }]}
            style={{ marginBottom: 16 }}
          >
            <Input.Password
              prefix={<LockOutlined className="login-input-icon" />}
              placeholder="密码（≥6位，字母与数字）"
              className="login-input"
            />
          </Form.Item>

          <p className="login-note">
            连续 5 次错误将锁定 30 分钟，登录与数据传输均使用加密保护。
          </p>

          <Form.Item style={{ marginBottom: 0 }}>
            <Button
              type="primary"
              htmlType="submit"
              block
              loading={loading}
              className="login-submit"
            >
              登录系统
            </Button>
          </Form.Item>
        </Form>

        <div className="login-footer">
          <p className="login-footer-text">
            依据《血液净化标准化操作规程（2021版）》设计，仅供院内授权人员使用。
          </p>
        </div>
      </div>
    </div>
  );
}
