import { Body, Controller, Get, Patch, Post, Req, Res } from '@nestjs/common';
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
});

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

  @Public()
  @Post('login')
  async login(@Body(new ZodPipe(loginSchema)) body: any, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.service.login(body.email, body.password, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    this.setRefreshCookie(res, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user };
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
}
