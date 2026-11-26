import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { KnowledgeHit, KnowledgeScope, KnowledgeSource } from './ai.types';
import { rankFaq } from './faq-match';
import { canUseHit, faqScopeWhere } from './knowledge-scope';

/**
 * 内置 FAQ 兜底知识库：数据库关键词打分检索。
 * 未接外部知识库时也能使用；外部知识库无结果时作为兜底。
 */
@Injectable()
export class FaqKnowledgeSource implements KnowledgeSource {
  readonly type = 'FAQ' as const;

  constructor(private readonly prisma: PrismaService) {}

  async search(query: string, scope: KnowledgeScope, topK: number): Promise<KnowledgeHit[]> {
    const entries = await this.prisma.faqEntry.findMany({
      where: faqScopeWhere(scope),
      orderBy: { updatedAt: 'desc' },
      take: 500,
    });
    const ranked = rankFaq(query, entries, topK);
    return ranked
      .map((entry) => ({
        source: this.type,
        id: entry.id,
        title: entry.question,
        content: entry.answer,
        url: null,
        visibility: (entry.visibility === 'INTERNAL' ? 'INTERNAL' : 'PUBLIC') as 'PUBLIC' | 'INTERNAL',
        enterpriseId: entry.enterpriseId,
        score: entry.score,
      }))
      .filter((hit) => canUseHit(hit, scope));
  }

  /** 状态接口展示的建议问题：按最近更新取公开范围内的条目 */
  async suggested(scope: KnowledgeScope, limit = 6): Promise<string[]> {
    const rows = await this.prisma.faqEntry.findMany({
      where: faqScopeWhere(scope),
      orderBy: { updatedAt: 'desc' },
      take: Math.max(1, limit),
      select: { question: true },
    });
    return rows.map((row) => row.question);
  }
}
