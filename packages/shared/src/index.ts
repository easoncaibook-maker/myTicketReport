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

export const TICKET_TYPES = ['CUSTOMER', 'INTERNAL'] as const;
export type TicketType = (typeof TICKET_TYPES)[number];

export const TICKET_TYPE_LABELS: Record<TicketType, string> = {
  CUSTOMER: '客户工单',
  INTERNAL: '内部工单',
};

/** 内部工单类型值（不挂客户企业，仅运维团队可见） */
export const INTERNAL_TICKET = 'INTERNAL' as const;

export const PRIORITIES = ['P1', 'P2', 'P3', 'P4'] as const;export type Priority = (typeof PRIORITIES)[number];

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
  | 'CLOSE'
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
  { action: 'CLAIM', label: '认领工单', from: ['PENDING'], to: 'PROCESSING', roles: ['AGENT', 'OPS_LEAD', 'ADMIN'] },
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
    action: 'CLOSE',
    label: '关闭工单',
    from: ['PENDING_CONFIRM'],
    to: 'CLOSED',
    roles: ['AGENT', 'OPS_LEAD', 'ADMIN'],
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

/** 需要「提报人本人」执行的动作（客户工单由客户提报人执行，内部工单由运维提报人执行） */
const REPORTER_ACTIONS: TicketAction[] = ['CONFIRM', 'REJECT', 'REOPEN', 'CANCEL'];

export interface ActionContext {
  /** 当前用户是否为该工单提报人 */
  isReporter?: boolean;
  /** 是否为内部工单（无客户企业） */
  isInternal?: boolean;
}

export function availableActions(status: TicketStatus, role: Role, ctx: ActionContext = {}): TransitionDef[] {
  return TRANSITIONS.filter((t) => {
    if (!t.from.includes(status)) return false;
    if (REPORTER_ACTIONS.includes(t.action)) {
      // 内部工单没有客户在场，确认/驳回/重开/撤回由提报人本人完成，与角色无关
      if (ctx.isInternal) return !!ctx.isReporter;
      if (ctx.isReporter === false) return false;
      return t.roles.includes(role);
    }
    return t.roles.includes(role);
  });
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

/** 关闭来源：提报人确认 / 处理人关闭 / 管理员强制关闭，用于报表分列统计 */
export const CLOSE_SOURCES = ['REPORTER_CONFIRMED', 'ASSIGNEE_CLOSED', 'ADMIN_FORCE_CLOSED'] as const;
export type CloseSource = (typeof CLOSE_SOURCES)[number];

export const CLOSE_SOURCE_LABELS: Record<CloseSource, string> = {
  REPORTER_CONFIRMED: '提报人确认关闭',
  ASSIGNEE_CLOSED: '处理人关闭',
  ADMIN_FORCE_CLOSED: '管理员强制关闭',
};

/** 登录验证方式（系统设置三选一，切换后立即生效） */
export const LOGIN_VERIFICATION_MODES = ['SLIDER', 'EMAIL_CODE', 'TOTP'] as const;
export type LoginVerificationMode = (typeof LOGIN_VERIFICATION_MODES)[number];

export const LOGIN_VERIFICATION_LABELS: Record<LoginVerificationMode, string> = {
  SLIDER: '滑块验证',
  EMAIL_CODE: '邮件验证码',
  TOTP: 'Google 验证器（TOTP）',
};

export const LOGIN_VERIFICATION_DESCRIPTIONS: Record<LoginVerificationMode, string> = {
  SLIDER: '拖动滑块对齐缺口，无需外部服务，内网可用',
  EMAIL_CODE: '向账号邮箱发送 6 位验证码，可记住信任设备',
  TOTP: '使用 Google Authenticator 等验证器应用生成动态码',
};

export const ACTOR_ROLE_LABELS: Record<string, string> = ROLE_LABELS;

/** AI 问答知识库来源 */
export const AI_KB_SOURCES = ['FAQ', 'EXTERNAL_HTTP', 'INTERNAL'] as const;
export type AiKbSource = (typeof AI_KB_SOURCES)[number];

export const AI_KB_SOURCE_LABELS: Record<AiKbSource, string> = {
  FAQ: '内置 FAQ（关键词检索）',
  EXTERNAL_HTTP: '外部知识库（HTTP 检索）',
  INTERNAL: '内部知识库（预留占位）',
};

export const AI_KB_SOURCE_DESCRIPTIONS: Record<AiKbSource, string> = {
  FAQ: '后台录入的问答条目，按关键词打分排序，无需外部服务即可使用',
  EXTERNAL_HTTP: '调用外部知识库检索接口，通过字段映射转换为统一引用格式',
  INTERNAL: '预留给内部知识库接入的同一契约空实现，当前不返回任何内容',
};

/** FAQ 可见范围：PUBLIC 所有登录用户；INTERNAL 仅运维账号 */
export const FAQ_VISIBILITIES = ['PUBLIC', 'INTERNAL'] as const;
export type FaqVisibility = (typeof FAQ_VISIBILITIES)[number];

export const FAQ_VISIBILITY_LABELS: Record<FaqVisibility, string> = {
  PUBLIC: '公开（所有登录用户）',
  INTERNAL: '仅运维内部',
};

export interface AiCitation {
  /** 回答中的引用序号，对应 [1][2]… */
  index: number;
  source: 'FAQ' | 'EXTERNAL_HTTP' | 'INTERNAL';
  id: string;
  title: string;
  snippet: string;
  url?: string | null;
}

export interface AiChatMessageView {
  id: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  citations: AiCitation[];
  createdAt: string;
  meta?: Record<string, any> | null;
}

export interface AiConversationView {
  id: string;
  title: string;
  messageCount: number;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface AiStatusView {
  enabled: boolean;
  configured: boolean;
  kbSource: AiKbSource;
  kbConfigured: boolean;
  rateLimitPerMinute: number;
  maxMessageChars: number;
  suggestedQuestions: string[];
  notice?: string | null;
}

/**
 * 「上报为工单」接口契约（本版本未实现，不会创建工单）。
 * 设计：对话页在 AI 回答下提供「上报为工单」入口，用户确认后由大模型根据会话上下文
 * 生成工单草稿，用户可编辑后再调用现有 POST /tickets 创建，AI 侧不直接落库。
 */
export const AI_TICKET_DRAFT_CONTRACT = {
  implemented: false,
  endpoint: 'POST /api/ai/ticket-draft',
  request: {
    conversationId: 'string（必填，当前会话）',
    messageId: 'string（可选，指定作为草稿依据的 AI 回答）',
    hint: 'string（可选，用户补充说明，最多 500 字）',
  },
  response: {
    implemented: false,
    draft: {
      title: 'string（工单标题，≤ 80 字）',
      description: 'string（问题描述，纯文本，≤ 2000 字）',
      categoryId: 'string（从 /api/meta/categories 中选择）',
      priority: 'P1 | P2 | P3 | P4',
    },
    requiresUserConfirm: true,
  },
  notes: [
    '本版本仅提供入口与交互设计，接口返回 501 NOT_IMPLEMENTED，不创建工单',
    '后续实现时复用 POST /api/tickets 的校验与权限，草稿只做预填不直接落库',
  ],
} as const;

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
