import type { Prisma } from '@prisma/client';
import type { KnowledgeHit, KnowledgeScope } from './ai.types';

/**
 * 权限过滤（检索结果二次校验，防御外部知识库未按约定过滤）：
 * - 运维：内部知识不限企业（内部知识本就仅运维可见），公开知识仅全局或本企业
 * - 客户：仅公开知识 + 全局或本企业，绝不可见内部知识与其他企业
 */
export function canUseHit(
  hit: Pick<KnowledgeHit, 'visibility' | 'enterpriseId'>,
  scope: KnowledgeScope,
): boolean {
  const visibility = (hit.visibility || 'PUBLIC').toUpperCase();
  if (!scope.isOps) {
    if (visibility !== 'PUBLIC') return false;
    return !hit.enterpriseId || hit.enterpriseId === scope.enterpriseId;
  }
  if (visibility === 'INTERNAL') return true;
  return !hit.enterpriseId || hit.enterpriseId === scope.enterpriseId;
}

/** FAQ 查询条件：企业隔离 + 客户公开范围，均下推到数据库 */
export function faqScopeWhere(scope: KnowledgeScope): Prisma.FaqEntryWhereInput {
  if (scope.isOps) {
    return {
      status: 'ACTIVE',
      OR: [
        { visibility: 'INTERNAL' },
        { enterpriseId: null },
        ...(scope.enterpriseId ? [{ enterpriseId: scope.enterpriseId }] : []),
      ],
    };
  }
  return {
    status: 'ACTIVE',
    visibility: 'PUBLIC',
    OR: [
      { enterpriseId: null },
      ...(scope.enterpriseId ? [{ enterpriseId: scope.enterpriseId }] : []),
    ],
  };
}
