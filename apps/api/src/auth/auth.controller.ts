import { Body, Controller, Delete, Get, Param, Patch, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { z } from 'zod';
import { AuthUser, CurrentUser, Public } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { AuthService } from './auth.service';

const passwordSchema = z
  .string()
  .min(8, '密码至少 8 位')
  .max(72, '密码过长')
  .regex(/^(?=.*[A-Za-z])(?=.*\d).+$/, '密码需同时包含字母和数字');

const loginSchema = z.object({
  email: z.string().email('邮箱格式不正确'),
  password: z.string().min(1, '请输入密码'),
  /** 邮件验证码模式下的「信任设备」凭证 */
  deviceToken: z.string().max(200).optional(),
});

const verifySchema = z.object({
  challengeId: z.string().min(10, '验证信息缺失'),
  sliderX: z.number().optional(),
  code: z.string().max(64).optional(),
  recoveryCode: z.string().max(64).optional(),
  rememberDevice: z.boolean().optional(),
});

const challengeSchema = z.object({ challengeId: z.string().min(10, '验证信息缺失') });
const enrollSchema = z.object({ enrollToken: z.string().min(10), code: z.string().min(6).max(6) });
const totpCodeSchema = z.object({ code: z.string().min(6).max(6) });

const activateSchema = z.object({ token: z.string().min(10), password: passwordSchema });
const forgotSchema = z.object({ email: z.string().email('邮箱格式不正确') });
const resetSchema = z.object({ token: z.string().min(10), password: passwordSchema });
const changeSchema = z.object({ oldPassword: z.string().min(1), newPassword: passwordSchema });

const COOKIE = 'tr_refresh';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly service: AuthService,
    private readonly config: ConfigService,
  ) {}

  private setRefreshCookie(res: Response, token: string) {
    const days = Number(this.config.get('REFRESH_TOKEN_TTL_DAYS') || 7);
    res.cookie(COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: String(this.config.get('COOKIE_SECURE') ?? 'false') === 'true',
      maxAge: days * 86400_000,
      path: '/',
    });
  }

  /** 统一出口：需要二次验证时不签发任何令牌 */
  private respond(res: Response, result: any) {
    if (!result?.accessToken) return result;
    this.setRefreshCookie(res, result.refreshToken);
    const { refreshToken, ...rest } = result;
    return rest;
  }

  @Public()
  @Post('login')
  async login(@Body(new ZodPipe(loginSchema)) body: any, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.service.login(
      body.email,
      body.password,
      { ip: req.ip, userAgent: req.headers['user-agent'] },
      body.deviceToken,
    );
    return this.respond(res, result);
  }

  /** 第二步验证：滑块 / 邮件验证码 / TOTP / 恢复码 */
  @Public()
  @Post('login/verify')
  async verify(@Body(new ZodPipe(verifySchema)) body: any, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.service.verifyLogin(body, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return this.respond(res, result);
  }

  @Public()
  @Post('login/email-code')
  resendEmailCode(@Body(new ZodPipe(challengeSchema)) body: any) {
    return this.service.resendEmailCode(body.challengeId);
  }

  @Public()
  @Post('login/slider/refresh')
  refreshSlider(@Body(new ZodPipe(challengeSchema)) body: any, @Req() req: Request) {
    return this.service.refreshSlider(body.challengeId, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  /** 强制绑定 TOTP 时：提交动态码完成绑定并登录，返回一次性恢复码 */
  @Public()
  @Post('login/totp/enroll')
  async enrollTotp(@Body(new ZodPipe(enrollSchema)) body: any, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.service.enrollTotp(body.enrollToken, body.code, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return this.respond(res, result);
  }

  @Public()
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = req.cookies?.[COOKIE];
    const result = await this.service.refresh(raw, { ip: req.ip, userAgent: req.headers['user-agent'] });
    this.setRefreshCookie(res, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Public()
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.service.logout(req.cookies?.[COOKIE]);
    res.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  }

  @Public()
  @Post('activate')
  activate(@Body(new ZodPipe(activateSchema)) body: any) {
    return this.service.activate(body.token, body.password);
  }

  @Public()
  @Post('forgot-password')
  forgot(@Body(new ZodPipe(forgotSchema)) body: any) {
    return this.service.forgotPassword(body.email);
  }

  @Public()
  @Post('reset-password')
  reset(@Body(new ZodPipe(resetSchema)) body: any) {
    return this.service.resetPassword(body.token, body.password);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.service.me(user.id);
  }

  @Patch('me/password')
  changePassword(@CurrentUser() user: AuthUser, @Body(new ZodPipe(changeSchema)) body: any) {
    return this.service.changePassword(user.id, body.oldPassword, body.newPassword);
  }

  // ---------- 个人设置：信任设备 ----------

  @Get('me/trusted-devices')
  trustedDevices(@CurrentUser() user: AuthUser) {
    return this.service.listTrustedDevices(user.id);
  }

  @Delete('me/trusted-devices/:id')
  revokeTrustedDevice(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.revokeTrustedDevice(user.id, id);
  }

  @Delete('me/trusted-devices')
  revokeAllTrustedDevices(@CurrentUser() user: AuthUser) {
    return this.service.revokeAllTrustedDevices(user.id);
  }

  // ---------- 个人设置：TOTP 自助绑定 ----------

  @Get('me/totp')
  totpStatus(@CurrentUser() user: AuthUser) {
    return this.service.totpStatus(user.id);
  }

  @Post('me/totp/setup')
  setupTotp(@CurrentUser() user: AuthUser) {
    return this.service.setupTotp(user.id, user.email);
  }

  @Post('me/totp/enable')
  enableTotp(@CurrentUser() user: AuthUser, @Body(new ZodPipe(totpCodeSchema)) body: any) {
    return this.service.enableTotp(user.id, body.code);
  }
}
