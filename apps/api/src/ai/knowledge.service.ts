import { Injectable, Logger } from '@nestjs/common';
import type { KnowledgeScope, KnowledgeSearchResult } from './ai.types';
import { AiSettingsService } from './ai-settings.service';
import { ExternalHttpKnowledgeSource } from './external-http.source';
import { FaqKnowledgeSource } from './faq.source';
import { InternalKnowledgeSource } from './internal.source';
import { canUseHit } from './knowledge-scope';

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);

  constructor(
    private readonly settings: AiSettingsService,
    private readonly faq: FaqKnowledgeSource,
    private readonly external: ExternalHttpKnowledgeSource,
    private readonly internal: InternalKnowledgeSource,
  ) {}

  async search(query: string, scope: KnowledgeScope, topK: number): Promise<KnowledgeSearchResult> {
    const cfg = await this.settings.kbConfig();
    const primary = cfg.source;
    let hits: any[] = [];

    try {
      if (primary === 'EXTERNAL_HTTP') hits = await this.external.search(query, scope, topK);
      else if (primary === 'INTERNAL') hits = await this.internal.search(query, scope, topK);
      else hits = await this.faq.search(query, scope, topK);
    } catch (error: any) {
      // 外部知识库异常时记录并继续走 FAQ 兜底，不阻断对话
      this.logger.warn(`知识库检索失败（${primary}）：${error?.message || error}`);
      hits = [];
    }

    let fallbackUsed = false;
    if (!hits.length && primary !== 'FAQ') {
      hits = await this.faq.search(query, scope, topK).catch(() => []);
      fallbackUsed = hits.length > 0;
    }

    // 统一出口再做一次权限过滤，防止适配器遗漏
    const filtered = hits.filter((hit) => canUseHit(hit, scope)).slice(0, Math.max(1, topK));
    return { hits: filtered, primary, fallbackUsed };
  }

  async suggestedQuestions(scope: KnowledgeScope, limit = 6): Promise<string[]> {
    return this.faq.suggested(scope, limit).catch(() => []);
  }
}
