import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { AiSettingsService, type LlmConfig } from './ai-settings.service';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmReply {
  content: string;
  usage?: Record<string, any> | null;
  elapsedMs: number;
}

@Injectable()
export class LlmService {
  constructor(private readonly settings: AiSettingsService) {}

  async isConfigured(): Promise<boolean> {
    return this.settings.isLlmConfigured();
  }

  /** OpenAI 兼容协议：POST {baseUrl}/chat/completions */
  async chat(messages: LlmMessage[], cfg: LlmConfig): Promise<LlmReply> {
    const base = String(cfg.baseUrl || '').replace(/\/+$/, '');
    const url = /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1000, cfg.timeoutMs));
    const startedAt = Date.now();
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: cfg.model,
          temperature: cfg.temperature,
          max_tokens: cfg.maxTokens,
          messages,
          stream: false,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new HttpException(
          {
            code: 'AI_UPSTREAM_ERROR',
            message: `AI 服务返回 ${response.status}${text ? `：${text.slice(0, 200)}` : ''}`,
          },
          HttpStatus.BAD_GATEWAY,
        );
      }
      const data: any = await response.json();
      const raw = data?.choices?.[0]?.message?.content;
      const content = Array.isArray(raw)
        ? raw.map((part: any) => (typeof part === 'string' ? part : part?.text || '')).join('')
        : String(raw ?? '');
      if (!content.trim()) {
        throw new HttpException(
          { code: 'AI_EMPTY_REPLY', message: 'AI 未返回有效内容，请稍后重试' },
          HttpStatus.BAD_GATEWAY,
        );
      }
      return { content: content.trim(), usage: data?.usage ?? null, elapsedMs: Date.now() - startedAt };
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      if (error?.name === 'AbortError') {
        throw new HttpException(
          { code: 'AI_TIMEOUT', message: `AI 服务响应超时（${cfg.timeoutMs} ms），请稍后重试` },
          HttpStatus.GATEWAY_TIMEOUT,
        );
      }
      throw new HttpException(
        { code: 'AI_UPSTREAM_ERROR', message: '无法连接 AI 服务，请检查 Base URL 与网络后重试' },
        HttpStatus.BAD_GATEWAY,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
