import { describe, expect, it } from 'vitest';
import { TICKET_TYPE_LABELS, TICKET_TYPES, TRANSITIONS, availableActions, findTransition, CLOSE_SOURCES, CLOSE_SOURCE_LABELS } from '@ticketreport/shared';

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

  it('内部工单待确认仅提报人本人可确认 / 驳回，运维侧可关闭', () => {
    const reporter = availableActions('PENDING_CONFIRM', 'AGENT', { isInternal: true, isReporter: true }).map((t) => t.action);
    const other = availableActions('PENDING_CONFIRM', 'AGENT', { isInternal: true, isReporter: false }).map((t) => t.action);
    expect(reporter.sort()).toEqual(['CLOSE', 'CONFIRM', 'REJECT']);
    expect(other).toEqual(['CLOSE']);
  });

  it('待确认阶段处理人可关闭，且关闭动作仅在该阶段可用', () => {
    for (const role of ['AGENT', 'OPS_LEAD', 'ADMIN'] as const) {
      expect(availableActions('PENDING_CONFIRM', role).map((t) => t.action)).toContain('CLOSE');
    }
    expect(availableActions('PROCESSING', 'AGENT').map((t) => t.action)).not.toContain('CLOSE');
  });

  it('领取不限处理组：运维主管与管理员同样可领取待受理工单', () => {
    for (const role of ['AGENT', 'OPS_LEAD', 'ADMIN'] as const) {
      expect(availableActions('PENDING', role).map((t) => t.action)).toContain('CLAIM');
    }
    expect(availableActions('PENDING', 'REPORTER').map((t) => t.action)).not.toContain('CLAIM');
  });

  it('关闭来源三种取值齐备且均有中文标签', () => {
    expect([...CLOSE_SOURCES].sort()).toEqual(['ADMIN_FORCE_CLOSED', 'ASSIGNEE_CLOSED', 'REPORTER_CONFIRMED']);
    expect(CLOSE_SOURCE_LABELS.REPORTER_CONFIRMED).toBe('提报人确认关闭');
    expect(CLOSE_SOURCE_LABELS.ASSIGNEE_CLOSED).toBe('处理人关闭');
    expect(CLOSE_SOURCE_LABELS.ADMIN_FORCE_CLOSED).toBe('管理员强制关闭');
  });

  it('代提工单由企业客户账号确认，代提人（非 REPORTER）不可确认', () => {
    const customer = availableActions('PENDING_CONFIRM', 'REPORTER', { isReporter: true }).map((t) => t.action);
    const onBehalfAgent = availableActions('PENDING_CONFIRM', 'AGENT', { isReporter: false }).map((t) => t.action);
    expect(customer.sort()).toEqual(['CONFIRM', 'REJECT']);
    expect(onBehalfAgent).not.toContain('CONFIRM');
  });

  it('工单类型常量包含客户工单与内部工单', () => {
    expect(TICKET_TYPES).toEqual(['CUSTOMER', 'INTERNAL']);
    expect(TICKET_TYPE_LABELS.INTERNAL).toBe('内部工单');
  });
});
