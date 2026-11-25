import React, { useMemo } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Avatar, Badge, Dropdown, Layout, Menu, Space, Tag, Typography } from 'antd';
import {
  AuditOutlined,
  BarChartOutlined,
  BellOutlined,
  FileTextOutlined,
  LogoutOutlined,
  PlusOutlined,
  SettingOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { ROLE_LABELS } from '@ticketreport/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

const { Header, Sider, Content } = Layout;

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const { data: unread } = useQuery({
    queryKey: ['unread-count'],
    queryFn: () => api.get('/notifications/unread-count'),
    refetchInterval: 30000,
    enabled: !!user,
  });

  const menuItems = useMemo(() => {
    const items: any[] = [
      { key: '/tickets', icon: <FileTextOutlined />, label: '工单列表' },
    ];
    items.push({ key: '/tickets/new', icon: <PlusOutlined />, label: '提交工单' });
    items.push({ key: '/notifications', icon: <BellOutlined />, label: '消息中心' });
    items.push({ key: '/reports', icon: <BarChartOutlined />, label: '统计报表' });
    if (user?.role === 'ADMIN') {
      items.push({
        key: 'admin',
        icon: <SettingOutlined />,
        label: '系统管理',
        children: [
          { key: '/admin/enterprises', icon: <TeamOutlined />, label: '客户企业' },
          { key: '/admin/users', icon: <UserOutlined />, label: '账号管理' },
          { key: '/admin/categories', icon: <SettingOutlined />, label: '分类与处理组' },
          { key: '/admin/settings', icon: <SettingOutlined />, label: '系统设置' },
          { key: '/admin/audit', icon: <AuditOutlined />, label: '审计日志' },
        ],
      });
    }
    items.push({ key: '/profile', icon: <UserOutlined />, label: '个人设置' });
    return items;
  }, [user?.role]);

  const selectedKey = useMemo(() => {
    const path = location.pathname;
    if (path.startsWith('/tickets/new')) return '/tickets/new';
    if (path.startsWith('/tickets/')) return '/tickets';
    return path;
  }, [location.pathname]);

  const openKeys = location.pathname.startsWith('/admin') ? ['admin'] : [];

  const userMenu = {
    items: [
      { key: 'profile', icon: <UserOutlined />, label: '个人设置' },
      { type: 'divider' as const },
      { key: 'logout', icon: <LogoutOutlined />, label: '退出登录' },
    ],
    onClick: async ({ key }: { key: string }) => {
      if (key === 'profile') navigate('/profile');
      if (key === 'logout') {
        await logout();
        navigate('/login', { replace: true });
      }
    },
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider width={216} theme="dark" breakpoint="lg" collapsedWidth={0}>
        <div className="layout-logo">
          <FileTextOutlined style={{ fontSize: 20 }} />
          <span>运维工单系统</span>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          items={menuItems}
          selectedKeys={[selectedKey]}
          defaultOpenKeys={openKeys}
          onClick={({ key }) => {
            if (key.startsWith('/')) navigate(key);
          }}
        />
      </Sider>
      <Layout>
        <Header className="layout-header">
          <Typography.Text type="secondary">
            {user?.role === 'REPORTER' ? user.enterpriseName || '客户工作台' : '运维工作台'}
          </Typography.Text>
          <Space size={18}>
            <Badge count={unread?.count ?? 0} size="small">
              <BellOutlined style={{ fontSize: 18, cursor: 'pointer' }} onClick={() => navigate('/notifications')} />
            </Badge>
            <Dropdown menu={userMenu} placement="bottomRight">
              <Space style={{ cursor: 'pointer' }}>
                <Avatar size="small" style={{ background: '#1668dc' }}>
                  {user?.name?.slice(0, 1)}
                </Avatar>
                <span>{user?.name}</span>
                <Tag color="blue" style={{ marginInlineEnd: 0 }}>
                  {user ? ROLE_LABELS[user.role] : ''}
                </Tag>
              </Space>
            </Dropdown>
          </Space>
        </Header>
        <Content style={{ padding: 20, overflow: 'auto' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
