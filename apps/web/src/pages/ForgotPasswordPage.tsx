import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, Form, Input, Typography } from 'antd';
import { api, errorMessage } from '../lib/api';

export default function ForgotPasswordPage() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onFinish = async (values: { email: string }) => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api.post('/auth/forgot-password', { email: values.email.trim() });
      setMessage(res?.message || '如果该邮箱存在账号，重置密码邮件已发送，请查收。');
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
          <h1>找回密码</h1>
          <p>输入账号邮箱，我们会发送重置链接</p>
        </div>
        {message && <Alert type="success" message={message} showIcon style={{ marginBottom: 16 }} />}
        {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
        <Form layout="vertical" onFinish={onFinish} requiredMark={false} size="large">
          <Form.Item name="email" label="邮箱" rules={[{ required: true, message: '请输入邮箱' }, { type: 'email', message: '邮箱格式不正确' }]}>
            <Input placeholder="name@company.com" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading}>
            发送重置邮件
          </Button>
        </Form>
        <div style={{ marginTop: 14, textAlign: 'center' }}>
          <Typography.Text type="secondary">
            <Link to="/login">返回登录</Link>
          </Typography.Text>
        </div>
      </div>
    </div>
  );
}
