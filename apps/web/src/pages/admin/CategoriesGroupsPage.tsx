import React, { useMemo, useState } from 'react';
import { Button, Card, Form, Input, InputNumber, Modal, Select, Space, Table, Tabs, Tag, message } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api';

export default function CategoriesGroupsPage() {
  const queryClient = useQueryClient();
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<any>(null);
  const [categoryForm] = Form.useForm();
  const [groupOpen, setGroupOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<any>(null);
  const [groupForm] = Form.useForm();
  const [memberGroup, setMemberGroup] = useState<any>(null);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const { data: categories, isLoading: catLoading } = useQuery({
    queryKey: ['admin-categories'],
    queryFn: () => api.get('/admin/categories'),
  });
  const { data: groups, isLoading: groupLoading } = useQuery({
    queryKey: ['admin-groups'],
    queryFn: () => api.get('/admin/groups'),
  });
  const { data: users } = useQuery({
    queryKey: ['admin-users-all'],
    queryFn: () => api.get('/admin/users'),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-categories'] });
    queryClient.invalidateQueries({ queryKey: ['admin-groups'] });
    queryClient.invalidateQueries({ queryKey: ['meta-categories'] });
  };

  const opsUsers = useMemo(
    () => (users ?? []).filter((u: any) => u.role !== 'REPORTER' && u.status === 'ACTIVE'),
    [users],
  );

  const saveCategory = async () => {
    try {
      const values = await categoryForm.validateFields();
      setSaving(true);
      if (editingCategory) await api.patch(`/admin/categories/${editingCategory.id}`, values);
      else await api.post('/admin/categories', values);
      message.success('已保存');
      setCategoryOpen(false);
      refresh();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const saveGroup = async () => {
    try {
      const values = await groupForm.validateFields();
      setSaving(true);
      if (editingGroup) await api.patch(`/admin/groups/${editingGroup.id}`, values);
      else await api.post('/admin/groups', values);
      message.success('已保存');
      setGroupOpen(false);
      refresh();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const saveMembers = async () => {
    if (!memberGroup) return;
    setSaving(true);
    try {
      await api.put(`/admin/groups/${memberGroup.id}/members`, { userIds: memberIds });
      message.success('成员已更新');
      setMemberGroup(null);
      refresh();
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const toggleCategory = async (row: any) => {
    try {
      await api.patch(`/admin/categories/${row.id}`, { status: row.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' });
      message.success('已更新');
      refresh();
    } catch (e) {
      message.error(errorMessage(e));
    }
  };

  const toggleGroup = async (row: any) => {
    try {
      await api.patch(`/admin/groups/${row.id}`, { status: row.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' });
      message.success('已更新');
      refresh();
    } catch (e) {
      message.error(errorMessage(e));
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 className="page-title" style={{ margin: 0 }}>
          分类与处理组
        </h2>
        <Button icon={<ReloadOutlined />} onClick={refresh}>
          刷新
        </Button>
      </div>

      <Tabs
        items={[
          {
            key: 'categories',
            label: '工单分类',
            children: (
              <Card
                extra={
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={() => {
                      setEditingCategory(null);
                      categoryForm.resetFields();
                      setCategoryOpen(true);
                    }}
                  >
                    新建分类
                  </Button>
                }
              >
                <Table
                  rowKey="id"
                  loading={catLoading}
                  dataSource={categories ?? []}
                  pagination={false}
                  columns={[
                    { title: '名称', dataIndex: 'name' },
                    { title: '默认处理组', dataIndex: ['defaultGroup', 'name'], width: 180 },
                    { title: '排序', dataIndex: 'sort', width: 90 },
                    {
                      title: '状态',
                      dataIndex: 'status',
                      width: 100,
                      render: (v) => <Tag color={v === 'ACTIVE' ? 'green' : 'default'}>{v === 'ACTIVE' ? '启用' : '停用'}</Tag>,
                    },
                    {
                      title: '操作',
                      width: 170,
                      render: (_: any, r: any) => (
                        <Space size={2}>
                          <Button
                            type="link"
                            size="small"
                            onClick={() => {
                              setEditingCategory(r);
                              categoryForm.setFieldsValue({
                                name: r.name,
                                defaultGroupId: r.defaultGroupId,
                                sort: r.sort,
                              });
                              setCategoryOpen(true);
                            }}
                          >
                            编辑
                          </Button>
                          <Button type="link" size="small" danger={r.status === 'ACTIVE'} onClick={() => toggleCategory(r)}>
                            {r.status === 'ACTIVE' ? '停用' : '启用'}
                          </Button>
                        </Space>
                      ),
                    },
                  ]}
                />
              </Card>
            ),
          },
          {
            key: 'groups',
            label: '处理组',
            children: (
              <Card
                extra={
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={() => {
                      setEditingGroup(null);
                      groupForm.resetFields();
                      setGroupOpen(true);
                    }}
                  >
                    新建处理组
                  </Button>
                }
              >
                <Table
                  rowKey="id"
                  loading={groupLoading}
                  dataSource={groups ?? []}
                  pagination={false}
                  columns={[
                    { title: '名称', dataIndex: 'name', width: 160 },
                    { title: '说明', dataIndex: 'description', render: (v) => v || '-' },
                    {
                      title: '成员',
                      width: 300,
                      render: (_: any, r: any) => (
                        <Space wrap size={4}>
                          {(r.members ?? []).length === 0
                            ? '-'
                            : r.members.map((m: any) => (
                                <Tag key={m.id} color={m.isLead ? 'purple' : 'blue'}>
                                  {m.user?.name}
                                  {m.isLead ? '（组长）' : ''}
                                </Tag>
                              ))}
                        </Space>
                      ),
                    },
                    {
                      title: '状态',
                      dataIndex: 'status',
                      width: 90,
                      render: (v) => <Tag color={v === 'ACTIVE' ? 'green' : 'default'}>{v === 'ACTIVE' ? '启用' : '停用'}</Tag>,
                    },
                    {
                      title: '操作',
                      width: 220,
                      render: (_: any, r: any) => (
                        <Space size={2}>
                          <Button
                            type="link"
                            size="small"
                            onClick={() => {
                              setMemberGroup(r);
                              setMemberIds((r.members ?? []).map((m: any) => m.userId));
                            }}
                          >
                            设置成员
                          </Button>
                          <Button
                            type="link"
                            size="small"
                            onClick={() => {
                              setEditingGroup(r);
                              groupForm.setFieldsValue({ name: r.name, description: r.description });
                              setGroupOpen(true);
                            }}
                          >
                            编辑
                          </Button>
                          <Button type="link" size="small" danger={r.status === 'ACTIVE'} onClick={() => toggleGroup(r)}>
                            {r.status === 'ACTIVE' ? '停用' : '启用'}
                          </Button>
                        </Space>
                      ),
                    },
                  ]}
                />
              </Card>
            ),
          },
        ]}
      />

      <Modal
        open={categoryOpen}
        title={editingCategory ? '编辑分类' : '新建分类'}
        onCancel={() => setCategoryOpen(false)}
        onOk={saveCategory}
        confirmLoading={saving}
        okText="保存"
        destroyOnClose
      >
        <Form form={categoryForm} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="name" label="分类名称" rules={[{ required: true, message: '请输入分类名称' }, { max: 50 }]}>
            <Input />
          </Form.Item>
          <Form.Item name="defaultGroupId" label="默认处理组" rules={[{ required: true, message: '请选择默认处理组' }]}>
            <Select options={(groups ?? []).map((g: any) => ({ value: g.id, label: g.name }))} />
          </Form.Item>
          <Form.Item name="sort" label="排序（数字越小越靠前）">
            <InputNumber min={0} max={9999} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={groupOpen}
        title={editingGroup ? '编辑处理组' : '新建处理组'}
        onCancel={() => setGroupOpen(false)}
        onOk={saveGroup}
        confirmLoading={saving}
        okText="保存"
        destroyOnClose
      >
        <Form form={groupForm} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="name" label="处理组名称" rules={[{ required: true, message: '请输入名称' }, { max: 50 }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="说明">
            <Input.TextArea rows={3} maxLength={200} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={!!memberGroup}
        title={`设置成员：${memberGroup?.name ?? ''}`}
        onCancel={() => setMemberGroup(null)}
        onOk={saveMembers}
        confirmLoading={saving}
        okText="保存"
        destroyOnClose
      >
        <div style={{ color: '#8c8c8c', marginBottom: 12 }}>
          仅处理人 / 运维主管可加入处理组。保存为覆盖式设置。
        </div>
        <Select
          mode="multiple"
          style={{ width: '100%' }}
          placeholder="选择成员"
          value={memberIds}
          onChange={setMemberIds}
          options={opsUsers.map((u: any) => ({ value: u.id, label: `${u.name}（${u.role}）` }))}
          showSearch
          optionFilterProp="label"
        />
      </Modal>
    </div>
  );
}
