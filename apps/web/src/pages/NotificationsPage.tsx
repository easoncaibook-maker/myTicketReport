import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Card, Empty, Space, Tag, message } from 'antd';
import { CheckOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDate } from '@ticketreport/shared';
import { api, errorMessage } from '../lib/api';

export default function NotificationsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [onlyUnread, setOnlyUnread] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['notifications', page, onlyUnread],
    queryFn: () => api.get(`/notifications?page=${page}&pageSize=20${onlyUnread ? '&onlyUnread=true' : ''}`),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
    queryClient.invalidateQueries({ queryKey: ['unread-count'] });
  };

  const open = async (n: any) => {
    if (!n.readAt) {
      try {
        await api.post(`/notifications/${n.id}/read`);
        queryClient.invalidateQueries({ queryKey: ['unread-count'] });
      } catch {
        // 忽略已读失败
      }
    }
    if (n.ticketId) navigate(`/tickets/${n.ticketId}`);
  };

  const markAll = async () => {
    try {
      await api.post('/notifications/read-all');
      message.success('已全部标记为已读');
      refresh();
    } catch (e) {
      message.error(errorMessage(e));
    }
  };

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  return (
    <div style={{ maxWidth: 960 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 className="page-title" style={{ margin: 0 }}>
          消息中心
        </h2>
        <Space>
          <Button size="small" onClick={() => { setOnlyUnread((v) => !v); setPage(1); }}>
            {onlyUnread ? '查看全部' : '只看未读'}
          </Button>
          <Button size="small" icon={<CheckOutlined />} onClick={markAll}>
            全部已读
          </Button>
        </Space>
      </div>

      <Card loading={isLoading}>
        {items.length === 0 ? (
          <Empty description="暂无消息" />
        ) : (
          <div>
            {items.map((n: any) => (
              <div
                key={n.id}
                onClick={() => open(n)}
                style={{
                  padding: '14px 12px',
                  borderBottom: '1px solid #f0f0f0',
                  cursor: 'pointer',
                  background: n.readAt ? undefined : '#f0f7ff',
                  borderRadius: 6,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <Space>
                    {!n.readAt && <Badge status="processing" />}
                    <strong>{n.title}</strong>
                  </Space>
                  <span style={{ color: '#8c8c8c', fontSize: 12, whiteSpace: 'nowrap' }}>{formatDate(n.createdAt)}</span>
                </div>
                <div style={{ color: '#595959', marginTop: 4 }}>{n.body}</div>
                {n.ticketId && (
                  <Tag color="blue" style={{ marginTop: 6 }}>
                    查看工单
                  </Tag>
                )}
              </div>
            ))}
            <div style={{ marginTop: 16, textAlign: 'right' }}>
              <Space>
                <span style={{ color: '#8c8c8c' }}>
                  共 {total} 条，第 {page} 页
                </span>
                <Button size="small" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  上一页
                </Button>
                <Button size="small" disabled={page * 20 >= total} onClick={() => setPage((p) => p + 1)}>
                  下一页
                </Button>
              </Space>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
