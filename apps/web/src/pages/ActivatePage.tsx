import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Button, Form, Input, Result, Typography } from 'antd';
import { api, errorMessage } from '../lib/api';

export default function ActivatePage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!token) {
    return <Result status="warning" title="邀请链接无效" subTitle="链接缺少令牌，请让管理员重新发送邀请邮件。" />;
  }

  const onFinish = async (values: { password: string }) => {
    setLoading(true);
    setError(null);
    try {
      await api.post('/auth/activate', { token, password: values.password });
      setDone(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <Result
        status="success"
        title="账号已激活"
        subTitle="密码设置成功，现在可以使用邮箱登录。"
        extra={
          <Button type="primary" onClick={() => navigate('/login')}>
            去登录
          </Button>
        }
      />
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <h1>设置登录密码</h1>
          <p>密码至少 8 位，且同时包含字母和数字</p>
        </div>
        {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
        <Form layout="vertical" onFinish={onFinish} requiredMark={false} size="large">
          <Form.Item
            name="password"
            label="新密码"
            rules={[
              { required: true, message: '请输入密码' },
              { min: 8, message: '至少 8 位' },
              { pattern: /^(?=.*[A-Za-z])(?=.*\d).+$/, message: '需同时包含字母和数字' },
            ]}
          >
            <Input.Password placeholder="请输入新密码" />
          </Form.Item>
          <Form.Item
            name="confirm"
            label="确认密码"
            dependencies={['password']}
            rules={[
              { required: true, message: '请再次输入密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('password') === value) return Promise.resolve();
                  return Promise.reject(new Error('两次输入的密码不一致'));
                },
              }),
            ]}
          >
            <Input.Password placeholder="请再次输入密码" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading}>
            激活账号
          </Button>
        </Form>
        <div style={{ marginTop: 14, textAlign: 'center' }}>
          <Typography.Text type="secondary">
            已有密码？<Link to="/login">返回登录</Link>
          </Typography.Text>
        </div>
      </div>
    </div>
  );
}
