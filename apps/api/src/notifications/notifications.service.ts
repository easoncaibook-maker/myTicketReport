import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationDispatcher } from './notification.dispatcher';
import { NotificationEvent } from './notification.types';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatcher: NotificationDispatcher,
  ) {}

  async notify(event: NotificationEvent) {
    await this.dispatcher.dispatch(event);
  }

  async list(userId: string, query: { onlyUnread?: string; page?: string; pageSize?: string }) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(query.pageSize) || 20));
    const where: any = { userId };
    if (query.onlyUnread === 'true') where.readAt = null;
    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.notification.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async unreadCount(userId: string) {
    const count = await this.prisma.notification.count({ where: { userId, readAt: null } });
    return { count };
  }

  async markRead(id: string, userId: string) {
    const row = await this.prisma.notification.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundException('消息不存在');
    await this.prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
    return { ok: true };
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }
}
