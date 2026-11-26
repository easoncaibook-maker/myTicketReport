import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AI_KB_SOURCES, FAQ_VISIBILITIES } from '@ticketreport/shared';
import { z } from 'zod';
import { AuditService } from '../audit/audit.module';
import { AuthUser, CurrentUser, Roles } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { AiSettingsService } from './ai-settings.service';
import { FaqService } from './faq.service';

const optionalUrl = z
  .string()
  .trim()
  .max(300)
  .refine((value) => !value || /^https?:\/\/.+/i.test(value), '请输入以 http(s) 开头的地址');

const jsonText = (label: string) =>
  z
    .string()
    .max(4000)
    .refine((value) => {
      if (!value.trim()) return true;
      try {
        JSON.parse(value);
        return true;
      } catch {
        return false;
      }
    }, `${label}必须是合法 JSON`);

const aiSettingsSchema = z.object({
  aiEnabled: z.boolean().optional(),
  aiBaseUrl: optionalUrl.optional(),
  aiModel: z.string().trim().max(100).optional(),
  aiTemperature: z.number().min(0).max(2).optional(),
  aiTimeoutMs: z.number().int().min(1000).max(120000).optional(),
  aiMaxTokens: z.number().int().min(100).max(4000).optional(),
  aiTopK: z.number().int().min(1).max(10).optional(),
  aiRateLimitPerMinute: z.number().int().min(1).max(120).optional(),
  aiMaxMessageChars: z.number().int().min(200).max(8000).optional(),
  aiHistoryMessages: z.number().int().min(0).max(20).optional(),
  /** 写入型字段：仅提交时使用，读取接口不会回显 */
  aiApiKey: z.string().max(500).optional(),
  clearAiApiKey: z.boolean().optional(),
  kbSource: z.enum(AI_KB_SOURCES).optional(),
  kbEndpoint: optionalUrl.optional(),
  kbTimeoutMs: z.number().int().min(500).max(60000).optional(),
  kbAuthHeader: z.string().trim().max(50).optional(),
  kbAuthPrefix: z.string().max(50).optional(),
  kbRequestTemplate: jsonText('请求模板').optional(),
  kbResponseMapping: jsonText('响应映射').optional(),
  kbApiKey: z.string().max(500).optional(),
  clearKbApiKey: z.boolean().optional(),
});

const faqSchema = z.object({
  question: z.string().trim().min(1, '请输入问题').max(200),
  answer: z.string().trim().min(1, '请输入答案').max(5000),
  keywords: z.string().trim().max(200).optional(),
  visibility: z.enum(FAQ_VISIBILITIES).optional(),
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
  enterpriseId: z.string().max(50).nullable().optional(),
});
const faqUpdateSchema = faqSchema.partial();

const faqImportItem = z.object({
  question: z.string().trim().min(1).max(200),
  answer: z.string().trim().min(1).max(5000),
});
const faqImportSchema = z
  .object({
    text: z.string().max(50000).optional(),
    items: z.array(faqImportItem).max(200).optional(),
    visibility: z.enum(FAQ_VISIBILITIES).optional(),
    enterpriseId: z.string().max(50).nullable().optional(),
  })
  .refine((value) => !!value.text?.trim() || !!value.items?.length, '请提供导入文本或问答条目');

@Roles('ADMIN')
@Controller('admin')
export class AdminAiController {
  constructor(
    private readonly settings: AiSettingsService,
    private readonly faq: FaqService,
    private readonly audit: AuditService,
  ) {}

  @Get('ai/settings')
  getAiSettings() {
    return this.settings.publicView();
  }

  @Patch('ai/settings')
  async updateAiSettings(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(aiSettingsSchema)) body: any,
  ) {
    const result = await this.settings.update(body, user.id);
    // 审计只记录变更项与是否更新密钥，绝不落明文
    const {
      aiApiKey,
      kbApiKey,
      clearAiApiKey,
      clearKbApiKey,
      ...rest
    } = body;
    await this.audit.log(user.id, 'AI_SETTING_UPDATE', 'AppSetting', 'ai', {
      ...rest,
      aiApiKeyChanged: !!aiApiKey,
      aiApiKeyCleared: !!clearAiApiKey,
      kbApiKeyChanged: !!kbApiKey,
      kbApiKeyCleared: !!clearKbApiKey,
    });
    return result;
  }

  @Get('faq')
  listFaq(
    @Query('keyword') keyword?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('visibility') visibility?: string,
    @Query('status') status?: string,
    @Query('enterpriseId') enterpriseId?: string,
  ) {
    return this.faq.list({
      keyword,
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 20,
      visibility,
      status,
      enterpriseId,
    });
  }

  @Post('faq')
  createFaq(@CurrentUser() user: AuthUser, @Body(new ZodPipe(faqSchema)) body: any) {
    return this.faq.create(user.id, body);
  }

  @Post('faq/import')
  importFaq(@CurrentUser() user: AuthUser, @Body(new ZodPipe(faqImportSchema)) body: any) {
    return this.faq.import(user.id, body);
  }

  @Patch('faq/:id')
  updateFaq(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(faqUpdateSchema)) body: any,
  ) {
    return this.faq.update(user.id, id, body);
  }

  @Delete('faq/:id')
  removeFaq(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.faq.remove(user.id, id);
  }
}
