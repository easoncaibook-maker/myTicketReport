import React, { useMemo, useState } from 'react';
import { Button, Card, Form, Input, Modal, Select, Space, Table, Tag, message } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ROLES, ROLE_LABELS, Role, formatDate } from '@ticketreport/shared';
import { api, errorMessage } from '../../lib/api';
import { RoleTag } from '../../lib/ui';

const STATUS_LABELS_LOCAL: Record<string, string> = { INVITED: '待激活', ACTIVE: '正常', DISABLED: '已禁用' };
const STATUS_COLORS: Record<string, string> = { INVITED: 'orange', ACTIVE: 'green', DISABLED: 'default' };

export default function UsersPage() {
  const queryClient = useQueryClient();
  const [enterpriseId, setEnterpriseId] = useState<string | undefined>();
  const [role, setRole] = useState<string | undefined>();
  const [keyword, setKeyword] = useState('');
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const inviteRole = Form.useWatch('role', form);

  const params = new URLSearchParams();
  if (enterpriseId) params.set('enterpriseId', enterpriseId);
  if (role) params.set('role', role);
  if (keyword) params.set('keyword', keyword);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-users', params.toString()],
    queryFn: () => api.get(`/admin/users?${params.toString()}`),
  });

  const { data: enterprises } = useQuery({
    queryKey: ['admin-enterprises-all'],
    queryFn: () => api.get('/admin/enterprises'),
  });

  const { data: groups } = useQuery({
    queryKey: ['admin-groups'],
    queryFn: () => api.get('/admin/groups'),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin-users'] });

  const invite = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      await api.post('/admin/users/invite', values);
      message.success('邀请已创建，邮件已进入发送队列');
      setOpen(false);
      form.resetFields();
      refresh();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = (row: any, status: string) => {
    Modal.confirm({
      title: `${status === 'ACTIVE' ? '启用' : '禁用'}账号`,
      content: `确定要${status === 'ACTIVE' ? '启用' : '禁用'} ${row.name}（${row.email}）吗？`,
      onOk: async () => {
        try {
          await api.patch(`/admin/users/${row.id}`, { status });
          message.success('操作成功');
          refresh();
        } catch (e) {
          message.error(errorMessage(e));
        }
      },
    });
  };

  const resend = async (row: any) => {
    try {
      await api.post(`/admin/users/${row.id}/resend-invite`);
      message.success('邀请邮件已重新发送');
    } catch (e) {
      message.error(errorMessage(e));
    }
  };

  const enterpriseOptions = useMemo(
    () => (enterprises ?? []).map((e: any) => ({ value: e.id, label: `${e.name}（${e.code}）` })),
    [enterprises],
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <h2 className="page-title" style={{ margin: 0 }}>
          账号管理
        </h2>
        <Space wrap>
          <Select
            allowClear
            placeholder="全部企业"
            style={{ width: 190 }}
            value={enterpriseId}
            onChange={setEnterpriseId}
            options={enterpriseOptions}
          />
          <Select
            allowClear
            placeholder="全部角色"
            style={{ width: 140 }}
            value={role}
            onChange={setRole}
            options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
          />
          <Input.Search placeholder="姓名 / 邮箱" allowClear style={{ width: 200 }} onSearch={setKeyword} />
          <Button icon={<ReloadOutlined />} onClick={refresh} />
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              form.resetFields();
              form.setFieldsValue({ role: 'REPORTER' });
              setOpen(true);
            }}
          >
            邀请 / 新建账号
          </Button>
        </Space>
      </div>

      <Card>
        <Table
          rowKey="id"
          loading={isLoading}
          dataSource={data ?? []}
          pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 个账号` }}
          columns={[
            { title: '姓名', dataIndex: 'name', width: 120 },
            { title: '邮箱', dataIndex: 'email' },
            { title: '角色', dataIndex: 'role', width: 110, render: (v: Role) => <RoleTag role={v} /> },
            {
              title: '所属企业 / 处理组',
              width: 190,
              render: (_: any, r: any) => r.enterprise?.name || (r.groupIds?.length ? `组：${r.groupIds.length} 个` : '运维团队'),
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 100,
              render: (v: string) => <Tag color={STATUS_COLORS[v]}>{STATUS_LABELS_LOCAL[v] ?? v}</Tag>,
            },
            { title: '创建时间', dataIndex: 'createdAt', width: 150, render: (v) => formatDate(v) },
            {
              title: '操作',
              width: 220,
              render: (_: any, r: any) => (
                <Space size={2} wrap>
                  {r.status === 'INVITED' && (
                    <Button type="link" size="small" onClick={() => resend(r)}>
                      重发邀请
                    </Button>
                  )}
                  {r.id !== undefined && (
                    <Button
                      type="link"
                      size="small"
                      danger={r.status === 'ACTIVE'}
                      onClick={() => changeStatus(r, r.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE')}
                    >
                      {r.status === 'ACTIVE' ? '禁用' : '启用'}
                    </Button>
                  )}
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        open={open}
        title="邀请 / 新建账号"
        onCancel={() => setOpen(false)}
        onOk={invite}
        confirmLoading={saving}
        okText="发送邀请"
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="role" label="角色" rules={[{ required: true, message: '请选择角色' }]}>
            <Select options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} />
          </Form.Item>
          <Form.Item name="name" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="email" label="邮箱" rules={[{ required: true, message: '请输入邮箱' }, { type: 'email', message: '邮箱格式不正确' }]}>
            <Input placeholder="name@company.com" />
          </Form.Item>
          <Form.Item name="phone" label="联系电话">
            <Input />
          </Form.Item>
          {inviteRole === 'REPORTER' && (
            <Form.Item name="enterpriseId" label="所属企业" rules={[{ required: true, message: '请选择所属企业' }]}>
              <Select options={enterpriseOptions} placeholder="请选择客户企业" />
            </Form.Item>
          )}
          {inviteRole && inviteRole !== 'REPORTER' && (
            <Form.Item name="groupId" label="所属处理组（可选）">
              <Select allowClear options={(groups ?? []).map((g: any) => ({ value: g.id, label: g.name }))} />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  );
}
