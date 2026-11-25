import type { Prisma } from '@prisma/client';
import type { AuthUser } from './decorators';

export function isOps(user: AuthUser): boolean {
  return user.role === 'AGENT' || user.role === 'OPS_LEAD' || user.role === 'ADMIN';
}

export function isLead(user: AuthUser): boolean {
  return user.role === 'OPS_LEAD' || user.role === 'ADMIN';
}

/**
 * 工单数据范围：
 * - 提报人：本企业全部
 * - 处理人：当前所在组 + 自己被指派的 + 自己参与过的
 * - 主管/管理员：全部
 */
export function ticketScope(user: AuthUser): Prisma.TicketWhereInput {
  if (user.role === 'REPORTER') {
    return { enterpriseId: user.enterpriseId ?? '__none__' };
  }
  if (user.role === 'AGENT') {
    return {
      OR: [
        { groupId: { in: user.groupIds } },
        { assigneeId: user.id },
        { events: { some: { actorId: user.id } } },
        // 未认领的待受理工单对所有处理人可见，支持跨组领取兜底
        { status: 'PENDING', assigneeId: null },
      ],
    };
  }
  return {};
}
