import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ROLES } from '@ticketreport/shared';
import { z } from 'zod';
import { AuthUser, CurrentUser, Roles } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { MailService } from '../mail/mail.service';
import { SettingsService } from '../settings/settings.module';
import { AuditService } from '../audit/audit.module';
import { AdminService } from './admin.service';

const enterpriseSchema = z.object({
  name: z.string().min(2, '企业名称至少 2 个字').max(100),
  code: z.string().min(2, '简码至少 2 位').max(30).regex(/^[A-Za-z0-9_-]+$/, '简码仅支持字母、数字、下划线、短横线'),
  contactName: z.string().max(50).optional(),
  contactPhone: z.string().max(30).optional(),
  remark: z.string().max(500).optional(),
});
const enterpriseUpdateSchema = enterpriseSchema.partial().extend({ status: z.enum(['ACTIVE', 'DISABLED']).optional() });

const inviteSchema = z.object({
  email: z.string().email('邮箱格式不正确'),
  name: z.string().min(1, '请输入姓名').max(50),
  phone: z.string().max(30).optional(),
  role: z.enum(ROLES),
  enterpriseId: z.string().optional(),
  groupId: z.string().optional(),
});
const userUpdateSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  phone: z.string().max(30).optional(),
  status: z.enum(['INVITED', 'ACTIVE', 'DISABLED']).optional(),
});

const categorySchema = z.object({
  name: z.string().min(1, '请输入分类名称').max(50),
  defaultGroupId: z.string().min(1, '请选择默认处理组'),
  sort: z.number().int().optional(),
});
const categoryUpdateSchema = categorySchema.partial().extend({ status: z.enum(['ACTIVE', 'DISABLED']).optional() });

const groupSchema = z.object({
  name: z.string().min(1, '请输入处理组名称').max(50),
  description: z.string().max(200).optional(),
});
const groupUpdateSchema = groupSchema.partial().extend({ status: z.enum(['ACTIVE', 'DISABLED']).optional() });
const membersSchema = z.object({
  userIds: z.array(z.string()),
  leadIds: z.array(z.string()).optional(),
});

const settingsSchema = z.object({
  siteName: z.string().min(1).max(50).optional(),
  reopenWindowDays: z.number().int().min(1).max(90).optional(),
  maxAttachmentMb: z.number().int().min(1).max(200).optional(),
  emailEnabled: z.boolean().optional(),
});

@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly service: AdminService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  @Get('enterprises')
  listEnterprises(@Query('keyword') keyword?: string) {
    return this.service.listEnterprises(keyword);
  }

  @Post('enterprises')
  createEnterprise(@CurrentUser() user: AuthUser, @Body(new ZodPipe(enterpriseSchema)) body: any) {
    return this.service.createEnterprise(user.id, body);
  }

  @Patch('enterprises/:id')
  updateEnterprise(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(enterpriseUpdateSchema)) body: any,
  ) {
    return this.service.updateEnterprise(user.id, id, body);
  }

  @Get('enterprises/:id/users')
  enterpriseUsers(@Param('id') id: string) {
    return this.service.listUsers({ enterpriseId: id });
  }

  @Get('users')
  listUsers(@Query() query: any) {
    return this.service.listUsers(query);
  }

  @Post('users/invite')
  invite(@CurrentUser() user: AuthUser, @Body(new ZodPipe(inviteSchema)) body: any) {
    return this.service.inviteUser(user.id, body);
  }

  @Post('users/:id/resend-invite')
  resend(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.resendInvite(user.id, id);
  }

  @Patch('users/:id')
  updateUser(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(userUpdateSchema)) body: any,
  ) {
    return this.service.updateUser(user.id, id, body);
  }

  @Get('categories')
  categories() {
    return this.service.listCategories(false);
  }

  @Post('categories')
  createCategory(@CurrentUser() user: AuthUser, @Body(new ZodPipe(categorySchema)) body: any) {
    return this.service.createCategory(user.id, body);
  }

  @Patch('categories/:id')
  updateCategory(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(categoryUpdateSchema)) body: any,
  ) {
    return this.service.updateCategory(user.id, id, body);
  }

  @Get('groups')
  groups() {
    return this.service.listGroups(false);
  }

  @Post('groups')
  createGroup(@CurrentUser() user: AuthUser, @Body(new ZodPipe(groupSchema)) body: any) {
    return this.service.createGroup(user.id, body);
  }

  @Patch('groups/:id')
  updateGroup(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(groupUpdateSchema)) body: any,
  ) {
    return this.service.updateGroup(user.id, id, body);
  }

  @Put('groups/:id/members')
  setMembers(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(membersSchema)) body: any,
  ) {
    return this.service.setGroupMembers(user.id, id, body);
  }

  @Get('settings')
  async getSettings() {
    return { ...(await this.settings.getAll()), smtpConfigured: this.settings.smtpConfigured() };
  }

  @Patch('settings')
  async updateSettings(@CurrentUser() user: AuthUser, @Body(new ZodPipe(settingsSchema)) body: any) {
    const result = await this.settings.updateMany(body, user.id);
    await this.audit.log(user.id, 'SETTING_UPDATE', 'AppSetting', 'global', body);
    return { ...result, smtpConfigured: this.settings.smtpConfigured() };
  }

  @Get('audit-logs')
  auditLogs(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.service.listAudit(Number(page) || 1, Number(pageSize) || 20);
  }

  @Get('dev/outbox')
  outbox() {
    return this.mail.recent(50);
  }
}

@Controller('meta')
export class MetaController {
  constructor(private readonly service: AdminService) {}

  /** 工单表单使用：所有登录用户可见启用中的分类 */
  @Get('categories')
  categories() {
    return this.service.listCategories(true);
  }

  @Roles('AGENT', 'OPS_LEAD', 'ADMIN')
  @Get('groups')
  groups() {
    return this.service.listGroups(true);
  }

  @Roles('AGENT', 'OPS_LEAD', 'ADMIN')
  @Get('agents')
  agents(@Query('groupId') groupId?: string) {
    return this.service.listAgents(groupId);
  }

  @Roles('OPS_LEAD', 'ADMIN')
  @Get('enterprises')
  enterprises() {
    return this.service.listEnterprisesForFilter();
  }
}
