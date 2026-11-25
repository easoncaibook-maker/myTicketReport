export const ROLES = ['REPORTER', 'AGENT', 'OPS_LEAD', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  REPORTER: '提报人',
  AGENT: '处理人',
  OPS_LEAD: '运维主管',
  ADMIN: '管理员',
};

export const TICKET_STATUSES = [
  'PENDING',
  'PROCESSING',
  'PENDING_CONFIRM',
  'CLOSED',
  'CANCELLED',
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const STATUS_LABELS: Record<TicketStatus, string> = {
  PENDING: '待受理',
  PROCESSING: '处理中',
  PENDING_CONFIRM: '待提报人确认',
  CLOSED: '已关闭',
  CANCELLED: '已取消',
};

/** 状态对应的标签色（AntD Tag color） */
export const STATUS_COLORS: Record<TicketStatus, string> = {
  PENDING: 'orange',
  PROCESSING: 'blue',
  PENDING_CONFIRM: 'purple',
  CLOSED: 'green',
  CANCELLED: 'default',
};

export const PRIORITIES = ['P1', 'P2', 'P3', 'P4'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_LABELS: Record<Priority, string> = {
  P1: '紧急',
  P2: '高',
  P3: '中',
  P4: '低',
};

export const PRIORITY_COLORS: Record<Priority, string> = {
  P1: 'red',
  P2: 'volcano',
  P3: 'blue',
  P4: 'default',
};

export const VISIBILITIES = ['PUBLIC', 'INTERNAL'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export type TicketAction =
  | 'CLAIM'
  | 'ASSIGN'
  | 'TRANSFER'
  | 'RELEASE'
  | 'RESOLVE'
  | 'CONFIRM'
  | 'REJECT'
  | 'FORCE_CLOSE'
  | 'REOPEN'
  | 'CANCEL';

export interface TransitionDef {
  action: TicketAction;
  label: string;
  from: TicketStatus[];
  /** 目标状态；TRANSFER 的实际目标由是否指定处理人决定 */
  to: TicketStatus;
  roles: Role[];
  requiresReason?: boolean;
  requiresAssignee?: boolean;
  requiresResolution?: boolean;
  danger?: boolean;
}

/**
 * 工单状态机唯一配置源：前后端共享。
 * 服务端在此基础上追加「资源归属、本组、本人」校验。
 */
export const TRANSITIONS: TransitionDef[] = [
  { action: 'CLAIM', label: '认领工单', from: ['PENDING'], to: 'PROCESSING', roles: ['AGENT'] },
  {
    action: 'ASSIGN',
    label: '改派',
    from: ['PENDING', 'PROCESSING'],
    to: 'PROCESSING',
    roles: ['OPS_LEAD', 'ADMIN'],
    requiresAssignee: true,
  },
  {
    action: 'TRANSFER',
    label: '转派',
    from: ['PROCESSING'],
    to: 'PROCESSING',
    roles: ['AGENT', 'OPS_LEAD', 'ADMIN'],
    requiresReason: true,
  },
  {
    action: 'RELEASE',
    label: '撤回认领',
    from: ['PENDING', 'PROCESSING'],
    to: 'PENDING',
    roles: ['OPS_LEAD', 'ADMIN'],
    requiresReason: true,
  },
  {
    action: 'RESOLVE',
    label: '提交处理结果',
    from: ['PROCESSING'],
    to: 'PENDING_CONFIRM',
    roles: ['AGENT', 'OPS_LEAD', 'ADMIN'],
    requiresResolution: true,
  },
  {
    action: 'CONFIRM',
    label: '确认已解决',
    from: ['PENDING_CONFIRM'],
    to: 'CLOSED',
    roles: ['REPORTER'],
  },
  {
    action: 'REJECT',
    label: '反馈未解决',
    from: ['PENDING_CONFIRM'],
    to: 'PROCESSING',
    roles: ['REPORTER'],
    requiresReason: true,
  },
  {
    action: 'FORCE_CLOSE',
    label: '强制关闭',
    from: ['PROCESSING', 'PENDING_CONFIRM'],
    to: 'CLOSED',
    roles: ['OPS_LEAD', 'ADMIN'],
    requiresReason: true,
    danger: true,
  },
  {
    action: 'REOPEN',
    label: '重开工单',
    from: ['CLOSED'],
    to: 'PROCESSING',
    roles: ['REPORTER'],
  },
  {
    action: 'CANCEL',
    label: '撤回工单',
    from: ['PENDING'],
    to: 'CANCELLED',
    roles: ['REPORTER'],
    danger: true,
  },
];

export function availableActions(status: TicketStatus, role: Role): TransitionDef[] {
  return TRANSITIONS.filter((t) => t.from.includes(status) && t.roles.includes(role));
}

export function findTransition(action: string): TransitionDef | undefined {
  return TRANSITIONS.find((t) => t.action === action);
}

/** 处理工时：允许填写的角色与工单状态（处理中及之后） */
export const WORK_HOURS_ROLES: Role[] = ['AGENT', 'OPS_LEAD', 'ADMIN'];
export const WORK_HOURS_STATUSES: TicketStatus[] = ['PROCESSING', 'PENDING_CONFIRM', 'CLOSED'];

export function canEditWorkHours(role: Role, status: TicketStatus): boolean {
  return WORK_HOURS_ROLES.includes(role) && WORK_HOURS_STATUSES.includes(status);
}

export const ACTOR_ROLE_LABELS: Record<string, string> = ROLE_LABELS;

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function formatDate(input: string | Date | null | undefined): string {
  if (!input) return '-';
  const d = typeof input === 'string' ? new Date(input) : input;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
}
