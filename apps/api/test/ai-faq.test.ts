import { describe, expect, it } from 'vitest';
import { parseFaqText } from '../src/ai/faq-import';
import { rankFaq, scoreFaq, tokenize } from '../src/ai/faq-match';
import { canUseHit, faqScopeWhere } from '../src/ai/knowledge-scope';

const entries = [
  {
    id: 'a',
    question: '如何提交工单？',
    answer: '点击提交工单并填写描述',
    keywords: '提单,新建',
    enterpriseId: null,
  },
  {
    id: 'b',
    question: '忘记密码怎么办？',
    answer: '通过邮箱重置密码',
    keywords: '密码,重置',
    enterpriseId: null,
  },
];

describe('内置 FAQ 检索与权限', () => {
  it('中文按二元组、英文按词分词', () => {
    expect(tokenize('重置 password')).toEqual(expect.arrayContaining(['重置', 'password']));
  });

  it('问题命中权重高于答案，且过滤零分条目', () => {
    expect(scoreFaq('提交工单', entries[0])).toBeGreaterThan(scoreFaq('提交工单', entries[1]));
    expect(rankFaq('密码', entries, 5).map((item) => item.id)).toEqual(['b']);
    expect(rankFaq('完全无关的内容', entries, 5)).toEqual([]);
  });

  it('客户看不到内部知识与其他企业知识；运维也不能跨企业', () => {
    const customer = { userId: 'u1', role: 'REPORTER', enterpriseId: 'ent-a', isOps: false };
    const ops = { userId: 'u2', role: 'AGENT', enterpriseId: 'ent-a', isOps: true };
    expect(canUseHit({ visibility: 'PUBLIC', enterpriseId: null }, customer)).toBe(true);
    expect(canUseHit({ visibility: 'PUBLIC', enterpriseId: 'ent-a' }, customer)).toBe(true);
    expect(canUseHit({ visibility: 'PUBLIC', enterpriseId: 'ent-b' }, customer)).toBe(false);
    expect(canUseHit({ visibility: 'INTERNAL', enterpriseId: 'ent-a' }, customer)).toBe(false);
    expect(canUseHit({ visibility: 'INTERNAL', enterpriseId: 'ent-a' }, ops)).toBe(true);
    // 内部知识仅运维可见，跨企业也可检索；但公开知识不可跨企业
    expect(canUseHit({ visibility: 'INTERNAL', enterpriseId: 'ent-b' }, ops)).toBe(true);
    expect(canUseHit({ visibility: 'PUBLIC', enterpriseId: 'ent-b' }, ops)).toBe(false);
  });

  it('FAQ 查询条件下推客户可见范围与企业隔离', () => {
    const where: any = faqScopeWhere({ userId: 'u1', role: 'REPORTER', enterpriseId: 'ent-a', isOps: false });
    expect(where.status).toBe('ACTIVE');
    expect(where.visibility).toBe('PUBLIC');
    expect(where.OR).toEqual([{ enterpriseId: null }, { enterpriseId: 'ent-a' }]);
    const opsWhere: any = faqScopeWhere({ userId: 'u2', role: 'ADMIN', enterpriseId: null, isOps: true });
    expect(opsWhere.visibility).toBeUndefined();
    expect(opsWhere.OR).toEqual([{ visibility: 'INTERNAL' }, { enterpriseId: null }]);
  });

  it('批量导入解析 Q/A 文本，忽略不完整条目', () => {
    const items = parseFaqText(
      'Q: 如何提单？\nA: 点击提交工单。\n\n问题：如何重置密码？\n答案：通过邮箱重置。\n\nQ: 只有问题',
    );
    expect(items).toEqual([
      { question: '如何提单？', answer: '点击提交工单。' },
      { question: '如何重置密码？', answer: '通过邮箱重置。' },
    ]);
  });
});
