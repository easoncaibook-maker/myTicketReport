import { Injectable, NotFoundException } from '@nestjs/common';
import { AuthUser } from '../common/decorators';
import { ticketScope } from '../common/scope';
import { PrismaService } from '../prisma/prisma.service';

export const TICKET_INCLUDE = {
  enterprise: { select: { id: true, name: true, code: true } },
  reporter: { select: { id: true, name: true, email: true, enterpriseId: true, role: true } },
  assignee: { select: { id: true, name: true, email: true, status: true } },
  category: { select: { id: true, name: true, defaultGroupId: true } },
  group: { select: { id: true, name: true } },
} as const;

@Injectable()
export class TicketAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** 读取范围内的工单；越权一律 404，避免探测 */
  async findAccessible(id: string, user: AuthUser) {
    const ticket = await this.prisma.ticket.findFirst({
      where: { AND: [{ id }, ticketScope(user)] },
      include: TICKET_INCLUDE,
    });
    if (!ticket) throw new NotFoundException('工单不存在');
    return ticket;
  }

  isInGroup(user: AuthUser, groupId: string) {
    return user.groupIds.includes(groupId);
  }
}
