import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ROLE_LABELS,
  STATUS_LABELS,
  TicketAction,
  TicketStatus,
  WORK_HOURS_ROLES,
  WORK_HOURS_STATUSES,
  availableActions,
  canEditWorkHours,
  findTransition,
} from '@ticketreport/shared';
import type { Response } from 'express';
import { AuditService } from '../audit/audit.module';
import { AuthUser } from '../common/decorators';
import { normalizeRichText } from '../common/rich-text';
import { ticketScope } from '../common/scope';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.module';
import { AttachmentsService } from './attachments.service';
import { TICKET_INCLUDE, TicketAccessService } from './ticket.access';
import { commentView, ticketDetail, ticketSummary } from './ticket.mapper';

@Injectable()
export class TicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TicketAccessService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
    private readonly config: ConfigService,
    private readonly attachments: AttachmentsService,
    private readonly audit: AuditService,
  ) {}

  private link(ticketId: string) {
    return `${this.config.get('APP_BASE_URL') || 'http://localhost:5173'}/tickets/${ticketId}`;
  }

  private assertTransition(status: string, action: TicketAction, role: AuthUser['role']) {
    const def = findTransition(action);
    if (!def) throw new BadRequestException('不支持的操作');
    if (!def.roles.includes(role)) throw new ForbiddenException('没有执行该操作的权限');
    if (!def.from.includes(status as any)) {
      throw new ConflictException({
        code: 'TICKET_INVALID_TRANSITION',
        message: `当前状态「${STATUS_LABELS[status as any] || status}」不允许该操作`,
      });
    }
    return def;
  }

  /** 仅校验当前状态是否允许该动作（提报人身份类动作由调用方校验身份） */
  private assertStatus(status: string, action: TicketAction) {
    const def = findTransition(action);
    if (!def) throw new BadRequestException('不支持的操作');
    if (!def.from.includes(status as any)) {
      throw new ConflictException({
        code: 'TICKET_INVALID_TRANSITION',
        message: `当前状态「${STATUS_LABELS[status as any] || status}」不允许该操作`,
      });
    }
    return def;
  }

  private async groupRecipients(groupId: string, emailEnabled = false) {
    const members = await this.prisma.groupMember.findMany({
      where: { groupId, user: { status: 'ACTIVE' } },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    return members.map((m) => ({
      userId: m.user.id,
      email: m.user.email,
      name: m.user.name,
      inApp: true,
      emailEnabled,
    }));
  }

  private reporterRecipient(ticket: any) {
    return {
      userId: ticket.reporter.id,
      email: ticket.reporter.email,
      name: ticket.reporter.name,
      inApp: true,
      emailEnabled: true,
    };
  }

  /** 代客提单时通知客户企业内的客户账号 */
  private async enterpriseRecipients(enterpriseId: string) {
    const users = await this.prisma.user.findMany({
      where: { enterpriseId, role: 'REPORTER', status: 'ACTIVE' },
      select: { id: true, name: true, email: true },
    });
    return users.map((u) => ({
      userId: u.id,
      email: u.email,
      name: u.name,
      inApp: true,
      emailEnabled: false,
    }));
  }

  private async nextTicketNo() {
    const shanghai = new Date(Date.now() + 8 * 3600_000);
    const date = shanghai.toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `TK-${date}-`;
    const count = await this.prisma.ticket.count({ where: { ticketNo: { startsWith: prefix } } });
    return `${prefix}${String(count + 1).padStart(4, '0')}`;
  }

  async list(user: AuthUser, query: any) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
    const filters: any[] = [ticketScope(user)];
    if (query.status) {
      const statuses = String(query.status).split(',').filter(Boolean);
      if (statuses.length) filters.push({ status: { in: statuses } });
    }
    if (query.categoryId) filters.push({ categoryId: query.categoryId });
    if (query.priority) filters.push({ priority: query.priority });
    if (query.assigneeId) filters.push({ assigneeId: query.assigneeId === 'me' ? user.id : query.assigneeId });
    if (query.groupId) filters.push({ groupId: query.groupId });
    if (query.enterpriseId && user.role !== 'REPORTER') filters.push({ enterpriseId: query.enterpriseId });
    if (query.favorite === '1' || query.favorite === 'true') {
      filters.push({ favorites: { some: { userId: user.id } } });
    }
    if (query.keyword) {
      filters.push({
        OR: [{ ticketNo: { contains: query.keyword } }, { title: { contains: query.keyword } }],
      });
    }
    if (query.from || query.to) {
      const range: any = {};
      if (query.from) range.gte = new Date(query.from);
      if (query.to) range.lte = new Date(`${query.to}T23:59:59`);
      filters.push({ createdAt: range });
    }
    const where = { AND: filters };
    const [items, total] = await Promise.all([
      this.prisma.ticket.findMany({
        where,
        include: TICKET_INCLUDE,
        orderBy: { lastActivityAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.ticket.count({ where }),
    ]);
    const favoriteIds = new Set(
      (
        await this.prisma.ticketFavorite.findMany({
          where: { userId: user.id, ticketId: { in: items.map((t) => t.id) } },
          select: { ticketId: true },
        })
      ).map((f) => f.ticketId),
    );
    return {
      items: items.map((t) => ticketSummary(t, favoriteIds.has(t.id))),
      total,
      page,
      pageSize,
    };
  }

  async get(user: AuthUser, id: string) {
    const ticket = await this.access.findAccessible(id, user);
    const [comments, events, attachments, favorite, relations] = await Promise.all([
      this.prisma.ticketComment.findMany({
        where: { ticketId: id, deletedAt: null },
        orderBy: { createdAt: 'asc' },
        include: { attachments: true },
      }),
      this.prisma.ticketEvent.findMany({ where: { ticketId: id }, orderBy: { createdAt: 'asc' } }),
      this.prisma.ticketAttachment.findMany({
        where: { ticketId: id, commentId: null },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.ticketFavorite.findUnique({
        where: { ticketId_userId: { ticketId: id, userId: user.id } },
      }),
      this.relationViews(user, id),
    ]);
    const detail = ticketDetail(
      { ...ticket, comments, events, attachments, favorited: !!favorite, relations },
      user.role,
    );
    const isReporter =
      ticket.ticketType === 'INTERNAL'
        ? ticket.reporterId === user.id
        : ticket.reporterId === user.id ||
          (!!ticket.onBehalf && user.role === 'REPORTER' && user.enterpriseId === ticket.enterpriseId);
    return {
      ...detail,
      availableActions: availableActions(ticket.status as any, user.role, {
        isReporter,
        isInternal: ticket.ticketType === 'INTERNAL',
      }).map((t) => ({
        action: t.action,
        label: t.label,
        requiresReason: !!t.requiresReason,
        requiresAssignee: !!t.requiresAssignee,
        requiresResolution: !!t.requiresResolution,
        danger: !!t.danger,
      })),
    };
  }

  /** 关联工单：仅返回当前用户有权查看的对方工单（客户不可跨企业看到） */
  private async relationViews(user: AuthUser, ticketId: string) {
    const rows = await this.prisma.ticketRelation.findMany({
      where: { OR: [{ ticketId }, { relatedTicketId: ticketId }] },
      orderBy: { createdAt: 'desc' },
    });
    if (!rows.length) return [];
    const otherIds = rows.map((r) => (r.ticketId === ticketId ? r.relatedTicketId : r.ticketId));
    const visible = await this.prisma.ticket.findMany({
      where: { AND: [{ id: { in: otherIds } }, ticketScope(user)] },
      include: TICKET_INCLUDE,
    });
    const map = new Map(visible.map((t) => [t.id, t]));
    const result: any[] = [];
    for (const row of rows) {
      const otherId = row.ticketId === ticketId ? row.relatedTicketId : row.ticketId;
      const ticket = map.get(otherId);
      if (ticket) result.push({ relationId: row.id, ticket: ticketSummary(ticket) });
    }
    return result;
  }

  async relations(user: AuthUser, id: string) {
    await this.access.findAccessible(id, user);
    return this.relationViews(user, id);
  }

  async addRelation(user: AuthUser, id: string, relatedTicketId: string) {
    if (!relatedTicketId) throw new BadRequestException('请选择要关联的工单');
    if (relatedTicketId === id) throw new BadRequestException('不能关联工单自身');
    await this.access.findAccessible(id, user);
    // 越权关联一律 404，避免通过关联探测其他企业工单
    await this.access.findAccessible(relatedTicketId, user);
    const [first, second] = id < relatedTicketId ? [id, relatedTicketId] : [relatedTicketId, id];
    const exists = await this.prisma.ticketRelation.findUnique({
      where: { ticketId_relatedTicketId: { ticketId: first, relatedTicketId: second } },
    });
    if (exists) throw new ConflictException('这两个工单已关联');
    await this.prisma.ticketRelation.create({
      data: { ticketId: first, relatedTicketId: second, createdById: user.id },
    });
    return this.get(user, id);
  }

  async removeRelation(user: AuthUser, id: string, relationId: string) {
    const relation = await this.prisma.ticketRelation.findFirst({
      where: { id: relationId, OR: [{ ticketId: id }, { relatedTicketId: id }] },
    });
    if (!relation) throw new NotFoundException('关联不存在');
    // 双方都可见才允许解除，避免操作到看不到的数据
    await this.access.findAccessible(relation.ticketId, user);
    await this.access.findAccessible(relation.relatedTicketId, user);
    await this.prisma.ticketRelation.delete({ where: { id: relationId } });
    return this.get(user, id);
  }

  async favorite(user: AuthUser, id: string) {
    await this.access.findAccessible(id, user);
    await this.prisma.ticketFavorite.upsert({
      where: { ticketId_userId: { ticketId: id, userId: user.id } },
      create: { ticketId: id, userId: user.id },
      update: {},
    });
    return { favorited: true };
  }

  async unfavorite(user: AuthUser, id: string) {
    await this.access.findAccessible(id, user);
    await this.prisma.ticketFavorite.deleteMany({ where: { ticketId: id, userId: user.id } });
    return { favorited: false };
  }

  /** 清洗富文本描述并校验纯文本长度（10~5000 字） */
  private cleanDescription(input: string) {
    const rich = normalizeRichText(input);
    if (rich.text.length < 10) throw new BadRequestException('描述至少 10 个字');
    if (rich.text.length > 5000) throw new BadRequestException('描述最多 5000 个字');
    return rich;
  }

  /** 清洗富文本评论并校验纯文本长度（1~5000 字） */
  private cleanComment(input: string) {
    const rich = normalizeRichText(input);
    if (rich.text.length < 1) throw new BadRequestException('请输入内容');
    if (rich.text.length > 5000) throw new BadRequestException('内容不超过 5000 字');
    return rich;
  }

  async create(user: AuthUser, body: any) {
    const isOpsUser = ['AGENT', 'OPS_LEAD', 'ADMIN'].includes(user.role);
    let ticketType: 'CUSTOMER' | 'INTERNAL' = 'CUSTOMER';
    let enterpriseId: string | null = user.enterpriseId ?? null;
    let onBehalf = false;

    if (!isOpsUser) {
      if (!enterpriseId) throw new ForbiddenException('当前账号未关联客户企业');
      if (body.ticketType === 'INTERNAL') throw new ForbiddenException('客户账号不能提交内部工单');
    } else if (body.ticketType === 'INTERNAL') {
      ticketType = 'INTERNAL';
      enterpriseId = null;
    } else {
      if (!body.enterpriseId) throw new BadRequestException('请选择代提报的客户企业');
      const enterprise = await this.prisma.enterprise.findFirst({
        where: { id: body.enterpriseId, status: 'ACTIVE' },
      });
      if (!enterprise) throw new BadRequestException('客户企业不存在或已停用');
      enterpriseId = enterprise.id;
      onBehalf = true;
    }

    const category = await this.prisma.category.findFirst({
      where: { id: body.categoryId, status: 'ACTIVE' },
      include: { defaultGroup: true },
    });
    if (!category) throw new BadRequestException('分类不存在或已停用');
    if (category.defaultGroup.status !== 'ACTIVE') throw new BadRequestException('该分类的默认处理组已停用');
    const ticketNo = await this.nextTicketNo();
    const description = this.cleanDescription(body.description);
    const ticket = await this.prisma.$transaction(async (tx) => {
      const created = await tx.ticket.create({
        data: {
          ticketNo,
          ticketType,
          enterpriseId,
          onBehalf,
          reporterId: user.id,
          title: body.title,
          description: description.html,
          categoryId: category.id,
          priority: body.priority,
          groupId: category.defaultGroupId,
          status: 'PENDING',
        },
        include: TICKET_INCLUDE,
      });
      await tx.ticketEvent.create({
        data: {
          ticketId: created.id,
          actorId: user.id,
          actorName: user.name,
          action: 'CREATE',
          toValue: 'PENDING',
          visibility: 'PUBLIC',
          reason: ticketType === 'INTERNAL' ? '提交内部工单' : onBehalf ? '代客户提交工单' : undefined,
        },
      });
      return created;
    });

    const groupRecipients = await this.groupRecipients(ticket.groupId);
    const recipients = [this.reporterRecipient(ticket), ...groupRecipients];
    if (onBehalf && enterpriseId) {
      recipients.push(...(await this.enterpriseRecipients(enterpriseId)));
    }
    const bodyText =
      ticketType === 'INTERNAL'
        ? `${ticket.reporter.name} 提交了内部工单「${ticket.title}」`
        : onBehalf
          ? `${ticket.reporter.name} 代客户提交了工单「${ticket.title}」`
          : `${ticket.reporter.name} 提交了工单「${ticket.title}」`;
    await this.notifications.notify({
      type: 'TICKET_CREATED',
      title: `新工单 ${ticket.ticketNo}`,
      body: bodyText,
      ticketId: ticket.id,
      recipients,
      email:
        ticketType === 'CUSTOMER'
          ? {
              template: 'ticketCreated',
              data: {
                ticketNo: ticket.ticketNo,
                title: ticket.title,
                groupName: ticket.group.name,
                link: this.link(ticket.id),
              },
            }
          : undefined,
    });
    return this.get(user, ticket.id);
  }

  async update(user: AuthUser, id: string, body: any) {
    const ticket = await this.access.findAccessible(id, user);
    if (ticket.reporterId !== user.id) {
      throw new ForbiddenException('只有提报人可以编辑工单内容');
    }
    if (ticket.status !== 'PENDING') {
      throw new ConflictException('只有待受理工单可以编辑');
    }
    const data: any = {};
    for (const key of ['title', 'description', 'priority']) {
      if (body[key] !== undefined) data[key] = body[key];
    }
    if (data.description !== undefined) {
      data.description = this.cleanDescription(data.description).html;
    }
    let groupId = ticket.groupId;
    if (body.categoryId && body.categoryId !== ticket.categoryId) {
      const category = await this.prisma.category.findFirst({
        where: { id: body.categoryId, status: 'ACTIVE' },
        include: { defaultGroup: true },
      });
      if (!category) throw new BadRequestException('分类不存在或已停用');
      data.categoryId = category.id;
      data.groupId = category.defaultGroupId;
      groupId = category.defaultGroupId;
    }
    if (Object.keys(data).length === 0) return this.get(user, id);
    await this.prisma.$transaction([
      this.prisma.ticket.update({
        where: { id },
        data: { ...data, version: { increment: 1 }, lastActivityAt: new Date() },
      }),
      this.prisma.ticketEvent.create({
        data: {
          ticketId: id,
          actorId: user.id,
          actorName: user.name,
          action: 'EDIT',
          visibility: 'PUBLIC',
          reason: '提报人修改了工单内容',
        },
      }),
    ]);
    return this.get(user, id);
  }

  async claim(user: AuthUser, id: string) {
    const ticket = await this.access.findAccessible(id, user);
    if (!['AGENT', 'OPS_LEAD', 'ADMIN'].includes(user.role)) {
      throw new ForbiddenException('只有运维侧账号可以领取工单');
    }
    this.assertTransition(ticket.status, 'CLAIM', user.role);
    // 跨组领取：不再要求属于原处理组，但要在时间线留痕便于追溯
    const crossGroup = !this.access.isInGroup(user, ticket.groupId);
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.ticket.updateMany({
        where: { id, status: 'PENDING', version: ticket.version, assigneeId: null },
        data: {
          status: 'PROCESSING',
          assigneeId: user.id,
          version: { increment: 1 },
          lastActivityAt: new Date(),
        },
      });
      if (updated.count === 0) throw new ConflictException('工单已被处理，请刷新后重试');
      await tx.ticketEvent.create({
        data: {
          ticketId: id,
          actorId: user.id,
          actorName: user.name,
          action: crossGroup ? 'CLAIM_CROSS' : 'CLAIM',
          fromValue: 'PENDING',
          toValue: 'PROCESSING',
          reason: crossGroup ? `跨组领取，原处理组：${ticket.group?.name ?? '未分组'}` : null,
          visibility: 'PUBLIC',
        },
      });
    });
    await this.notifications.notify({
      type: 'TICKET_ASSIGNED',
      title: `工单已受理 ${ticket.ticketNo}`,
      body: `处理人 ${user.name} 已受理您的工单`,
      ticketId: id,
      recipients: [this.reporterRecipient(ticket)],
      email: {
        template: 'ticketAssigned',
        data: {
          ticketNo: ticket.ticketNo,
          title: ticket.title,
          assigneeName: user.name,
          link: this.link(id),
        },
      },
    });
    return this.get(user, id);
  }

  private async resolveAssignTarget(groupId: string, assigneeId?: string | null) {
    const group = await this.prisma.opsGroup.findUnique({ where: { id: groupId } });
    if (!group || group.status !== 'ACTIVE') throw new BadRequestException('目标处理组不存在或已停用');
    let assignee: any = null;
    if (assigneeId) {
      assignee = await this.prisma.user.findUnique({ where: { id: assigneeId } });
      if (!assignee || assignee.status !== 'ACTIVE' || !['AGENT', 'OPS_LEAD'].includes(assignee.role)) {
        throw new BadRequestException('目标处理人不可用');
      }
    }
    return { group, assignee };
  }

  async assign(user: AuthUser, id: string, body: any) {
    const ticket = await this.access.findAccessible(id, user);
    if (!['OPS_LEAD', 'ADMIN'].includes(user.role)) throw new ForbiddenException('仅主管或管理员可改派');
    this.assertTransition(ticket.status, 'ASSIGN', user.role);
    const { assignee } = await this.resolveAssignTarget(body.groupId, body.assigneeId);
    const nextStatus = assignee ? 'PROCESSING' : 'PENDING';
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.ticket.updateMany({
        where: { id, version: ticket.version },
        data: {
          groupId: body.groupId,
          assigneeId: assignee?.id ?? null,
          status: nextStatus,
          version: { increment: 1 },
          lastActivityAt: new Date(),
        },
      });
      if (updated.count === 0) throw new ConflictException('工单已被处理，请刷新后重试');
      await tx.ticketEvent.create({
        data: {
          ticketId: id,
          actorId: user.id,
          actorName: user.name,
          action: 'ASSIGN',
          fromValue: ticket.groupId,
          toValue: body.groupId,
          reason: body.reason ?? null,
          visibility: 'INTERNAL',
        },
      });
    });
    const recipients: any[] = [];
    if (assignee) {
      recipients.push({ userId: assignee.id, email: assignee.email, name: assignee.name, inApp: true });
    }
    if (!assignee) recipients.push(...(await this.groupRecipients(body.groupId)));
    if (assignee) {
      await this.notifications.notify({
        type: 'TICKET_ASSIGNED',
        title: `工单已指派 ${ticket.ticketNo}`,
        body: `${user.name} 将工单「${ticket.title}」指派给您`,
        ticketId: id,
        recipients,
      });
      await this.notifications.notify({
        type: 'TICKET_ASSIGNED',
        title: `工单已受理 ${ticket.ticketNo}`,
        body: `您的工单已由 ${assignee.name} 受理`,
        ticketId: id,
        recipients: [this.reporterRecipient(ticket)],
        email: {
          template: 'ticketAssigned',
          data: {
            ticketNo: ticket.ticketNo,
            title: ticket.title,
            assigneeName: assignee.name,
            link: this.link(id),
          },
        },
      });
    } else {
      await this.notifications.notify({
        type: 'TICKET_ASSIGNED',
        title: `工单已改派 ${ticket.ticketNo}`,
        body: `工单「${ticket.title}」已改派到您的处理组`,
        ticketId: id,
        recipients,
      });
    }
    return this.get(user, id);
  }

  async transfer(user: AuthUser, id: string, body: any) {
    const ticket = await this.access.findAccessible(id, user);
    this.assertTransition(ticket.status, 'TRANSFER', user.role);
    if (user.role === 'AGENT' && ticket.assigneeId !== user.id) {
      throw new ForbiddenException('只能转派自己处理的工单');
    }
    const { assignee } = await this.resolveAssignTarget(body.groupId, body.assigneeId);
    const nextStatus = assignee ? 'PROCESSING' : 'PENDING';
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.ticket.updateMany({
        where: { id, version: ticket.version, status: 'PROCESSING' },
        data: {
          groupId: body.groupId,
          assigneeId: assignee?.id ?? null,
          status: nextStatus,
          version: { increment: 1 },
          lastActivityAt: new Date(),
        },
      });
      if (updated.count === 0) throw new ConflictException('工单已被处理，请刷新后重试');
      await tx.ticketEvent.create({
        data: {
          ticketId: id,
          actorId: user.id,
          actorName: user.name,
          action: 'TRANSFER',
          fromValue: ticket.groupId,
          toValue: body.groupId,
          reason: body.reason,
          visibility: 'INTERNAL',
        },
      });
    });
    const recipients = assignee
      ? [{ userId: assignee.id, email: assignee.email, name: assignee.name, inApp: true }]
      : await this.groupRecipients(body.groupId);
    await this.notifications.notify({
      type: 'TICKET_ASSIGNED',
      title: `工单转入 ${ticket.ticketNo}`,
      body: `${user.name} 转派了工单「${ticket.title}」：${body.reason}`,
      ticketId: id,
      recipients,
    });
    return this.get(user, id);
  }

  async release(user: AuthUser, id: string) {
    const ticket = await this.access.findAccessible(id, user);
    if (!['OPS_LEAD', 'ADMIN'].includes(user.role)) throw new ForbiddenException('仅主管或管理员可撤回认领');
    this.assertTransition(ticket.status, 'RELEASE', user.role);
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.ticket.updateMany({
        where: { id, version: ticket.version },
        data: {
          status: 'PENDING',
          assigneeId: null,
          version: { increment: 1 },
          lastActivityAt: new Date(),
        },
      });
      if (updated.count === 0) throw new ConflictException('工单已被处理，请刷新后重试');
      await tx.ticketEvent.create({
        data: {
          ticketId: id,
          actorId: user.id,
          actorName: user.name,
          action: 'RELEASE',
          fromValue: ticket.assigneeId,
          toValue: null,
          visibility: 'INTERNAL',
        },
      });
    });
    return this.get(user, id);
  }

  async resolve(user: AuthUser, id: string, body: any) {
    const ticket = await this.access.findAccessible(id, user);
    this.assertTransition(ticket.status, 'RESOLVE', user.role);
    if (user.role === 'AGENT' && ticket.assigneeId !== user.id) {
      throw new ForbiddenException('只能提交自己处理的工单结果');
    }
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.ticket.updateMany({
        where: { id, version: ticket.version, status: 'PROCESSING' },
        data: {
          status: 'PENDING_CONFIRM',
          resolution: body.resolution,
          resolvedAt: new Date(),
          version: { increment: 1 },
          lastActivityAt: new Date(),
        },
      });
      if (updated.count === 0) throw new ConflictException('工单状态已变更，请刷新后重试');
      await tx.ticketEvent.create({
        data: {
          ticketId: id,
          actorId: user.id,
          actorName: user.name,
          action: 'RESOLVE',
          fromValue: 'PROCESSING',
          toValue: 'PENDING_CONFIRM',
          reason: body.resolution,
          visibility: 'PUBLIC',
        },
      });
    });
    await this.notifications.notify({
      type: 'TICKET_PENDING_CONFIRM',
      title: `工单待确认 ${ticket.ticketNo}`,
      body: `工单「${ticket.title}」的处理结果已提交，请确认`,
      ticketId: id,
      recipients: [this.reporterRecipient(ticket)],
      email: {
        template: 'ticketPendingConfirm',
        data: {
          ticketNo: ticket.ticketNo,
          title: ticket.title,
          resolution: body.resolution,
          link: this.link(id),
        },
      },
    });
    return this.get(user, id);
  }

  /** 客户工单的确认/反馈/重开只能由客户提报人执行；内部工单由提报人本人执行（不限角色） */
  private assertReporterAction(user: AuthUser, ticket: any, action: 'CONFIRM' | 'REJECT' | 'REOPEN') {
    if (ticket.ticketType === 'INTERNAL') {
      if (ticket.reporterId !== user.id) throw new ForbiddenException('只有提报人本人可以执行该操作');
      return;
    }
    if (user.role !== 'REPORTER') throw new ForbiddenException('只有客户账号可以执行该操作');
    // 代客户提单没有客户提报人，由该企业客户账号确认
    if (ticket.onBehalf) {
      if (user.enterpriseId !== ticket.enterpriseId) throw new ForbiddenException('只有该企业客户可以执行该操作');
      return;
    }
    if (ticket.reporterId !== user.id) throw new ForbiddenException('只有客户提报人本人可以执行该操作');
  }

  /** 处理人在待确认阶段直接关闭（客户未确认但问题已解决） */
  async close(user: AuthUser, id: string, body: any) {
    const ticket = await this.access.findAccessible(id, user);
    this.assertTransition(ticket.status, 'CLOSE', user.role);
    if (user.role === 'AGENT' && ticket.assigneeId !== user.id) {
      throw new ForbiddenException('只有当前处理人可以关闭工单');
    }
    const reason = body.reason ?? null;
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.ticket.updateMany({
        where: { id, version: ticket.version, status: 'PENDING_CONFIRM' },
        data: {
          status: 'CLOSED',
          closedAt: new Date(),
          closedById: user.id,
          closeReason: reason,
          closeSource: 'ASSIGNEE_CLOSED',
          version: { increment: 1 },
          lastActivityAt: new Date(),
        },
      });
      if (updated.count === 0) throw new ConflictException('工单状态已变更，请刷新后重试');
      await tx.ticketEvent.create({
        data: {
          ticketId: id,
          actorId: user.id,
          actorName: user.name,
          action: 'CLOSE',
          fromValue: 'PENDING_CONFIRM',
          toValue: 'CLOSED',
          reason,
          visibility: 'PUBLIC',
        },
      });
    });
    await this.notifications.notify({
      type: 'TICKET_CLOSED',
      title: `工单已关闭 ${ticket.ticketNo}`,
      body: `处理人 ${user.name} 关闭了工单「${ticket.title}」${reason ? `：${reason}` : ''}`,
      ticketId: id,
      recipients: [this.reporterRecipient(ticket)],
      email:
        ticket.ticketType === 'CUSTOMER'
          ? {
              template: 'ticketClosed',
              data: {
                ticketNo: ticket.ticketNo,
                title: ticket.title,
                reason: reason || '处理人确认问题已解决',
                link: this.link(id),
              },
            }
          : undefined,
    });
    return this.get(user, id);
  }

  async confirm(user: AuthUser, id: string) {
    const ticket = await this.access.findAccessible(id, user);
    this.assertReporterAction(user, ticket, 'CONFIRM');
    this.assertStatus(ticket.status, 'CONFIRM');
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.ticket.updateMany({
        where: { id, version: ticket.version, status: 'PENDING_CONFIRM' },
        data: {
          status: 'CLOSED',
          confirmedAt: new Date(),
          closedAt: new Date(),
          closedById: user.id,
          closeSource: 'REPORTER_CONFIRMED',
          version: { increment: 1 },
          lastActivityAt: new Date(),
        },
      });
      if (updated.count === 0) throw new ConflictException('工单状态已变更，请刷新后重试');
      await tx.ticketEvent.create({
        data: {
          ticketId: id,
          actorId: user.id,
          actorName: user.name,
          action: 'CONFIRM',
          fromValue: 'PENDING_CONFIRM',
          toValue: 'CLOSED',
          visibility: 'PUBLIC',
        },
      });
    });
    if (ticket.assigneeId) {
      await this.notifications.notify({
        type: 'TICKET_CLOSED',
        title: `工单已关闭 ${ticket.ticketNo}`,
        body: `提报人已确认工单「${ticket.title}」解决`,
        ticketId: id,
        recipients: [{ userId: ticket.assigneeId, email: ticket.assignee?.email, name: ticket.assignee?.name ?? '', inApp: true }],
      });
    }
    return this.get(user, id);
  }

  async reject(user: AuthUser, id: string, body: any) {
    const ticket = await this.access.findAccessible(id, user);
    this.assertReporterAction(user, ticket, 'REJECT');
    this.assertStatus(ticket.status, 'REJECT');
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.ticket.updateMany({
        where: { id, version: ticket.version, status: 'PENDING_CONFIRM' },
        data: { status: 'PROCESSING', version: { increment: 1 }, lastActivityAt: new Date() },
      });
      if (updated.count === 0) throw new ConflictException('工单状态已变更，请刷新后重试');
      await tx.ticketEvent.create({
        data: {
          ticketId: id,
          actorId: user.id,
          actorName: user.name,
          action: 'REJECT',
          fromValue: 'PENDING_CONFIRM',
          toValue: 'PROCESSING',
          reason: body.reason,
          visibility: 'PUBLIC',
        },
      });
    });
    const recipients = ticket.assigneeId
      ? [{ userId: ticket.assigneeId, email: ticket.assignee?.email, name: ticket.assignee?.name ?? '', inApp: true, emailEnabled: true }]
      : await this.groupRecipients(ticket.groupId, true);
    await this.notifications.notify({
      type: 'TICKET_COMMENT',
      title: `工单被反馈未解决 ${ticket.ticketNo}`,
      body: `${user.name} 反馈问题未解决：${body.reason}`,
      ticketId: id,
      recipients,
      email: {
        template: 'ticketComment',
        data: {
          ticketNo: ticket.ticketNo,
          title: ticket.title,
          actorName: user.name,
          content: body.reason,
          link: this.link(id),
        },
      },
    });
    return this.get(user, id);
  }

  async forceClose(user: AuthUser, id: string, body: any) {
    const ticket = await this.access.findAccessible(id, user);
    if (!['OPS_LEAD', 'ADMIN'].includes(user.role)) throw new ForbiddenException('仅主管或管理员可强制关闭');
    this.assertTransition(ticket.status, 'FORCE_CLOSE', user.role);
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.ticket.updateMany({
        where: { id, version: ticket.version },
        data: {
          status: 'CLOSED',
          closedAt: new Date(),
          closedById: user.id,
          closeReason: body.reason,
          closeSource: 'ADMIN_FORCE_CLOSED',
          version: { increment: 1 },
          lastActivityAt: new Date(),
        },
      });
      if (updated.count === 0) throw new ConflictException('工单状态已变更，请刷新后重试');
      await tx.ticketEvent.create({
        data: {
          ticketId: id,
          actorId: user.id,
          actorName: user.name,
          action: 'FORCE_CLOSE',
          fromValue: ticket.status,
          toValue: 'CLOSED',
          reason: body.reason,
          visibility: 'PUBLIC',
        },
      });
    });
    await this.notifications.notify({
      type: 'TICKET_CLOSED',
      title: `工单已关闭 ${ticket.ticketNo}`,
      body: `工单「${ticket.title}」已被运维团队关闭：${body.reason}`,
      ticketId: id,
      recipients: [this.reporterRecipient(ticket)],
      email:
        ticket.ticketType === 'CUSTOMER'
          ? {
              template: 'ticketClosed',
              data: {
                ticketNo: ticket.ticketNo,
                title: ticket.title,
                reason: body.reason,
                link: this.link(id),
              },
            }
          : undefined,
    });
    return this.get(user, id);
  }

  async reopen(user: AuthUser, id: string) {
    const ticket = await this.access.findAccessible(id, user);
    this.assertReporterAction(user, ticket, 'REOPEN');
    this.assertStatus(ticket.status, 'REOPEN');
    const windowDays = await this.settings.getNumber('reopenWindowDays');
    if (!ticket.closedAt || Date.now() - ticket.closedAt.getTime() > windowDays * 86400_000) {
      throw new ConflictException(`工单关闭超过 ${windowDays} 天，无法重开，请新建工单`);
    }
    let assignee: any = null;
    if (ticket.assigneeId) {
      assignee = await this.prisma.user.findUnique({ where: { id: ticket.assigneeId } });
      if (assignee && assignee.status !== 'ACTIVE') assignee = null;
    }
    const nextStatus = assignee ? 'PROCESSING' : 'PENDING';
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.ticket.updateMany({
        where: { id, version: ticket.version, status: 'CLOSED' },
        data: {
          status: nextStatus,
          assigneeId: assignee?.id ?? null,
          closedAt: null,
          closedById: null,
          closeSource: null,
          confirmedAt: null,
          reopenCount: { increment: 1 },
          version: { increment: 1 },
          lastActivityAt: new Date(),
        },
      });
      if (updated.count === 0) throw new ConflictException('工单状态已变更，请刷新后重试');
      await tx.ticketEvent.create({
        data: {
          ticketId: id,
          actorId: user.id,
          actorName: user.name,
          action: 'REOPEN',
          fromValue: 'CLOSED',
          toValue: nextStatus,
          visibility: 'PUBLIC',
        },
      });
    });
    const recipients = assignee
      ? [{ userId: assignee.id, email: assignee.email, name: assignee.name, inApp: true }]
      : await this.groupRecipients(ticket.groupId);
    await this.notifications.notify({
      type: 'TICKET_REOPENED',
      title: `工单已重开 ${ticket.ticketNo}`,
      body: `工单「${ticket.title}」已被提报人重开，请继续跟进`,
      ticketId: id,
      recipients,
    });
    return this.get(user, id);
  }

  async cancel(user: AuthUser, id: string, body: any) {
    const ticket = await this.access.findAccessible(id, user);
    if (ticket.reporterId !== user.id) {
      throw new ForbiddenException('只有提报人本人可以撤回工单');
    }
    this.assertStatus(ticket.status, 'CANCEL');
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.ticket.updateMany({
        where: { id, version: ticket.version, status: 'PENDING' },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelReason: body.reason ?? null,
          assigneeId: null,
          version: { increment: 1 },
          lastActivityAt: new Date(),
        },
      });
      if (updated.count === 0) throw new ConflictException('工单已被受理，无法撤回');
      await tx.ticketEvent.create({
        data: {
          ticketId: id,
          actorId: user.id,
          actorName: user.name,
          action: 'CANCEL',
          fromValue: 'PENDING',
          toValue: 'CANCELLED',
          reason: body.reason ?? null,
          visibility: 'PUBLIC',
        },
      });
    });
    await this.notifications.notify({
      type: 'TICKET_CANCELLED',
      title: `工单已撤回 ${ticket.ticketNo}`,
      body: `提报人撤回了工单「${ticket.title}」`,
      ticketId: id,
      recipients: await this.groupRecipients(ticket.groupId),
    });
    return this.get(user, id);
  }

  async updateWorkHours(user: AuthUser, id: string, workHours: number | null) {
    const ticket = await this.access.findAccessible(id, user);
    if (!canEditWorkHours(user.role, ticket.status as TicketStatus)) {
      if (!WORK_HOURS_ROLES.includes(user.role)) {
        throw new ForbiddenException('没有填写处理工时的权限');
      }
      throw new ConflictException({
        code: 'TICKET_WORK_HOURS_NOT_EDITABLE',
        message: '仅处理中及之后的状态可以填写处理工时',
      });
    }
    if (user.role === 'AGENT' && ticket.assigneeId !== user.id) {
      throw new ForbiddenException('只能填写自己处理工单的工时');
    }
    const next = workHours === null ? null : Math.round(workHours * 10) / 10;
    const before = ticket.workHours ?? null;
    if (before === next) return this.get(user, id);
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.ticket.updateMany({
        where: { id, version: ticket.version },
        data: { workHours: next, version: { increment: 1 }, lastActivityAt: new Date() },
      });
      if (updated.count === 0) throw new ConflictException('工单已被更新，请刷新后重试');
      await tx.ticketEvent.create({
        data: {
          ticketId: id,
          actorId: user.id,
          actorName: user.name,
          action: 'WORK_HOURS',
          fromValue: before === null ? null : String(before),
          toValue: next === null ? null : String(next),
          visibility: 'PUBLIC',
        },
      });
    });
    await this.audit.log(user.id, 'TICKET_WORK_HOURS', 'Ticket', id, { from: before, to: next });
    return this.get(user, id);
  }

  async createComment(user: AuthUser, id: string, body: any) {
    const ticket = await this.access.findAccessible(id, user);
    let visibility = body.visibility === 'INTERNAL' ? 'INTERNAL' : 'PUBLIC';
    if (visibility === 'INTERNAL' && user.role === 'REPORTER') {
      throw new ForbiddenException('客户不能添加内部备注');
    }
    const attachmentIds: string[] = body.attachmentIds ?? [];
    const content = this.cleanComment(body.content);
    if (attachmentIds.length > 0) {
      const owned = await this.prisma.ticketAttachment.count({
        where: { id: { in: attachmentIds }, ticketId: id, commentId: null },
      });
      if (owned !== attachmentIds.length) throw new BadRequestException('附件不属于该工单或已被使用');
    }
    const comment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.ticketComment.create({
        data: {
          ticketId: id,
          authorId: user.id,
          authorName: user.name,
          authorRole: user.role,
          visibility,
          content: content.html,
        },
      });
      if (attachmentIds.length > 0) {
        await tx.ticketAttachment.updateMany({
          where: { id: { in: attachmentIds }, ticketId: id },
          data: { commentId: created.id },
        });
      }
      await tx.ticket.update({ where: { id }, data: { lastActivityAt: new Date() } });
      return tx.ticketComment.findUnique({ where: { id: created.id }, include: { attachments: true } });
    });

    if (visibility === 'INTERNAL') {
      const recipients: any[] = [];
      if (ticket.assigneeId) {
        recipients.push({
          userId: ticket.assigneeId,
          email: ticket.assignee?.email,
          name: ticket.assignee?.name ?? '',
          inApp: true,
        });
      } else {
        recipients.push(...(await this.groupRecipients(ticket.groupId)));
      }
      await this.notifications.notify({
        type: 'TICKET_COMMENT',
        title: `工单有内部备注 ${ticket.ticketNo}`,
        body: `${user.name} 添加了内部备注`,
        ticketId: id,
        recipients,
      });
    } else if (user.role === 'REPORTER') {
      const recipients = ticket.assigneeId
        ? [
            {
              userId: ticket.assigneeId,
              email: ticket.assignee?.email,
              name: ticket.assignee?.name ?? '',
              inApp: true,
              emailEnabled: true,
            },
          ]
        : await this.groupRecipients(ticket.groupId);
      await this.notifications.notify({
        type: 'TICKET_COMMENT',
        title: `工单有新回复 ${ticket.ticketNo}`,
        body: `${user.name}：${content.text.slice(0, 100)}`,
        ticketId: id,
        recipients,
        email: {
          template: 'ticketComment',
          data: {
            ticketNo: ticket.ticketNo,
            title: ticket.title,
            actorName: user.name,
            content: content.text,
            link: this.link(id),
          },
        },
      });
    } else {
      await this.notifications.notify({
        type: 'TICKET_COMMENT',
        title: `工单有新回复 ${ticket.ticketNo}`,
        body: `运维团队回复了您的工单`,
        ticketId: id,
        recipients: [this.reporterRecipient(ticket)],
        email: {
          template: 'ticketComment',
          data: {
            ticketNo: ticket.ticketNo,
            title: ticket.title,
            actorName: user.name,
            content: content.text,
            link: this.link(id),
          },
        },
      });
    }
    return commentView(comment);
  }

  async deleteComment(user: AuthUser, commentId: string) {
    const comment = await this.prisma.ticketComment.findUnique({ where: { id: commentId } });
    if (!comment) throw new NotFoundException('评论不存在');
    await this.access.findAccessible(comment.ticketId, user);
    if (comment.authorId !== user.id) throw new ForbiddenException('只能撤回自己的评论');
    if (Date.now() - comment.createdAt.getTime() > 10 * 60_000) {
      throw new ConflictException('超过 10 分钟，无法撤回');
    }
    await this.prisma.ticketComment.update({ where: { id: commentId }, data: { deletedAt: new Date() } });
    return { ok: true };
  }

  uploadAttachment(user: AuthUser, id: string, file?: Express.Multer.File) {
    return this.attachments.upload(user, id, file);
  }

  downloadAttachment(user: AuthUser, id: string, res: Response) {
    return this.attachments.download(user, id, res);
  }

  async statsSummary(user: AuthUser) {
    const tickets = await this.prisma.ticket.findMany({
      where: ticketScope(user),
      select: { status: true },
    });
    const counts: Record<string, number> = {};
    for (const t of tickets) counts[t.status] = (counts[t.status] || 0) + 1;
    return Object.fromEntries(
      Object.entries(STATUS_LABELS).map(([key, label]) => [key, { label, count: counts[key] || 0 }]),
    );
  }
}
