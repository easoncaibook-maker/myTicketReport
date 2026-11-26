import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Card, Descriptions, Form, Input, Modal, Popconfirm, Space, Table, Tag, Typography, message } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { ROLE_LABELS, formatDate } from '@ticketreport/shared';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';

export default function ProfilePage() {
  const { user, reload, logout } = useAuth();
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [totpLoading, setTotpLoading] = useState(false);

  const { data: totp, refetch: refetchTotp } = useQuery({
    queryKey: ['me-totp'],
    queryFn: () => api.get('/auth/me/totp'),
  });

  const { data: devices, refetch: refetchDevices } = useQuery({
    queryKey: ['me-trusted-devices'],
    queryFn: () => api.get('/auth/me/trusted-devices'),
  });

  useEffect(() => {
    if (!setup) {
      setQrDataUrl(null);
      return;
    }
    QRCode.toDataURL(setup.otpauthUrl, { width: 200, margin: 1 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [setup]);

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

  const startTotpSetup = async () => {
    setTotpLoading(true);
    try {
      const res = await api.post('/auth/me/totp/setup');
      setSetup(res);
      setRecoveryCodes(null);
      setTotpCode('');
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setTotpLoading(false);
    }
  };

  const enableTotp = async () => {
    if (!/^\d{6}$/.test(totpCode.trim())) {
      message.error('请输入验证器中的 6 位动态码');
      return;
    }
    setTotpLoading(true);
    try {
      const res = await api.post('/auth/me/totp/enable', { code: totpCode.trim() });
      setRecoveryCodes(res.recoveryCodes);
      setSetup(null);
      setTotpCode('');
      await refetchTotp();
      message.success('验证器已绑定');
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setTotpLoading(false);
    }
  };

  const revokeDevice = async (id: string) => {
    try {
      await api.del(`/auth/me/trusted-devices/${id}`);
      message.success('已撤销该信任设备');
      refetchDevices();
    } catch (e) {
      message.error(errorMessage(e));
    }
  };

  const revokeAllDevices = async () => {
    try {
      await api.del('/auth/me/trusted-devices');
      message.success('已撤销全部信任设备');
      refetchDevices();
    } catch (e) {
      message.error(errorMessage(e));
    }
  };

  return (
    <div style={{ maxWidth: 860 }}>
      <h2 className="page-title">个人设置</h2>
      <Card title="账号信息" style={{ marginBottom: 16 }}>
        <Descriptions column={1} size="small">
          <Descriptions.Item label="姓名">{user?.name}</Descriptions.Item>
          <Descriptions.Item label="邮箱">{user?.email}</Descriptions.Item>
          <Descriptions.Item label="角色">{user ? ROLE_LABELS[user.role] : '-'}</Descriptions.Item>
          <Descriptions.Item label="所属企业">{user?.enterpriseName || '运维团队'}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card
        title="登录验证器（TOTP）"
        style={{ marginBottom: 16 }}
        extra={
          <Button size="small" icon={<ReloadOutlined />} onClick={() => refetchTotp()}>
            刷新
          </Button>
        }
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="绑定后，登录时需输入验证器中的 6 位动态码；恢复码仅能使用一次，请妥善保存。"
        />
        <Descriptions column={2} size="small" style={{ marginBottom: 16 }}>
          <Descriptions.Item label="绑定状态">
            {totp?.enabled ? <Tag color="green">已绑定</Tag> : <Tag>未绑定</Tag>}
          </Descriptions.Item>
          <Descriptions.Item label="绑定时间">{totp?.boundAt ? formatDate(totp.boundAt) : '-'}</Descriptions.Item>
          <Descriptions.Item label="剩余恢复码">{totp?.enabled ? totp.recoveryCodesLeft : '-'}</Descriptions.Item>
        </Descriptions>

        {!totp?.enabled && !setup && (
          <Button type="primary" icon={<PlusOutlined />} loading={totpLoading} onClick={startTotpSetup}>
            绑定验证器
          </Button>
        )}

        {setup && (
          <div>
            <Typography.Paragraph type="secondary">
              使用 Google Authenticator / Microsoft Authenticator 扫描二维码，或手动输入密钥：
            </Typography.Paragraph>
            <Space align="start" size={24} wrap>
              {qrDataUrl && <img src={qrDataUrl} alt="TOTP 二维码" width={180} height={180} />}
              <div>
                <Typography.Paragraph copyable={{ text: setup.secret }} code style={{ wordBreak: 'break-all' }}>
                  {setup.secret}
                </Typography.Paragraph>
                <Typography.Paragraph type="secondary" style={{ wordBreak: 'break-all', maxWidth: 420 }}>
                  {setup.otpauthUrl}
                </Typography.Paragraph>
                <Space.Compact style={{ width: 280 }}>
                  <Input
                    maxLength={6}
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="6 位动态码"
                  />
                  <Button type="primary" loading={totpLoading} onClick={enableTotp}>
                    启用
                  </Button>
                </Space.Compact>
                <div style={{ marginTop: 8 }}>
                  <Button type="link" size="small" onClick={() => setSetup(null)}>
                    取消绑定
                  </Button>
                </div>
              </div>
            </Space>
          </div>
        )}

        {recoveryCodes && (
          <Alert
            type="warning"
            showIcon
            style={{ marginTop: 16 }}
            message="恢复码（仅显示一次，请离线保存）"
            description={
              <div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 6,
                    fontFamily: 'Consolas, monospace',
                    marginBottom: 8,
                  }}
                >
                  {recoveryCodes.map((code) => (
                    <span key={code}>{code}</span>
                  ))}
                </div>
                <Typography.Text copyable={{ text: recoveryCodes.join('\n') }} type="secondary">
                  复制全部恢复码
                </Typography.Text>
                <div>
                  <Button size="small" style={{ marginTop: 8 }} onClick={() => setRecoveryCodes(null)}>
                    我已保存
                  </Button>
                </div>
              </div>
            }
          />
        )}
      </Card>

      <Card
        title="信任设备（邮件验证码免验证）"
        style={{ marginBottom: 16 }}
        extra={
          devices?.length ? (
            <Popconfirm title="确定撤销全部信任设备？" onConfirm={revokeAllDevices}>
              <Button size="small" danger>
                全部撤销
              </Button>
            </Popconfirm>
          ) : null
        }
      >
        <Table
          rowKey="id"
          size="small"
          dataSource={devices ?? []}
          pagination={false}
          locale={{ emptyText: '暂无信任设备（使用邮件验证码登录并勾选「信任此设备」后会出现在这里）' }}
          columns={[
            { title: '设备 / 浏览器', dataIndex: 'userAgent', ellipsis: true, render: (v: string) => v || '未知设备' },
            { title: 'IP', dataIndex: 'ip', width: 130, render: (v: string) => v || '-' },
            { title: '最近使用', dataIndex: 'lastUsedAt', width: 150, render: (v) => (v ? formatDate(v) : '-') },
            { title: '有效期至', dataIndex: 'expiresAt', width: 150, render: (v) => formatDate(v) },
            {
              title: '操作',
              width: 100,
              render: (_: any, r: any) => (
                <Popconfirm title="撤销后该设备下次登录需重新验证" onConfirm={() => revokeDevice(r.id)}>
                  <Button type="link" size="small" danger>
                    撤销
                  </Button>
                </Popconfirm>
              ),
            },
          ]}
        />
      </Card>

      <Card title="修改密码">
        <Alert type="info" showIcon message="密码至少 8 位，且同时包含字母和数字；修改后信任设备会自动失效" style={{ marginBottom: 16 }} />
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
