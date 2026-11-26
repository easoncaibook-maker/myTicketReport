import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AI_TICKET_DRAFT_CONTRACT } from '@ticketreport/shared';
import type { AuthUser } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import type { KnowledgeScope } from './ai.types';
import { AiSettingsService } from './ai-settings.service';
import { KnowledgeService } from './knowledge.service';
import { LlmService, type LlmMessage } from './llm.service';
import { buildSystemPrompt, extractCitationIndexes, selectCitations, trimHistory } from './prompt';
import { AiRateLimitService } from './rate-limit.service';

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function messageView(row: any) {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    citations: parseJson<any[]>(row.citations, []),
    createdAt: row.createdAt,
    meta: parseJson<Record<string, any> | null>(row.meta, null),
  };
}

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AiSettingsService,
    private readonly knowledge: KnowledgeService,
    private readonly llm: LlmService,
    private readonly rateLimit: AiRateLimitService,
  ) {}

  private scopeOf(user: AuthUser): KnowledgeScope {
    return {
      userId: user.id,
      role: user.role,
      enterpriseId: user.enterpriseId ?? null,
      isOps: user.role !== 'REPORTER',
    };
  }

  /** 会话按用户 + 企业隔离：企业快照变化后旧会话不可见，避免跨企业泄露 */
  private conversationWhere(user: AuthUser) {
    return { userId: user.id, enterpriseId: user.enterpriseId ?? null };
  }

  async status(user: AuthUser) {
    const cfg = await this.settings.publicView();
    const configured = await this.llm.isConfigured();
    const kbConfigured =
      cfg.kbSource === 'FAQ' ? true : cfg.kbSource === 'EXTERNAL_HTTP' ? !!cfg.kbEndpoint : false;
    const notice = configured
      ? null
      : cfg.aiEnabled
        ? 'AI 助手已启用，但尚未补齐 Base URL、API Key 或模型名，请联系管理员完成配置。'
        : 'AI 助手尚未启用，请联系管理员在「系统管理 → AI 问答」中开启。';
    const suggestedQuestions = await this.knowledge.suggestedQuestions(this.scopeOf(user), 6);
    return {
      enabled: cfg.aiEnabled,
      configured,
      kbSource: cfg.kbSource,
      kbConfigured,
      rateLimitPerMinute: cfg.aiRateLimitPerMinute,
      maxMessageChars: cfg.aiMaxMessageChars,
      suggestedQuestions,
      notice,
    };
  }

  async listConversations(user: AuthUser) {
    return this.prisma.aiConversation.findMany({
      where: this.conversationWhere(user),
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        title: true,
        messageCount: true,
        lastMessageAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  private async requireConversation(user: AuthUser, id: string) {
    const conversation = await this.prisma.aiConversation.findFirst({
      where: { id, ...this.conversationWhere(user) },
    });
    if (!conversation) throw new NotFoundException('对话不存在或无权访问');
    return conversation;
  }

  async getConversation(user: AuthUser, id: string) {
    const conversation = await this.requireConversation(user, id);
    const rows = await this.prisma.aiMessage.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'asc' },
    });
    return {
      conversation: {
        id: conversation.id,
        title: conversation.title,
        messageCount: conversation.messageCount,
        lastMessageAt: conversation.lastMessageAt,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      },
      messages: rows.map(messageView),
    };
  }

  async createConversation(user: AuthUser, title?: string) {
    const conversation = await this.prisma.aiConversation.create({
      data: {
        userId: user.id,
        enterpriseId: user.enterpriseId ?? null,
        title: (title || '新对话').slice(0, 60),
      },
    });
    return { id: conversation.id, title: conversation.title };
  }

  async renameConversation(user: AuthUser, id: string, title: string) {
    await this.requireConversation(user, id);
    const value = String(title || '').trim();
    if (!value) throw new BadRequestException('请输入对话标题');
    await this.prisma.aiConversation.update({ where: { id }, data: { title: value.slice(0, 60) } });
    return { ok: true };
  }

  async deleteConversation(user: AuthUser, id: string) {
    await this.requireConversation(user, id);
    await this.prisma.$transaction([
      this.prisma.aiMessage.deleteMany({ where: { conversationId: id } }),
      this.prisma.aiConversation.delete({ where: { id } }),
    ]);
    return { ok: true };
  }

  async chat(user: AuthUser, input: { conversationId?: string; message: string }) {
    const cfg = await this.settings.publicView();
    const text = String(input.message || '').trim();
    if (!text) throw new BadRequestException('请输入问题');
    if (text.length > cfg.aiMaxMessageChars) {
      throw new BadRequestException(`问题过长，请控制在 ${cfg.aiMaxMessageChars} 字以内`);
    }
    // 限流在落库前执行，避免被刷接口写满会话
    this.rateLimit.consume(user.id, cfg.aiRateLimitPerMinute);

    const scope = this.scopeOf(user);
    const conversation = input.conversationId
      ? await this.requireConversation(user, input.conversationId)
      : await this.prisma.aiConversation.create({
          data: {
            userId: user.id,
            enterpriseId: user.enterpriseId ?? null,
            title: text.replace(/\s+/g, ' ').slice(0, 30) || '新对话',
          },
        });

    const historyRows = await this.prisma.aiMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'desc' },
      take: Math.max(0, cfg.aiHistoryMessages) * 2,
    });
    const history = trimHistory(
      historyRows
        .reverse()
        .map((row) => ({
          role: (row.role === 'ASSISTANT' ? 'assistant' : 'user') as 'assistant' | 'user',
          content: row.content,
        })),
      cfg.aiHistoryMessages,
    );

    const knowledge = await this.knowledge.search(text, scope, cfg.aiTopK);
    const configured = await this.llm.isConfigured();

    await this.prisma.aiMessage.create({
      data: { conversationId: conversation.id, role: 'USER', content: text },
    });

    let answer: string;
    let citations: any[] = [];
    let meta: Record<string, any> = {
      configured,
      kbSource: knowledge.primary,
      fallbackUsed: knowledge.fallbackUsed,
      hitCount: knowledge.hits.length,
    };

    if (!configured) {
      answer = cfg.aiEnabled
        ? 'AI 助手尚未完成配置（缺少 Base URL、API Key 或模型名），暂时无法回答。请联系管理员在「系统管理 → AI 问答」中补齐配置。'
        : 'AI 助手尚未启用，暂时无法回答。请联系管理员在「系统管理 → AI 问答」中开启。';
      meta.notice = 'AI_NOT_CONFIGURED';
    } else {
      const messages: LlmMessage[] = [
        { role: 'system', content: buildSystemPrompt(knowledge.hits) },
        ...history,
        { role: 'user', content: text },
      ];
      try {
        const llmCfg = await this.settings.llmConfig();
        const reply = await this.llm.chat(messages, llmCfg);
        answer = reply.content;
        citations = selectCitations(knowledge.hits, extractCitationIndexes(answer));
        meta = { ...meta, elapsedMs: reply.elapsedMs, usage: reply.usage ?? null };
      } catch (error: any) {
        const detail = error instanceof HttpException ? (error.getResponse() as any)?.message : '';
        answer = `AI 服务暂时不可用${detail ? `：${detail}` : ''}。请稍后重试，或联系管理员检查大模型配置。`;
        meta.error = error?.getResponse?.()?.code || 'AI_UPSTREAM_ERROR';
      }
    }

    const assistant = await this.prisma.aiMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'ASSISTANT',
        content: answer,
        citations: JSON.stringify(citations),
        meta: JSON.stringify(meta),
      },
    });

    await this.prisma.aiConversation.update({
      where: { id: conversation.id },
      data: { messageCount: { increment: 2 }, lastMessageAt: new Date() },
    });

    return {
      conversationId: conversation.id,
      configured,
      notice: configured ? null : meta.notice,
      message: messageView(assistant),
      knowledge: {
        source: knowledge.primary,
        fallbackUsed: knowledge.fallbackUsed,
        hitCount: knowledge.hits.length,
      },
    };
  }

  /** 「上报为工单」仅提供契约，本版本不生成草稿、不创建工单 */
  ticketDraftContract(): never {
    throw new HttpException(
      {
        code: 'NOT_IMPLEMENTED',
        message: '「上报为工单」当前为设计预览，本版本不会创建工单。',
        contract: AI_TICKET_DRAFT_CONTRACT,
      },
      HttpStatus.NOT_IMPLEMENTED,
    );
  }
}
