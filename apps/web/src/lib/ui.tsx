import React from 'react';
import { Tag } from 'antd';
import {
  PRIORITY_COLORS,
  PRIORITY_LABELS,
  Priority,
  ROLE_LABELS,
  Role,
  STATUS_COLORS,
  STATUS_LABELS,
  TicketStatus,
} from '@ticketreport/shared';

export function StatusTag({ status }: { status: TicketStatus }) {
  return <Tag color={STATUS_COLORS[status]}>{STATUS_LABELS[status] ?? status}</Tag>;
}

export function PriorityTag({ priority }: { priority: Priority }) {
  return <Tag color={PRIORITY_COLORS[priority]}>{PRIORITY_LABELS[priority] ?? priority}</Tag>;
}

export function RoleTag({ role }: { role: Role }) {
  const color = role === 'ADMIN' ? 'gold' : role === 'OPS_LEAD' ? 'purple' : role === 'AGENT' ? 'blue' : 'default';
  return <Tag color={color}>{ROLE_LABELS[role] ?? role}</Tag>;
}

export const ACTION_LABELS: Record<string, string> = {
  CREATE: '创建工单',
  EDIT: '编辑工单',
  CLAIM: '认领工单',
  CLAIM_CROSS: '跨组领取',
  ASSIGN: '改派',
  TRANSFER: '转派',
  RELEASE: '撤回认领',
  RESOLVE: '提交处理结果',
  CLOSE: '关闭工单',
  CONFIRM: '确认已解决',
  REJECT: '反馈未解决',
  FORCE_CLOSE: '强制关闭',
  REOPEN: '重开工单',
  CANCEL: '撤回工单',
  WORK_HOURS: '修改处理工时',
};

export function ActionLabel({ action }: { action: string }) {
  return <span>{ACTION_LABELS[action] ?? action}</span>;
}

export function formatBytes(size?: number | null) {
  if (!size && size !== 0) return '-';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export const EVENT_DOT_COLORS: Record<string, string> = {
  CREATE: 'blue',
  CLAIM: 'blue',
  CLAIM_CROSS: 'gold',
  ASSIGN: 'blue',
  TRANSFER: 'orange',
  RELEASE: 'orange',
  RESOLVE: 'purple',
  CONFIRM: 'green',
  FORCE_CLOSE: 'red',
  REJECT: 'red',
  REOPEN: 'orange',
  CANCEL: 'gray',
  EDIT: 'gray',
  WORK_HOURS: 'cyan',
};

export function formatHours(value?: number | null) {
  if (value === null || value === undefined) return '-';
  return `${Number(value).toFixed(1)} 小时`;
}
