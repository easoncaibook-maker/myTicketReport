import { Injectable } from '@nestjs/common';
import type { KnowledgeHit, KnowledgeScope, KnowledgeSource } from './ai.types';

/**
 * 内部知识库占位实现：与 ExternalHttpKnowledgeSource / FaqKnowledgeSource 实现同一契约。
 * 后续接入内部检索服务时，只需替换本类的 search 实现，业务代码（KnowledgeService / ChatService）无需改动。
 */
@Injectable()
export class InternalKnowledgeSource implements KnowledgeSource {
  readonly type = 'INTERNAL' as const;

  async search(_query: string, _scope: KnowledgeScope, _topK: number): Promise<KnowledgeHit[]> {
    return [];
  }
}
