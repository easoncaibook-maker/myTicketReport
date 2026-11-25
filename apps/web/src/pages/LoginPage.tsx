import React, { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Alert, Button, Form, Input, Typography } from 'antd';
import { FileTextOutlined, LockOutlined, MailOutlined } from '@ant-design/icons';
import { errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';

export default function LoginPage() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user) {
    return <Navigate to={location.state?.from || '/tickets'} replace />;
  }

  const onFinish = async (values: { email: string; password: string }) => {
    setLoading(true);
    setError(null);
    try {
      await login(values.email.trim(), values.password);
      navigate(location.state?.from || '/tickets', { replace: true });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <FileTextOutlined style={{ fontSize: 34, color: '#1668dc' }} />
          <h1>运维工单系统</h1>
          <p>客户报障 · 运维受理 · 全程可追溯</p>
        </div>
        {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
        <Form layout="vertical" onFinish={onFinish} requiredMark={false} size="large">
          <Form.Item name="email" label="邮箱" rules={[{ required: true, message: '请输入邮箱' }, { type: 'email', message: '邮箱格式不正确' }]}>
            <Input prefix={<MailOutlined />} placeholder="name@company.com" autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="请输入密码" autoComplete="current-password" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 12 }}>
            <Button type="primary" htmlType="submit" block loading={loading}>
              登录
            </Button>
          </Form.Item>
        </Form>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Typography.Text type="secondary">账号由管理员邀请创建</Typography.Text>
          <Link to="/forgot-password">忘记密码？</Link>
        </div>
      </div>
    </div>
  );
}
