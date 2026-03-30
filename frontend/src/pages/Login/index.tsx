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
      {/* 动态光晕 */}
      <div className="login-glow" />

      {/* 登录卡片 */}
      <div
        className="login-card-animate"
        style={{
          background: 'rgba(255,255,255,0.98)',
          borderRadius: 14,
          padding: '48px 44px',
          width: 420,
          boxShadow: `
            0 25px 50px rgba(6,12,36,0.55),
            0 0 0 1px rgba(14,165,233,0.25),
            0 0 40px rgba(14,165,233,0.12)
          `,
        }}
      >
        {/* 品牌标识 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <div style={{
            width: 46,
            height: 46,
            background: 'linear-gradient(135deg, #0EA5E9, #06B6D4)',
            borderRadius: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 22,
            boxShadow: '0 4px 14px rgba(14,165,233,0.4)',
            flexShrink: 0,
          }}>
            🩸
          </div>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#0D1B3E', lineHeight: '1.2' }}>
              涉县善谷医院
            </div>
            <div style={{ fontSize: 12, color: '#7B92BC', marginTop: 2 }}>
              血液透析室管理系统 v3.0
            </div>
          </div>
        </div>

        <h1 style={{
          fontSize: 22,
          fontWeight: 700,
          color: '#0D1B3E',
          margin: '24px 0 6px',
        }}>
          欢迎回来
        </h1>
        <p style={{ fontSize: 13, color: '#7B92BC', marginBottom: 32 }}>
          请输入您的账号密码登录系统，角色将由系统自动识别
        </p>

        <Form
          name="login"
          onFinish={onFinish}
          size="large"
          autoComplete="off"
        >
          <Form.Item
            name="username"
            rules={[{ required: true, message: '请输入用户名' }]}
            style={{ marginBottom: 18 }}
          >
            <Input
              prefix={<UserOutlined style={{ color: '#7B92BC' }} />}
              placeholder="用户名"
              style={{
                borderColor: '#DBEAFE',
                borderRadius: 6,
                fontSize: 14,
              }}
            />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[{ required: true, message: '请输入密码' }]}
            style={{ marginBottom: 18 }}
          >
            <Input.Password
              prefix={<LockOutlined style={{ color: '#7B92BC' }} />}
              placeholder="密码（≥8位含大小写数字）"
              style={{
                borderColor: '#DBEAFE',
                borderRadius: 6,
                fontSize: 14,
              }}
            />
          </Form.Item>

          <p style={{ fontSize: 12, color: '#7B92BC', marginBottom: 16 }}>
            🔒 连续5次错误将锁定30分钟 · 数据传输已加密
          </p>

          <Form.Item style={{ marginBottom: 0 }}>
            <Button
              type="primary"
              htmlType="submit"
              block
              loading={loading}
              style={{
                height: 46,
                borderRadius: 6,
                fontSize: 15,
                fontWeight: 500,
                background: 'linear-gradient(135deg, #0EA5E9, #0284C7)',
                border: 'none',
                boxShadow: '0 2px 10px rgba(14,165,233,0.30)',
              }}
            >
              登 录
            </Button>
          </Form.Item>
        </Form>

        <div style={{
          marginTop: 20,
          paddingTop: 16,
          borderTop: '1px solid #DBEAFE',
        }}>
          <p style={{ fontSize: 12, color: '#7B92BC', textAlign: 'center', margin: 0 }}>
            依据《血液净化标准化操作规程（2021版）》· 内网访问
          </p>
        </div>
      </div>
    </div>
  );
}
