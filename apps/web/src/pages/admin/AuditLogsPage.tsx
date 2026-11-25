import React, { useState } from 'react';
import { Card, Table, Tag } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { formatDate } from '@ticketreport/shared';
import { api } from '../../lib/api';

export default function AuditLogsPage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-audit', page, pageSize],
    queryFn: () => api.get(`/admin/audit-logs?page=${page}&pageSize=${pageSize}`),
  });

  return (
    <div>
      <h2 className="page-title">审计日志</h2>
      <Card>
        <Table
          rowKey="id"
          loading={isLoading}
          dataSource={data?.items ?? []}
          pagination={{
            current: data?.page ?? page,
            pageSize: data?.pageSize ?? pageSize,
            total: data?.total ?? 0,
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p, ps) => {
              setPage(p);
              setPageSize(ps);
            },
          }}
          columns={[
            { title: '时间', dataIndex: 'createdAt', width: 160, render: (v) => formatDate(v) },
            { title: '操作人', dataIndex: 'actorName', width: 140 },
            { title: '动作', dataIndex: 'action', width: 180, render: (v) => <Tag color="blue">{v}</Tag> },
            { title: '对象类型', dataIndex: 'targetType', width: 140 },
            {
              title: '对象 ID',
              dataIndex: 'targetId',
              width: 240,
              render: (v) => <span className="mono" style={{ fontSize: 12 }}>{v}</span>,
            },
            {
              title: '详情',
              dataIndex: 'detail',
              render: (v) => (v ? <span className="mono" style={{ fontSize: 12 }}>{JSON.stringify(v)}</span> : '-'),
            },
          ]}
        />
      </Card>
    </div>
  );
}
