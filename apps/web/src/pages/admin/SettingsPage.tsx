import React, { useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Input, InputNumber, Switch, Table, Tag, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDate } from '@ticketreport/shared';
import { api, errorMessage } from '../../lib/api';

const OUTBOX_COLORS: Record<string, string> = {
  PENDING: 'blue',
  SENT: 'green',
  FAILED: 'red',
  SKIPPED_NO_SMTP: 'default',
};

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-settings'],
    queryFn: () => api.get('/admin/settings'),
  });

  const { data: outbox, isLoading: outboxLoading, refetch } = useQuery({
    queryKey: ['admin-outbox'],
    queryFn: () => api.get('/admin/dev/outbox'),
  });

  useEffect(() => {
    if (data) {
      form.setFieldsValue({
        siteName: data.siteName,
        reopenWindowDays: data.reopenWindowDays,
        maxAttachmentMb: data.maxAttachmentMb,
        emailEnabled: data.emailEnabled,
      });
    }
  }, [data, form]);

  const save = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      await api.patch('/admin/settings', values);
      message.success('设置已保存');
      queryClient.invalidateQueries({ queryKey: ['admin-settings'] });
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h2 className="page-title">系统设置</h2>

      <Card title="基础参数" loading={isLoading} style={{ marginBottom: 16, maxWidth: 720 }}>
        <Form form={form} layout="vertical" requiredMark={false}>
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
          <Button type="primary" loading={saving} onClick={save}>
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
