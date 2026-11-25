import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { PRIORITIES, VISIBILITIES } from '@ticketreport/shared';
import { z } from 'zod';
import { AuthUser, CurrentUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { TicketsService } from './tickets.service';

const createTicketSchema = z.object({
  title: z.string().min(5, '标题至少 5 个字').max(100, '标题最多 100 个字'),
  description: z.string().min(1, '请填写问题描述').max(20000, '描述内容过长'),
  categoryId: z.string().min(1, '请选择分类'),
  priority: z.enum(PRIORITIES),
  /** 仅运维侧账号生效：INTERNAL=内部工单，CUSTOMER/缺省=代客户提单 */
  ticketType: z.enum(['CUSTOMER', 'INTERNAL']).optional(),
  /** 代客户提单时必填 */
  enterpriseId: z.string().min(1).optional().nullable(),
});

const updateTicketSchema = z.object({
  title: z.string().min(5, '标题至少 5 个字').max(100, '标题最多 100 个字').optional(),
  description: z.string().min(1, '请填写问题描述').max(20000, '描述内容过长').optional(),
  categoryId: z.string().min(1, '请选择分类').optional(),
  priority: z.enum(PRIORITIES).optional(),
});
const assignSchema = z.object({
  groupId: z.string().min(1, '请选择处理组'),
  assigneeId: z.string().optional().nullable(),
  reason: z.string().max(500).optional(),
});
const transferSchema = z.object({
  groupId: z.string().min(1, '请选择处理组'),
  assigneeId: z.string().optional().nullable(),
  reason: z.string().min(2, '请填写转派原因').max(500),
});
const reasonSchema = z.object({ reason: z.string().min(2, '请填写原因').max(500) });
const optionalReasonSchema = z.object({ reason: z.string().max(500).optional() });
const relationSchema = z.object({ relatedTicketId: z.string().min(1, '请选择要关联的工单') });
const resolveSchema = z.object({ resolution: z.string().min(5, '请填写处理结果').max(2000) });
const workHoursSchema = z.object({
  workHours: z
    .number({ invalid_type_error: '请输入工时' })
    .min(0, '工时不能小于 0')
    .max(999.9, '工时不能超过 999.9')
    .refine((v) => Math.abs(v * 10 - Math.round(v * 10)) < 1e-6, '工时最多保留一位小数')
    .nullable(),
});
const commentSchema = z.object({
  content: z.string().min(1, '请输入内容').max(20000, '内容过长'),
  visibility: z.enum(VISIBILITIES).optional(),
  attachmentIds: z.array(z.string()).optional(),
});

@Controller('tickets')
export class TicketsController {
  constructor(private readonly service: TicketsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: any) {
    return this.service.list(user, query);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createTicketSchema)) body: any) {
    return this.service.create(user, body);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.get(user, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updateTicketSchema)) body: any) {
    return this.service.update(user, id, body);
  }

  @Post(':id/claim')
  claim(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.claim(user, id);
  }

  @Post(':id/assign')
  assign(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(assignSchema)) body: any) {
    return this.service.assign(user, id, body);
  }

  @Post(':id/transfer')
  transfer(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(transferSchema)) body: any) {
    return this.service.transfer(user, id, body);
  }

  @Post(':id/release')
  release(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.release(user, id);
  }

  @Post(':id/resolve')
  resolve(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(resolveSchema)) body: any) {
    return this.service.resolve(user, id, body);
  }

  @Post(':id/confirm')
  confirm(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.confirm(user, id);
  }

  @Post(':id/reject')
  reject(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(reasonSchema)) body: any) {
    return this.service.reject(user, id, body);
  }

  @Post(':id/force-close')
  forceClose(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(reasonSchema)) body: any) {
    return this.service.forceClose(user, id, body);
  }

  /** 处理人在待确认阶段关闭工单 */
  @Post(':id/close')
  close(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(optionalReasonSchema)) body: any) {
    return this.service.close(user, id, body);
  }

  @Post(':id/favorite')
  favorite(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.favorite(user, id);
  }

  @Delete(':id/favorite')
  unfavorite(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.unfavorite(user, id);
  }

  @Get(':id/relations')
  relations(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.relations(user, id);
  }

  @Post(':id/relations')
  addRelation(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(relationSchema)) body: any) {
    return this.service.addRelation(user, id, body.relatedTicketId);
  }

  @Delete(':id/relations/:relationId')
  removeRelation(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('relationId') relationId: string,
  ) {
    return this.service.removeRelation(user, id, relationId);
  }

  @Post(':id/reopen')
  reopen(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.reopen(user, id);
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(optionalReasonSchema)) body: any) {
    return this.service.cancel(user, id, body);
  }

  @Patch(':id/work-hours')
  updateWorkHours(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(workHoursSchema)) body: any) {
    return this.service.updateWorkHours(user, id, body.workHours);
  }

  @Post(':id/comments')
  comment(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(commentSchema)) body: any) {
    return this.service.createComment(user, id, body);
  }

  @Post(':id/attachments')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 200 * 1024 * 1024, files: 1 },
    }),
  )
  upload(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.service.uploadAttachment(user, id, file);
  }
}

@Controller()
export class AttachmentsController {
  constructor(private readonly service: TicketsService) {}

  @Get('attachments/:id/download')
  download(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() res: Response) {
    return this.service.downloadAttachment(user, id, res);
  }

  @Delete('comments/:id')
  deleteComment(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.deleteComment(user, id);
  }
}
