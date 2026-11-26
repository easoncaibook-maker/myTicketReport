import { Module } from '@nestjs/common';
import { AdminAiController } from './admin-ai.controller';
import { AiController } from './ai.controller';
import { AiSettingsService } from './ai-settings.service';
import { ChatService } from './chat.service';
import { ExternalHttpKnowledgeSource } from './external-http.source';
import { FaqKnowledgeSource } from './faq.source';
import { FaqService } from './faq.service';
import { InternalKnowledgeSource } from './internal.source';
import { KnowledgeService } from './knowledge.service';
import { LlmService } from './llm.service';
import { AiRateLimitService } from './rate-limit.service';

@Module({
  controllers: [AiController, AdminAiController],
  providers: [
    AiSettingsService,
    LlmService,
    FaqKnowledgeSource,
    ExternalHttpKnowledgeSource,
    InternalKnowledgeSource,
    KnowledgeService,
    AiRateLimitService,
    ChatService,
    FaqService,
  ],
  exports: [AiSettingsService, KnowledgeService, FaqService],
})
export class AiModule {}
