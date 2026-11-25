import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { ROLE_LABELS, Role } from '@ticketreport/shared';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../audit/audit.module';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';

function publicUser(user: any) {
  if (!user) return user;
  const { passwordHash, tokens, refreshTokens, groupMembers, ...rest } = user;
  return {
    ...rest,
    groupIds: (groupMembers ?? []).map((g: any) => g.groupId),
    roleLabel: ROLE_LABELS[user.role as Role] ?? user.role,
  };
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  private baseUrl() {
    return this.config.get('APP_BASE_URL') || 'http://localhost:5173';
  }

  private isDev() {
    return this.config.get('NODE_ENV') !== 'production';
  }

  // ---------- 客户企业 ----------

  async listEnterprises(keyword?: string) {
    return this.prisma.enterprise.findMany({
      where: keyword
        ? { OR: [{ name: { contains: keyword } }, { code: { contains: keyword } }] }
        : undefined,
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { users: true, tickets: true } } },
    });
  }

  async createEnterprise(actorId: string, body: any) {
    try {
      const enterprise = await this.prisma.enterprise.create({
        data: {
          name: body.name,
          code: body.code,
          contactName: body.contactName ?? null,
          contactPhone: body.contactPhone ?? null,
          remark: body.remark ?? null,
        },
      });
      await this.audit.log(actorId, 'ENTERPRISE_CREATE', 'Enterprise', enterprise.id, { name: enterprise.name });
      return enterprise;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('企业简码已存在');
      }
      throw e;
    }
  }

  async updateEnterprise(actorId: string, id: string, body: any) {
    const existing = await this.prisma.enterprise.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('企业不存在');
    const data: any = {};
    for (const key of ['name', 'contactName', 'contactPhone', 'remark', 'status']) {
      if (body[key] !== undefined) data[key] = body[key];
    }
    const enterprise = await this.prisma.enterprise.update({ where: { id }, data });
    if (body.status === 'DISABLED') {
      await this.prisma.user.updateMany({
        where: { enterpriseId: id, status: 'ACTIVE' },
        data: { status: 'DISABLED' },
      });
    }
    await this.audit.log(actorId, 'ENTERPRISE_UPDATE', 'Enterprise', id, data);
    return enterprise;
  }

  // ---------- 账号 ----------

  async listUsers(query: { enterpriseId?: string; role?: string; keyword?: string }) {
    const where: any = {};
    if (query.enterpriseId) where.enterpriseId = query.enterpriseId;
    if (query.role) where.role = query.role;
    if (query.keyword) {
      where.OR = [{ email: { contains: query.keyword } }, { name: { contains: query.keyword } }];
    }
    const users = await this.prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { enterprise: true, groupMembers: true },
    });
    return users.map(publicUser);
  }

  async inviteUser(actorId: string, body: any) {
    const email = String(body.email).trim().toLowerCase();
    const role = body.role as Role;
    if (!ROLE_LABELS[role]) throw new BadRequestException('角色不合法');
    if (role === 'REPORTER' && !body.enterpriseId) {
      throw new BadRequestException('客户员工必须指定所属企业');
    }
    if (role !== 'REPORTER' && body.enterpriseId) {
      throw new BadRequestException('运维账号不应绑定客户企业');
    }
    if (body.groupId) {
      const group = await this.prisma.opsGroup.findUnique({ where: { id: body.groupId } });
      if (!group || group.status !== 'ACTIVE') throw new BadRequestException('处理组不存在或已停用');
    }
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('该邮箱已存在账号');
    const enterprise = body.enterpriseId
      ? await this.prisma.enterprise.findUnique({ where: { id: body.enterpriseId } })
      : null;
    if (body.enterpriseId && !enterprise) throw new NotFoundException('企业不存在');

    const user = await this.prisma.user.create({
      data: {
        email,
        name: body.name,
        phone: body.phone ?? null,
        role,
        enterpriseId: role === 'REPORTER' ? body.enterpriseId : null,
        status: 'INVITED',
        invitedAt: new Date(),
      },
    });
    if (body.groupId && (role === 'AGENT' || role === 'OPS_LEAD')) {
      await this.prisma.groupMember.create({ data: { groupId: body.groupId, userId: user.id } });
    }
    const token = await this.auth.createAuthToken(user.id, 'INVITE', 72);
    const link = `${this.baseUrl()}/activate?token=${token}`;
    await this.mail.enqueue({
      toEmail: email,
      template: 'invite',
      data: { name: user.name, email, enterpriseName: enterprise?.name ?? '运维团队', link },
    });
    await this.audit.log(actorId, 'USER_INVITE', 'User', user.id, { email, role, enterpriseId: user.enterpriseId });
    return { ...publicUser(user), inviteLink: this.isDev() ? link : undefined };
  }

  async resendInvite(actorId: string, userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { enterprise: true } });
    if (!user) throw new NotFoundException('用户不存在');
    if (user.status !== 'INVITED') throw new BadRequestException('仅待激活账号可重发邀请');
    await this.prisma.authToken.updateMany({
      where: { userId, type: 'INVITE', usedAt: null },
      data: { usedAt: new Date() },
    });
    const token = await this.auth.createAuthToken(user.id, 'INVITE', 72);
    const link = `${this.baseUrl()}/activate?token=${token}`;
    await this.mail.enqueue({
      toEmail: user.email,
      template: 'invite',
      data: { name: user.name, email: user.email, enterpriseName: user.enterprise?.name ?? '运维团队', link },
    });
    await this.audit.log(actorId, 'USER_RESEND', 'User', user.id, {});
    return { ok: true, inviteLink: this.isDev() ? link : undefined };
  }

  async updateUser(actorId: string, userId: string, body: any) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('用户不存在');
    const data: any = {};
    for (const key of ['name', 'phone', 'status']) {
      if (body[key] !== undefined) data[key] = body[key];
    }
    if (data.status === 'DISABLED') {
      await this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data,
      include: { enterprise: true, groupMembers: true },
    });
    await this.audit.log(actorId, 'USER_UPDATE', 'User', userId, data);
    return publicUser(updated);
  }

  // ---------- 分类 ----------

  async listCategories(onlyActive = false) {
    return this.prisma.category.findMany({
      where: onlyActive ? { status: 'ACTIVE' } : undefined,
      orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
      include: { defaultGroup: { select: { id: true, name: true, status: true } } },
    });
  }

  async createCategory(actorId: string, body: any) {
    const group = await this.prisma.opsGroup.findUnique({ where: { id: body.defaultGroupId } });
    if (!group) throw new NotFoundException('默认处理组不存在');
    try {
      const category = await this.prisma.category.create({
        data: { name: body.name, defaultGroupId: body.defaultGroupId, sort: body.sort ?? 0 },
        include: { defaultGroup: true },
      });
      await this.audit.log(actorId, 'CATEGORY_CREATE', 'Category', category.id, { name: category.name });
      return category;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('分类名称已存在');
      }
      throw e;
    }
  }

  async updateCategory(actorId: string, id: string, body: any) {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('分类不存在');
    const data: any = {};
    for (const key of ['name', 'defaultGroupId', 'sort', 'status']) {
      if (body[key] !== undefined) data[key] = body[key];
    }
    const updated = await this.prisma.category.update({
      where: { id },
      data,
      include: { defaultGroup: true },
    });
    await this.audit.log(actorId, 'CATEGORY_UPDATE', 'Category', id, data);
    return updated;
  }

  // ---------- 处理组 ----------

  async listGroups(onlyActive = false) {
    return this.prisma.opsGroup.findMany({
      where: onlyActive ? { status: 'ACTIVE' } : undefined,
      orderBy: { createdAt: 'asc' },
      include: {
        members: { include: { user: { select: { id: true, name: true, email: true, role: true, status: true } } } },
        _count: { select: { tickets: true } },
      },
    });
  }

  async createGroup(actorId: string, body: any) {
    try {
      const group = await this.prisma.opsGroup.create({
        data: { name: body.name, description: body.description ?? null },
      });
      await this.audit.log(actorId, 'GROUP_CREATE', 'OpsGroup', group.id, { name: group.name });
      return group;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('处理组名称已存在');
      }
      throw e;
    }
  }

  async updateGroup(actorId: string, id: string, body: any) {
    const group = await this.prisma.opsGroup.findUnique({ where: { id } });
    if (!group) throw new NotFoundException('处理组不存在');
    const data: any = {};
    for (const key of ['name', 'description', 'status']) {
      if (body[key] !== undefined) data[key] = body[key];
    }
    const updated = await this.prisma.opsGroup.update({ where: { id }, data });
    await this.audit.log(actorId, 'GROUP_UPDATE', 'OpsGroup', id, data);
    return updated;
  }

  async setGroupMembers(actorId: string, groupId: string, body: { userIds: string[]; leadIds?: string[] }) {
    const group = await this.prisma.opsGroup.findUnique({ where: { id: groupId } });
    if (!group) throw new NotFoundException('处理组不存在');
    const userIds = [...new Set(body.userIds || [])];
    const leads = new Set(body.leadIds || []);
    if (userIds.length > 0) {
      const users = await this.prisma.user.findMany({ where: { id: { in: userIds } } });
      const invalid = users.filter((u) => u.role === 'REPORTER' || u.status === 'DISABLED');
      if (invalid.length > 0 || users.length !== userIds.length) {
        throw new BadRequestException('只能添加状态正常的运维账号');
      }
    }
    await this.prisma.$transaction([
      this.prisma.groupMember.deleteMany({ where: { groupId } }),
      this.prisma.groupMember.createMany({
        data: userIds.map((userId) => ({ groupId, userId, isLead: leads.has(userId) })),
      }),
    ]);
    await this.audit.log(actorId, 'GROUP_MEMBERS', 'OpsGroup', groupId, { userIds });
    return this.listGroups().then((groups) => groups.find((g) => g.id === groupId));
  }

  // ---------- 审计 ----------

  async listAudit(page = 1, pageSize = 20) {
    const take = Math.min(100, Math.max(1, pageSize));
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (Math.max(1, page) - 1) * take,
        take,
      }),
      this.prisma.auditLog.count(),
    ]);
    const actors = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(items.map((i) => i.actorId))] } },
      select: { id: true, name: true, email: true },
    });
    const map = new Map(actors.map((a) => [a.id, a]));
    return {
      items: items.map((i) => ({
        ...i,
        detail: i.detail ? JSON.parse(i.detail) : null,
        actorName: map.get(i.actorId)?.name ?? i.actorId,
      })),
      total,
      page,
      pageSize: take,
    };
  }

  // ---------- 元数据 ----------

  async listEnterprisesForFilter() {
    return this.prisma.enterprise.findMany({
      select: { id: true, name: true, code: true },
      orderBy: { name: 'asc' },
    });
  }

  async listAgents(groupId?: string) {
    return this.prisma.user.findMany({
      where: {
        role: { in: ['AGENT', 'OPS_LEAD'] },
        status: 'ACTIVE',
        ...(groupId ? { groupMembers: { some: { groupId } } } : {}),
      },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: 'asc' },
    });
  }
}
