import React, { useState } from 'react';
import { Button, Card, Form, Input, Modal, Space, Table, Tag, message } from 'antd';
import { PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDate } from '@ticketreport/shared';
import { api, errorMessage } from '../../lib/api';

export default function EnterprisesPage() {
  const queryClient = useQueryClient();
  const [keyword, setKeyword] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-enterprises', keyword],
    queryFn: () => api.get(`/admin/enterprises${keyword ? `?keyword=${encodeURIComponent(keyword)}` : ''}`),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin-enterprises'] });

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setOpen(true);
  };

  const openEdit = (row: any) => {
    setEditing(row);
    form.setFieldsValue({
      name: row.name,
      code: row.code,
      contactName: row.contactName,
      contactPhone: row.contactPhone,
      remark: row.remark,
    });
    setOpen(true);
  };

  const save = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      if (editing) await api.patch(`/admin/enterprises/${editing.id}`, values);
      else await api.post('/admin/enterprises', values);
      message.success(editing ? '企业信息已更新' : '企业已创建');
      setOpen(false);
      refresh();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const toggle = (row: any) => {
    Modal.confirm({
      title: row.status === 'ACTIVE' ? '停用企业' : '启用企业',
      content:
        row.status === 'ACTIVE'
          ? '停用后该企业员工将无法登录，历史工单只读保留。确认停用？'
          : '启用后该企业员工可重新登录。确认启用？',
      onOk: async () => {
        try {
          await api.patch(`/admin/enterprises/${row.id}`, { status: row.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' });
          message.success('操作成功');
          refresh();
        } catch (e) {
          message.error(errorMessage(e));
        }
      },
    });
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 className="page-title" style={{ margin: 0 }}>
          客户企业
        </h2>
        <Space>
          <Input
            placeholder="搜索名称 / 简码"
            allowClear
            prefix={<SearchOutlined />}
            style={{ width: 220 }}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <Button icon={<ReloadOutlined />} onClick={refresh} />
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建企业
          </Button>
        </Space>
      </div>

      <Card>
        <Table
          rowKey="id"
          loading={isLoading}
          dataSource={data ?? []}
          pagination={false}
          columns={[
            { title: '企业名称', dataIndex: 'name' },
            { title: '简码', dataIndex: 'code', width: 120, render: (v) => <span className="mono">{v}</span> },
            { title: '联系人', dataIndex: 'contactName', width: 120, render: (v) => v || '-' },
            { title: '联系电话', dataIndex: 'contactPhone', width: 140, render: (v) => v || '-' },
            {
              title: '员工数',
              width: 90,
              render: (_: any, r: any) => r._count?.users ?? 0,
            },
            {
              title: '工单数',
              width: 90,
              render: (_: any, r: any) => r._count?.tickets ?? 0,
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 90,
              render: (v) => <Tag color={v === 'ACTIVE' ? 'green' : 'default'}>{v === 'ACTIVE' ? '启用' : '停用'}</Tag>,
            },
            { title: '创建时间', dataIndex: 'createdAt', width: 150, render: (v) => formatDate(v) },
            {
              title: '操作',
              width: 160,
              render: (_: any, r: any) => (
                <Space size={4}>
                  <Button type="link" size="small" onClick={() => openEdit(r)}>
                    编辑
                  </Button>
                  <Button type="link" size="small" danger={r.status === 'ACTIVE'} onClick={() => toggle(r)}>
                    {r.status === 'ACTIVE' ? '停用' : '启用'}
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        open={open}
        title={editing ? '编辑企业' : '新建企业'}
        onCancel={() => setOpen(false)}
        onOk={save}
        confirmLoading={saving}
        okText="保存"
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="name" label="企业名称" rules={[{ required: true, message: '请输入企业名称' }, { min: 2, max: 100 }]}>
            <Input />
          </Form.Item>
          <Form.Item
            name="code"
            label="简码"
            rules={[
              { required: true, message: '请输入简码' },
              { pattern: /^[A-Za-z0-9_-]{2,30}$/, message: '2–30 位字母、数字、下划线或短横线' },
            ]}
          >
            <Input placeholder="例如 HD、BC" />
          </Form.Item>
          <Space size={16} style={{ display: 'flex' }}>
            <Form.Item name="contactName" label="联系人" style={{ flex: 1 }}>
              <Input />
            </Form.Item>
            <Form.Item name="contactPhone" label="联系电话" style={{ flex: 1 }}>
              <Input />
            </Form.Item>
          </Space>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
