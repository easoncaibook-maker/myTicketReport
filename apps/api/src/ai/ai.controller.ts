import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser, CurrentUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { ChatService } from './chat.service';

const chatSchema = z.object({
  conversationId: z.string().max(50).optional(),
  message: z.string().trim().min(1, '请输入问题').max(8000, '问题过长'),
});

const createConversationSchema = z.object({ title: z.string().trim().max(60).optional() });
const renameConversationSchema = z.object({ title: z.string().trim().min(1, '请输入标题').max(60) });

@Controller('ai')
export class AiController {
  constructor(private readonly chat: ChatService) {}

  @Get('status')
  status(@CurrentUser() user: AuthUser) {
    return this.chat.status(user);
  }

  @Get('conversations')
  conversations(@CurrentUser() user: AuthUser) {
    return this.chat.listConversations(user);
  }

  @Post('conversations')
  createConversation(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(createConversationSchema)) body: any,
  ) {
    return this.chat.createConversation(user, body.title);
  }

  @Get('conversations/:id')
  conversation(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.chat.getConversation(user, id);
  }

  @Patch('conversations/:id')
  rename(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(renameConversationSchema)) body: any,
  ) {
    return this.chat.renameConversation(user, id, body.title);
  }

  @Delete('conversations/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.chat.deleteConversation(user, id);
  }

  @Post('chat')
  send(@CurrentUser() user: AuthUser, @Body(new ZodPipe(chatSchema)) body: any) {
    return this.chat.chat(user, body);
  }

  /** 设计预览：返回工单草稿接口契约，不创建工单 */
  @Post('ticket-draft')
  ticketDraft() {
    return this.chat.ticketDraftContract();
  }
}
