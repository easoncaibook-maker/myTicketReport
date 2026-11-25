import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Card, Checkbox, DatePicker, Form, Input, Select, Space, Table, Tag, message } from 'antd';
import { PlusOutlined, ReloadOutlined, StarFilled, StarOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PRIORITIES,
  PRIORITY_LABELS,
  STATUS_LABELS,
  TICKET_STATUSES,
  formatDate,
} from '@ticketreport/shared';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PriorityTag, StatusTag, formatHours } from '../lib/ui';

const { RangePicker } = DatePicker;

export default function TicketListPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<any>({ page: 1, pageSize: 10 });
  const [form] = Form.useForm();

  const { data: categories } = useQuery({
    queryKey: ['meta-categories'],
    queryFn: () => api.get('/meta/categories'),
  });

  const params = useMemo(() => {
    const p: Record<string, string> = {};
    Object.entries(filters).forEach(([k, v]) => {
      if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) return;
      if (Array.isArray(v)) p[k] = v.join(',');
      else p[k] = String(v);
    });
    return p;
  }, [filters]);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['tickets', params],
    queryFn: () => api.get(`/tickets?${new URLSearchParams(params).toString()}`),
  });

  const onSearch = (values: any) => {
    const range = values.range;
    setFilters({
      page: 1,
      pageSize: filters.pageSize,
      keyword: values.keyword,
      status: values.status,
      priority: values.priority,
      categoryId: values.categoryId,
      favorite: values.favorite ? '1' : undefined,
      from: range?.[0]?.format('YYYY-MM-DD'),
      to: range?.[1]?.format('YYYY-MM-DD'),
    });
  };

  const toggleFavorite = async (r: any) => {
    try {
      if (r.favorited) await api.del(`/tickets/${r.id}/favorite`);
      else await api.post(`/tickets/${r.id}/favorite`);
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      queryClient.invalidateQueries({ queryKey: ['ticket', r.id] });
    } catch (e) {
      message.error(errorMessage(e));
    }
  };

  const claim = async (id: string) => {
    try {
      await api.post(`/tickets/${id}/claim`);
      message.success('认领成功');
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
    } catch (e) {
      message.error(errorMessage(e));
    }
  };

  const columns: any[] = [
    {
      title: '编号',
      dataIndex: 'ticketNo',
      width: 170,
      render: (v: string, r: any) => <Link to={`/tickets/${r.id}`} className="mono">{v}</Link>,
    },
    {
      title: '标题',
      dataIndex: 'title',
      ellipsis: true,
      render: (v: string, r: any) => (
        <Space size={6}>
          <Button
            type="text"
            size="small"
            title={r.favorited ? '取消收藏' : '收藏'}
            aria-label={r.favorited ? '取消收藏' : '收藏'}
            icon={r.favorited ? <StarFilled style={{ color: '#faad14' }} /> : <StarOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              toggleFavorite(r);
            }}
          />
          <Link to={`/tickets/${r.id}`}>{v}</Link>
        </Space>
      ),
    },
    { title: '状态', dataIndex: 'status', width: 130, render: (v: any) => <StatusTag status={v} /> },
    { title: '优先级', dataIndex: 'priority', width: 90, render: (v: any) => <PriorityTag priority={v} /> },
    { title: '分类', dataIndex: 'categoryName', width: 130 },
    {
      title: '提报人 / 企业',
      width: 190,
      render: (_: any, r: any) => (
        <div>
          <div>{r.reporterName}</div>
          <div style={{ fontSize: 12, color: '#8c8c8c' }}>
            {r.isInternal ? '内部工单' : r.enterpriseName}
            {r.onBehalf ? ' · 代提' : ''}
          </div>
        </div>
      ),
    },
    {
      title: '处理人',
      dataIndex: 'assigneeName',
      width: 110,
      render: (v: string) => v || <Tag>未分配</Tag>,
    },
    {
      title: '处理工时',
      dataIndex: 'workHours',
      width: 110,
      align: 'right',
      render: (v: number | null) => formatHours(v),
    },
    {
      title: '更新时间',
      dataIndex: 'lastActivityAt',
      width: 150,
      render: (v: string) => formatDate(v),
    },
    {
      title: '操作',
      width: 130,
      fixed: 'right',
      render: (_: any, r: any) => (
        <Space size={4}>
          <Button type="link" size="small" onClick={() => navigate(`/tickets/${r.id}`)}>
            查看
          </Button>
          {user?.role !== 'REPORTER' && r.status === 'PENDING' && !r.assigneeId && (
            <Button type="link" size="small" onClick={() => claim(r.id)}>
              领取
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 className="page-title" style={{ margin: 0 }}>
          工单列表
        </h2>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/tickets/new')}>
            提交工单
          </Button>        </Space>
      </div>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Form form={form} layout="inline" onFinish={onSearch} style={{ rowGap: 12 }}>
          <Form.Item name="keyword">
            <Input placeholder="编号 / 标题" allowClear style={{ width: 200 }} />
          </Form.Item>
          <Form.Item name="status">
            <Select
              mode="multiple"
              placeholder="状态"
              allowClear
              style={{ minWidth: 190 }}
              options={TICKET_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
            />
          </Form.Item>
          <Form.Item name="priority">
            <Select
              placeholder="优先级"
              allowClear
              style={{ width: 110 }}
              options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))}
            />
          </Form.Item>
          <Form.Item name="categoryId">
            <Select
              placeholder="分类"
              allowClear
              style={{ width: 140 }}
              options={(categories ?? []).map((c: any) => ({ value: c.id, label: c.name }))}
            />
          </Form.Item>
          <Form.Item name="range">
            <RangePicker style={{ width: 240 }} />
          </Form.Item>
          <Form.Item name="favorite" valuePropName="checked">
            <Checkbox>只看我收藏</Checkbox>
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">
                筛选
              </Button>
              <Button
                onClick={() => {
                  form.resetFields();
                  setFilters({ page: 1, pageSize: filters.pageSize });
                }}
              >
                重置
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>

      <Table
        rowKey="id"
        loading={isLoading}
        columns={columns}
        dataSource={data?.items ?? []}
        scroll={{ x: 1180 }}
        rowClassName={(r: any) => (r.favorited ? 'ticket-row-favorited' : '')}
        pagination={{
          current: data?.page ?? 1,
          pageSize: data?.pageSize ?? 10,
          total: data?.total ?? 0,
          showTotal: (t) => `共 ${t} 条`,
          onChange: (page, pageSize) => setFilters((f: any) => ({ ...f, page, pageSize })),
        }}
      />
    </div>
  );
}
