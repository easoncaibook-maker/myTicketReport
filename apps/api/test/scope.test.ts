import { describe, expect, it } from 'vitest';
import { ticketScope } from '../src/common/scope';
import type { AuthUser } from '../src/common/decorators';

function user(partial: Partial<AuthUser>): AuthUser {
  return {
    id: 'u1',
    email: 'u1@example.com',
    name: 'U1',
    role: 'REPORTER',
    enterpriseId: 'ent-1',
    groupIds: [],
    ...partial,
  } as AuthUser;
}

describe('ticketScope', () => {
  it('提报人仅限本企业', () => {
    expect(ticketScope(user({ role: 'REPORTER', enterpriseId: 'ent-1' }))).toEqual({ enterpriseId: 'ent-1' });
  });

  it('提报人缺少企业时不应看到任何数据', () => {
    expect(ticketScope(user({ role: 'REPORTER', enterpriseId: null as any }))).toEqual({ enterpriseId: '__none__' });
  });

  it('处理人限定本组 / 本人指派 / 本人参与 / 未认领的待受理工单', () => {
    const scope: any = ticketScope(user({ role: 'AGENT', groupIds: ['g1', 'g2'] }));
    expect(scope.OR).toEqual([
      { groupId: { in: ['g1', 'g2'] } },
      { assigneeId: 'u1' },
      { events: { some: { actorId: 'u1' } } },
      { status: 'PENDING', assigneeId: null },
    ]);
  });

  it('主管与管理员不受限', () => {
    expect(ticketScope(user({ role: 'OPS_LEAD' }))).toEqual({});
    expect(ticketScope(user({ role: 'ADMIN', enterpriseId: null as any }))).toEqual({});
  });
});
