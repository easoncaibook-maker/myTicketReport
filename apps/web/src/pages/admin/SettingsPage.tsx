import React, { useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Input, InputNumber, Select, Switch, Table, Tag, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LOGIN_VERIFICATION_DESCRIPTIONS,
  LOGIN_VERIFICATION_LABELS,
  LOGIN_VERIFICATION_MODES,
  formatDate,
} from '@ticketreport/shared';
import { api, errorMessage } from '../../lib/api';

const OUTBOX_COLORS: Record<string, string> = {
  PENDING: 'blue',
  SENT: 'green',
  FAILED: 'red',
  SKIPPED_NO_SMTP: 'default',
};

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const [basicForm] = Form.useForm();
  const [loginForm] = Form.useForm();
  const [saving, setSaving] = useState<'basic' | 'login' | null>(null);
  const verificationMode = Form.useWatch('loginVerificationMode', loginForm);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-settings'],
    queryFn: () => api.get('/admin/settings'),
  });

  const { data: outbox, isLoading: outboxLoading, refetch } = useQuery({
    queryKey: ['admin-outbox'],
    queryFn: () => api.get('/admin/dev/outbox'),
  });

  useEffect(() => {
    if (!data) return;
    basicForm.setFieldsValue({
      siteName: data.siteName,
      reopenWindowDays: data.reopenWindowDays,
      maxAttachmentMb: data.maxAttachmentMb,
      emailEnabled: data.emailEnabled,
    });
    loginForm.setFieldsValue({
      loginVerificationMode: data.loginVerificationMode ?? 'SLIDER',
      trustedDeviceDays: data.trustedDeviceDays ?? 7,
      requireTotpForOps: data.requireTotpForOps ?? false,
    });
  }, [data, basicForm, loginForm]);

  const save = async (section: 'basic' | 'login') => {
    try {
      const form = section === 'basic' ? basicForm : loginForm;
      const values = await form.validateFields();
      setSaving(section);
      await api.patch('/admin/settings', values);
      message.success('设置已保存，立即生效');
      queryClient.invalidateQueries({ queryKey: ['admin-settings'] });
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(errorMessage(e));
    } finally {
      setSaving(null);
    }
  };

  return (
    <div>
      <h2 className="page-title">系统设置</h2>

      <Card title="基础参数" loading={isLoading} style={{ marginBottom: 16, maxWidth: 720 }}>
        <Form form={basicForm} layout="vertical" requiredMark={false}>
          <Form.Item name="siteName" label="站点名称" rules={[{ required: true, message: '请输入站点名称' }]}>
            <Input maxLength={50} />
          </Form.Item>
          <Form.Item
            name="reopenWindowDays"
            label="工单重开时限（天）"
            rules={[{ required: true, message: '请输入重开时限' }]}
            extra="客户可在工单关闭后该天数内重开，超期需新建工单"
          >
            <InputNumber min={1} max={90} style={{ width: 160 }} />
          </Form.Item>
          <Form.Item
            name="maxAttachmentMb"
            label="单个附件大小上限（MB）"
            rules={[{ required: true, message: '请输入附件上限' }]}
          >
            <InputNumber min={1} max={200} style={{ width: 160 }} />
          </Form.Item>
          <Form.Item name="emailEnabled" label="开启邮件通知" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Alert
            type={data?.smtpConfigured ? 'success' : 'warning'}
            showIcon
            style={{ marginBottom: 16 }}
            message={
              data?.smtpConfigured
                ? 'SMTP 已配置，邮件将实际投递'
                : 'SMTP 未配置：邮件仅写入本地 outbox，不会真实发送。请通过环境变量 SMTP_* 配置。'
            }
          />
          <Button type="primary" loading={saving === 'basic'} onClick={() => save('basic')}>
            保存设置
          </Button>
        </Form>
      </Card>

      <Card title="登录验证" loading={isLoading} style={{ marginBottom: 16, maxWidth: 720 }}>
        <Form form={loginForm} layout="vertical" requiredMark={false}>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="登录验证方式切换后立即生效，并记录审计日志；密码错误限流、强制改密流程不受影响。"
          />
          <Form.Item
            name="loginVerificationMode"
            label="登录验证方式"
            rules={[{ required: true, message: '请选择登录验证方式' }]}
            extra={verificationMode ? LOGIN_VERIFICATION_DESCRIPTIONS[verificationMode] : undefined}
          >
            <Select
              options={LOGIN_VERIFICATION_MODES.map((mode) => ({
                value: mode,
                label: LOGIN_VERIFICATION_LABELS[mode],
              }))}
            />
          </Form.Item>
          {verificationMode === 'EMAIL_CODE' && !data?.smtpConfigured && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message="SMTP 未配置：验证码会写入本地发件箱，登录页也会直接显示（仅适合内测）。生产环境请先配置 SMTP_*。"
            />
          )}
          <Form.Item
            name="trustedDeviceDays"
            label="信任设备免验证天数"
            extra="邮件验证码通过并勾选「信任此设备」后，在该天数内免验证；个人设置中可查看与撤销"
            rules={[{ required: true, message: '请输入免验证天数' }]}
          >
            <InputNumber min={1} max={30} style={{ width: 160 }} />
          </Form.Item>
          <Form.Item
            name="requireTotpForOps"
            label="强制运维账号绑定 TOTP"
            valuePropName="checked"
            extra="仅在「Google 验证器（TOTP）」模式下生效：未绑定的运维账号登录时必须先完成绑定"
          >
            <Switch />
          </Form.Item>
          <Button type="primary" loading={saving === 'login'} onClick={() => save('login')}>
            保存设置
          </Button>
        </Form>
      </Card>

      <Card
        title="邮件 Outbox（最近 50 封）"
        loading={outboxLoading}
        extra={
          <Button size="small" icon={<ReloadOutlined />} onClick={() => refetch()}>
            刷新
          </Button>
        }
      >
        <Table
          rowKey="id"
          size="small"
          dataSource={outbox ?? []}
          pagination={{ pageSize: 10 }}
          columns={[
            { title: '收件人', dataIndex: 'toEmail', width: 200 },
            { title: '主题', dataIndex: 'subject', ellipsis: true },
            { title: '模板', dataIndex: 'template', width: 150 },
            {
              title: '状态',
              dataIndex: 'status',
              width: 140,
              render: (v: string) => <Tag color={OUTBOX_COLORS[v] ?? 'default'}>{v}</Tag>,
            },
            { title: '尝试', dataIndex: 'attempts', width: 70 },
            { title: '创建时间', dataIndex: 'createdAt', width: 150, render: (v) => formatDate(v) },
          ]}
        />
      </Card>
    </div>
  );
}
