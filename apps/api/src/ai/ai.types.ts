import type { AiKbSource } from '@ticketreport/shared';

/** 检索时的权限上下文：客户与运维的可见范围不同 */
export interface KnowledgeScope {
  userId: string;
  role: string;
  enterpriseId?: string | null;
  isOps: boolean;
}

/** 统一知识命中结构，外部知识库与内置 FAQ 都转换成该结构 */
export interface KnowledgeHit {
  source: 'FAQ' | 'EXTERNAL_HTTP' | 'INTERNAL';
  id: string;
  title: string;
  content: string;
  url?: string | null;
  visibility: 'PUBLIC' | 'INTERNAL';
  enterpriseId?: string | null;
  score?: number;
}

/** 知识库适配器契约：外部 HTTP、内部占位、FAQ 兜底都实现同一接口 */
export interface KnowledgeSource {
  readonly type: KnowledgeHit['source'];
  search(query: string, scope: KnowledgeScope, topK: number): Promise<KnowledgeHit[]>;
}

export interface KnowledgeSearchResult {
  hits: KnowledgeHit[];
  primary: AiKbSource;
  fallbackUsed: boolean;
}
