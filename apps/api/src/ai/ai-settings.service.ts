import { Injectable } from '@nestjs/common';
import type { AiKbSource } from '@ticketreport/shared';
import { decryptSecret, encryptSecret } from '../common/secret-box';
import { PrismaService } from '../prisma/prisma.service';
import { parseKbMapping, type ExternalKbMapping } from './external-http';

const DEFAULTS: Record<string, string> = {
  aiEnabled: 'false',
  aiBaseUrl: '',
  aiApiKeyEnc: '',
  aiModel: 'gpt-4o-mini',
  aiTemperature: '0.3',
  aiTimeoutMs: '20000',
  aiMaxTokens: '800',
  aiTopK: '5',
  aiRateLimitPerMinute: '20',
  aiMaxMessageChars: '4000',
  aiHistoryMessages: '8',
  kbSource: 'FAQ',
  kbEndpoint: '',
  kbApiKeyEnc: '',
  kbTimeoutMs: '8000',
  kbAuthHeader: 'Authorization',
  kbAuthPrefix: 'Bearer ',
  kbRequestTemplate: '{"query":"{{query}}","topK":{{topK}},"enterpriseId":"{{enterpriseId}}","scope":"{{scope}}"}',
  kbResponseMapping:
    '{"itemsPath":"items","id":"id","title":"title","content":"content","url":"url","visibility":"visibility","enterpriseId":"enterpriseId","score":"score"}',
};

export const AI_SETTING_KEYS = Object.keys(DEFAULTS);

export interface LlmConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  timeoutMs: number;
  maxTokens: number;
}

export interface KbConfig {
  source: AiKbSource;
  endpoint: string;
  apiKey: string;
  timeoutMs: number;
  authHeader: string;
  authPrefix: string;
  requestTemplate: string;
  mapping: ExternalKbMapping;
}

@Injectable()
export class AiSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async raw(): Promise<Record<string, string>> {
    const rows = await this.prisma.appSetting.findMany();
    const map: Record<string, string> = { ...DEFAULTS };
    for (const row of rows) {
      if (row.key in map) map[row.key] = row.value;
    }
    return map;
  }

  private number(map: Record<string, string>, key: string): number {
    const value = Number(map[key]);
    return Number.isFinite(value) ? value : Number(DEFAULTS[key] || 0);
  }

  /** 管理端读取：密钥仅返回是否已配置，绝不下发明文 */
  async publicView() {
    const map = await this.raw();
    return {
      aiEnabled: map.aiEnabled === 'true',
      aiBaseUrl: map.aiBaseUrl,
      aiModel: map.aiModel,
      aiTemperature: this.number(map, 'aiTemperature'),
      aiTimeoutMs: this.number(map, 'aiTimeoutMs'),
      aiMaxTokens: this.number(map, 'aiMaxTokens'),
      aiTopK: this.number(map, 'aiTopK'),
      aiRateLimitPerMinute: this.number(map, 'aiRateLimitPerMinute'),
      aiMaxMessageChars: this.number(map, 'aiMaxMessageChars'),
      aiHistoryMessages: this.number(map, 'aiHistoryMessages'),
      aiApiKeyConfigured: !!map.aiApiKeyEnc,
      kbSource: (map.kbSource || 'FAQ') as AiKbSource,
      kbEndpoint: map.kbEndpoint,
      kbTimeoutMs: this.number(map, 'kbTimeoutMs'),
      kbAuthHeader: map.kbAuthHeader,
      kbAuthPrefix: map.kbAuthPrefix,
      kbRequestTemplate: map.kbRequestTemplate,
      kbResponseMapping: map.kbResponseMapping,
      kbApiKeyConfigured: !!map.kbApiKeyEnc,
      /** 密钥加密所用的环境变量来源提示，便于运维排查 */
      aiSecretKeyConfigured: !!process.env.AI_SECRET_KEY,
    };
  }

  async llmConfig(): Promise<LlmConfig> {
    const map = await this.raw();
    return {
      enabled: map.aiEnabled === 'true',
      baseUrl: map.aiBaseUrl,
      apiKey: decryptSecret(map.aiApiKeyEnc),
      model: map.aiModel,
      temperature: this.number(map, 'aiTemperature'),
      timeoutMs: this.number(map, 'aiTimeoutMs'),
      maxTokens: this.number(map, 'aiMaxTokens'),
    };
  }

  async kbConfig(): Promise<KbConfig> {
    const map = await this.raw();
    return {
      source: (map.kbSource || 'FAQ') as AiKbSource,
      endpoint: map.kbEndpoint,
      apiKey: decryptSecret(map.kbApiKeyEnc),
      timeoutMs: this.number(map, 'kbTimeoutMs'),
      authHeader: map.kbAuthHeader || 'Authorization',
      authPrefix: map.kbAuthPrefix,
      requestTemplate: map.kbRequestTemplate,
      mapping: parseKbMapping(map.kbResponseMapping),
    };
  }

  async isLlmConfigured(): Promise<boolean> {
    const cfg = await this.llmConfig();
    return !!(cfg.enabled && cfg.baseUrl && cfg.apiKey && cfg.model);
  }

  async update(values: Record<string, any>, actorId: string) {
    const allowed = new Set([
      'aiEnabled',
      'aiBaseUrl',
      'aiModel',
      'aiTemperature',
      'aiTimeoutMs',
      'aiMaxTokens',
      'aiTopK',
      'aiRateLimitPerMinute',
      'aiMaxMessageChars',
      'aiHistoryMessages',
      'kbSource',
      'kbEndpoint',
      'kbTimeoutMs',
      'kbAuthHeader',
      'kbAuthPrefix',
      'kbRequestTemplate',
      'kbResponseMapping',
    ]);
    const entries: Array<[string, string]> = [];
    for (const [key, value] of Object.entries(values)) {
      if (!allowed.has(key) || value === undefined) continue;
      entries.push([key, typeof value === 'boolean' ? String(value) : String(value)]);
    }
    if (typeof values.aiApiKey === 'string' && values.aiApiKey.trim()) {
      entries.push(['aiApiKeyEnc', encryptSecret(values.aiApiKey.trim())]);
    }
    if (values.clearAiApiKey === true) entries.push(['aiApiKeyEnc', '']);
    if (typeof values.kbApiKey === 'string' && values.kbApiKey.trim()) {
      entries.push(['kbApiKeyEnc', encryptSecret(values.kbApiKey.trim())]);
    }
    if (values.clearKbApiKey === true) entries.push(['kbApiKeyEnc', '']);

    for (const [key, value] of entries) {
      await this.prisma.appSetting.upsert({
        where: { key },
        create: { key, value, updatedBy: actorId },
        update: { value, updatedBy: actorId },
      });
    }
    return this.publicView();
  }
}
