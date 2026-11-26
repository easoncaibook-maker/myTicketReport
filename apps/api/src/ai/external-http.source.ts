import { Injectable } from '@nestjs/common';
import type { KnowledgeHit, KnowledgeScope, KnowledgeSource } from './ai.types';
import { AiSettingsService } from './ai-settings.service';
import { buildExternalRequestBody, mapExternalItems } from './external-http';
import { canUseHit } from './knowledge-scope';

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(500, timeoutMs));
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 外部知识库适配器：通过可配置的 HTTP 接口检索。
 * 请求体用 JSON 模板渲染，响应通过字段映射转换为统一引用结构。
 */
@Injectable()
export class ExternalHttpKnowledgeSource implements KnowledgeSource {
  readonly type = 'EXTERNAL_HTTP' as const;

  constructor(private readonly settings: AiSettingsService) {}

  async search(query: string, scope: KnowledgeScope, topK: number): Promise<KnowledgeHit[]> {
    const cfg = await this.settings.kbConfig();
    if (!cfg.endpoint) return [];
    const body = buildExternalRequestBody(cfg.requestTemplate, {
      query,
      topK,
      enterpriseId: scope.enterpriseId || '',
      scope: scope.isOps ? 'INTERNAL' : 'PUBLIC',
      userId: scope.userId,
    });
    if (!body) return [];
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (cfg.apiKey) headers[cfg.authHeader || 'Authorization'] = `${cfg.authPrefix || ''}${cfg.apiKey}`;

    const response = await fetchWithTimeout(
      cfg.endpoint,
      { method: 'POST', headers, body: JSON.stringify(body) },
      cfg.timeoutMs,
    );
    if (!response.ok) {
      throw new Error(`外部知识库返回 ${response.status}`);
    }
    const data: any = await response.json();
    const items = cfg.mapping.itemsPath
      ? cfg.mapping.itemsPath.split('.').reduce((current: any, key: string) => current?.[key], data)
      : data;
    return mapExternalItems(items, cfg.mapping)
      .filter((hit) => canUseHit(hit, scope))
      .slice(0, Math.max(1, topK));
  }
}
