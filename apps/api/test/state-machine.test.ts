import { describe, expect, it } from 'vitest';
import { TRANSITIONS, availableActions, findTransition } from '@ticketreport/shared';

describe('工单状态机', () => {
  it('待受理：提报人可撤回，处理人可认领', () => {
    const reporterActions = availableActions('PENDING', 'REPORTER').map((t) => t.action);
    const agentActions = availableActions('PENDING', 'AGENT').map((t) => t.action);
    expect(reporterActions).toContain('CANCEL');
    expect(agentActions).toContain('CLAIM');
    expect(agentActions).not.toContain('CANCEL');
  });

  it('已取消为终态，无任何可用动作', () => {
    for (const role of ['REPORTER', 'AGENT', 'OPS_LEAD', 'ADMIN'] as const) {
      expect(availableActions('CANCELLED', role)).toHaveLength(0);
    }
  });

  it('待确认只有提报人可确认 / 反馈，主管可强制关闭', () => {
    expect(availableActions('PENDING_CONFIRM', 'REPORTER').map((t) => t.action).sort()).toEqual(['CONFIRM', 'REJECT']);
    expect(availableActions('PENDING_CONFIRM', 'OPS_LEAD').map((t) => t.action)).toContain('FORCE_CLOSE');
  });

  it('已关闭仅提报人可重开', () => {
    expect(availableActions('CLOSED', 'REPORTER').map((t) => t.action)).toEqual(['REOPEN']);
    expect(availableActions('CLOSED', 'ADMIN')).toHaveLength(0);
  });

  it('每个动作都有唯一的 action 标识', () => {
    const actions = TRANSITIONS.map((t) => t.action);
    expect(new Set(actions).size).toBe(actions.length);
    expect(findTransition('CANCEL')?.to).toBe('CANCELLED');
  });
});
