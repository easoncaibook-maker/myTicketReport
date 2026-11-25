import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Card, Descriptions, Form, Input, Space, message } from 'antd';
import { ROLE_LABELS } from '@ticketreport/shared';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';

export default function ProfilePage() {
  const { user, reload, logout } = useAuth();
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  const onChangePassword = async (values: any) => {
    setLoading(true);
    try {
      await api.patch('/auth/me/password', { oldPassword: values.oldPassword, newPassword: values.newPassword });
      message.success('密码已修改，请使用新密码重新登录');
      form.resetFields();
      await logout();
      navigate('/login', { replace: true });
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 760 }}>
      <h2 className="page-title">个人设置</h2>
      <Card title="账号信息" style={{ marginBottom: 16 }}>
        <Descriptions column={1} size="small">
          <Descriptions.Item label="姓名">{user?.name}</Descriptions.Item>
          <Descriptions.Item label="邮箱">{user?.email}</Descriptions.Item>
          <Descriptions.Item label="角色">{user ? ROLE_LABELS[user.role] : '-'}</Descriptions.Item>
          <Descriptions.Item label="所属企业">{user?.enterpriseName || '运维团队'}</Descriptions.Item>
        </Descriptions>
      </Card>
      <Card title="修改密码">
        <Alert type="info" showIcon message="密码至少 8 位，且同时包含字母和数字" style={{ marginBottom: 16 }} />
        <Form form={form} layout="vertical" onFinish={onChangePassword} requiredMark={false} style={{ maxWidth: 420 }}>
          <Form.Item name="oldPassword" label="当前密码" rules={[{ required: true, message: '请输入当前密码' }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item
            name="newPassword"
            label="新密码"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 8, message: '至少 8 位' },
              { pattern: /^(?=.*[A-Za-z])(?=.*\d).+$/, message: '需同时包含字母和数字' },
            ]}
          >
            <Input.Password />
          </Form.Item>
          <Form.Item
            name="confirm"
            label="确认新密码"
            dependencies={['newPassword']}
            rules={[
              { required: true, message: '请再次输入新密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('newPassword') === value) return Promise.resolve();
                  return Promise.reject(new Error('两次输入的密码不一致'));
                },
              }),
            ]}
          >
            <Input.Password />
          </Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={loading}>
              保存
            </Button>
            <Button onClick={() => reload()}>刷新账号信息</Button>
          </Space>
        </Form>
      </Card>
    </div>
  );
}
