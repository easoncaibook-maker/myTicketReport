import { Controller, Get, Query } from '@nestjs/common';
import { PRIORITIES, PRIORITY_LABELS, STATUS_LABELS, TICKET_STATUSES } from '@ticketreport/shared';
import { AuthUser, CurrentUser } from '../common/decorators';
import { ticketScope } from '../common/scope';
import { PrismaService } from '../prisma/prisma.service';

@Controller('reports')
export class ReportsController {
  constructor(private readonly prisma: PrismaService) {}

  private buildWhere(user: AuthUser, query: any) {
    const filters: any[] = [ticketScope(user)];
    if (query.enterpriseId && user.role !== 'REPORTER') filters.push({ enterpriseId: query.enterpriseId });
    if (query.from || query.to) {
      const range: any = {};
      if (query.from) range.gte = new Date(query.from);
      if (query.to) range.lte = new Date(`${query.to}T23:59:59`);
      filters.push({ createdAt: range });
    }
    return { AND: filters };
  }

  @Get('overview')
  async overview(@CurrentUser() user: AuthUser, @Query() query: any) {
    const where = this.buildWhere(user, query);
    const [byStatus, byPriority, byCategory, tickets] = await Promise.all([
      this.prisma.ticket.groupBy({ by: ['status'], where, _count: { _all: true } }),
      this.prisma.ticket.groupBy({ by: ['priority'], where, _count: { _all: true } }),
      this.prisma.ticket.groupBy({ by: ['categoryId'], where, _count: { _all: true } }),
      this.prisma.ticket.findMany({
        where: { ...where, status: 'CLOSED', closedAt: { not: null } },
        select: { createdAt: true, closedAt: true },
      }),
    ]);
    const categories = await this.prisma.category.findMany({ select: { id: true, name: true } });
    const catMap = new Map(categories.map((c) => [c.id, c.name]));
    const statusCount = new Map(byStatus.map((s) => [s.status, s._count._all]));
    const total = [...statusCount.values()].reduce((a, b) => a + b, 0);
    const avgHours =
      tickets.length === 0
        ? 0
        : tickets.reduce((sum, t) => sum + ((t.closedAt as Date).getTime() - t.createdAt.getTime()) / 3600_000, 0) /
          tickets.length;

    return {
      total,
      byStatus: TICKET_STATUSES.map((status) => ({
        status,
        label: STATUS_LABELS[status],
        count: statusCount.get(status) ?? 0,
      })),
      byPriority: PRIORITIES.map((priority) => ({
        priority,
        label: PRIORITY_LABELS[priority],
        count: byPriority.find((p) => p.priority === priority)?._count._all ?? 0,
      })),
      byCategory: byCategory
        .map((c) => ({ name: catMap.get(c.categoryId) ?? '未分类', count: c._count._all }))
        .sort((a, b) => b.count - a.count),
      avgHandleHours: Number(avgHours.toFixed(1)),
    };
  }

  @Get('workload')
  async workload(@CurrentUser() user: AuthUser, @Query() query: any) {
    if (user.role === 'REPORTER') return { items: [] };
    const where = this.buildWhere(user, query);
    const since = new Date(Date.now() - 30 * 86400_000);
    const [processing, closed] = await Promise.all([
      this.prisma.ticket.groupBy({
        by: ['assigneeId'],
        where: { ...where, status: 'PROCESSING', assigneeId: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.ticket.groupBy({
        by: ['assigneeId'],
        where: { ...where, status: 'CLOSED', closedAt: { gte: since }, assigneeId: { not: null } },
        _count: { _all: true },
      }),
    ]);
    const ids = [...new Set([...processing, ...closed].map((x) => x.assigneeId as string))];
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    const names = new Map(users.map((u) => [u.id, u.name]));
    return {
      items: ids.map((id) => ({
        assigneeId: id,
        assigneeName: names.get(id) ?? id,
        processing: processing.find((p) => p.assigneeId === id)?._count._all ?? 0,
        closed30: closed.find((c) => c.assigneeId === id)?._count._all ?? 0,
      })),
    };
  }

  @Get('options')
  async options(@CurrentUser() user: AuthUser) {
    const [categories, groups] = await Promise.all([
      this.prisma.category.findMany({ where: { status: 'ACTIVE' }, select: { id: true, name: true } }),
      user.role === 'REPORTER'
        ? Promise.resolve([])
        : this.prisma.opsGroup.findMany({ where: { status: 'ACTIVE' }, select: { id: true, name: true } }),
    ]);
    return { categories, groups };
  }
}
