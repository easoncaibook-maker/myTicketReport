import React, { useMemo, useState } from 'react';
import { Card, Col, DatePicker, Row, Select, Statistic, Table } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { PRIORITY_LABELS, STATUS_LABELS, TICKET_STATUSES } from '@ticketreport/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

const { RangePicker } = DatePicker;

const BAR_COLORS = ['#1668dc', '#13a8a8', '#722ed1', '#52c41a', '#8c8c8c', '#fa8c16', '#eb2f96'];

function BarRow({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="report-bar-row">
      <div className="report-bar-label">{label}</div>
      <div className="report-bar-track">
        <div className="report-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="report-bar-value">
        {count}（{pct}%）
      </div>
    </div>
  );
}

export default function ReportsPage() {
  const { user } = useAuth();
  const [range, setRange] = useState<any>(null);
  const [enterpriseId, setEnterpriseId] = useState<string | undefined>();

  const params = useMemo(() => {
    const p: Record<string, string> = {};
    if (range?.[0]) p.from = range[0].format('YYYY-MM-DD');
    if (range?.[1]) p.to = range[1].format('YYYY-MM-DD');
    if (enterpriseId) p.enterpriseId = enterpriseId;
    return p;
  }, [range, enterpriseId]);

  const qs = new URLSearchParams(params).toString();

  const { data: overview } = useQuery({
    queryKey: ['report-overview', qs],
    queryFn: () => api.get(`/reports/overview?${qs}`),
  });

  const { data: workload } = useQuery({
    queryKey: ['report-workload', qs],
    queryFn: () => api.get(`/reports/workload?${qs}`),
  });

  const { data: enterprises } = useQuery({
    queryKey: ['meta-enterprises'],
    queryFn: () => api.get('/meta/enterprises'),
    enabled: user?.role === 'OPS_LEAD' || user?.role === 'ADMIN',
  });

  const statusMap = new Map<string, number>((overview?.byStatus ?? []).map((s: any) => [s.status, s.count]));
  const total = Number(overview?.total ?? 0);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <h2 className="page-title" style={{ margin: 0 }}>
          统计报表
        </h2>
        <div style={{ display: 'flex', gap: 12 }}>
          {(user?.role === 'OPS_LEAD' || user?.role === 'ADMIN') && (
            <Select
              allowClear
              placeholder="全部企业"
              style={{ width: 200 }}
              value={enterpriseId}
              onChange={setEnterpriseId}
              options={(enterprises ?? []).map((e: any) => ({ value: e.id, label: e.name }))}
            />
          )}
          <RangePicker value={range} onChange={setRange} />
        </div>
      </div>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6} xl={3}>
          <Card>
            <Statistic title="工单总数" value={total} />
          </Card>
        </Col>
        {TICKET_STATUSES.map((s) => (
          <Col xs={12} md={6} xl={3} key={s}>
            <Card>
              <Statistic title={STATUS_LABELS[s]} value={statusMap.get(s) ?? 0} />
            </Card>
          </Col>
        ))}
        <Col xs={12} md={6} xl={3}>
          <Card>
            <Statistic title="平均处理时长" value={Number(overview?.avgHandleHours ?? 0)} suffix="小时" precision={1} />
          </Card>
        </Col>
        <Col xs={12} md={6} xl={3}>
          <Card>
            <Statistic title="工时合计" value={Number(overview?.totalWorkHours ?? 0)} suffix="小时" precision={1} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title="状态分布">
            {(overview?.byStatus ?? []).map((s: any, i: number) => (
              <BarRow key={s.status} label={s.label} count={s.count} total={total} color={BAR_COLORS[i % BAR_COLORS.length]} />
            ))}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="优先级分布">
            {(overview?.byPriority ?? []).map((p: any, i: number) => (
              <BarRow
                key={p.priority}
                label={PRIORITY_LABELS[p.priority] ?? p.label}
                count={p.count}
                total={total}
                color={BAR_COLORS[(i + 2) % BAR_COLORS.length]}
              />
            ))}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="分类分布">
            {(overview?.byCategory ?? []).length === 0 ? (
              <div style={{ color: '#8c8c8c' }}>暂无数据</div>
            ) : (
              overview.byCategory.map((c: any, i: number) => (
                <BarRow key={c.name} label={c.name} count={c.count} total={total} color={BAR_COLORS[i % BAR_COLORS.length]} />
              ))
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="处理人工作量">
            <Table
              rowKey="assigneeId"
              size="small"
              pagination={false}
              dataSource={workload?.items ?? []}
              columns={[
                { title: '处理人', dataIndex: 'assigneeName' },
                { title: '当前处理中', dataIndex: 'processing', width: 120 },
                { title: '近 30 天关闭', dataIndex: 'closed30', width: 130 },
                {
                  title: '工时合计',
                  dataIndex: 'workHours',
                  width: 110,
                  render: (v: number) => `${Number(v ?? 0).toFixed(1)} 小时`,
                },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
