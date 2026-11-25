import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomToken, hashPassword, hashToken, verifyPassword } from '../common/password';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.module';

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILS = 5;

@Injectable()
export class AuthService {
  private readonly loginFails = new Map<string, { count: number; firstAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly settings: SettingsService,
  ) {}

  private async signAccess(user: { id: string; role: string }) {
    return this.jwt.signAsync(
      { sub: user.id, role: user.role },
      { expiresIn: (this.config.get('ACCESS_TOKEN_TTL') || '900s') as any },
    );
  }

  private async createRefreshToken(userId: string, meta: { ip?: string; userAgent?: string }) {
    const days = Number(this.config.get('REFRESH_TOKEN_TTL_DAYS') || 7);
    const raw = randomToken(48);
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + days * 86400_000),
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 200),
      },
    });
    return raw;
  }

  private checkThrottle(email: string) {
    const entry = this.loginFails.get(email);
    if (!entry) return;
    if (Date.now() - entry.firstAt > LOGIN_WINDOW_MS) {
      this.loginFails.delete(email);
      return;
    }
    if (entry.count >= LOGIN_MAX_FAILS) {
      throw new HttpException('登录失败次数过多，请 15 分钟后再试', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private markFail(email: string) {
    const entry = this.loginFails.get(email);
    if (!entry || Date.now() - entry.firstAt > LOGIN_WINDOW_MS) {
      this.loginFails.set(email, { count: 1, firstAt: Date.now() });
    } else {
      entry.count += 1;
    }
  }

  async login(email: string, password: string, meta: { ip?: string; userAgent?: string }) {
    const normalized = email.trim().toLowerCase();
    this.checkThrottle(normalized);
    const user = await this.prisma.user.findUnique({
      where: { email: normalized },
      include: { enterprise: true, groupMembers: true },
    });
    if (!user || !verifyPassword(password, user.passwordHash)) {
      this.markFail(normalized);
      throw new UnauthorizedException('邮箱或密码错误');
    }
    if (user.status === 'INVITED') {
      throw new ForbiddenException('账号尚未激活，请先通过邀请邮件设置密码');
    }
    if (user.status === 'DISABLED') {
      throw new ForbiddenException('账号已被禁用，请联系管理员');
    }
    if (user.enterprise && user.enterprise.status === 'DISABLED') {
      throw new ForbiddenException('所属企业已停用，请联系管理员');
    }
    this.loginFails.delete(normalized);
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const accessToken = await this.signAccess(user);
    const refreshToken = await this.createRefreshToken(user.id, meta);
    return { accessToken, refreshToken, user: this.toPublic(user) };
  }

  async refresh(rawToken: string, meta: { ip?: string; userAgent?: string }) {
    if (!rawToken) throw new UnauthorizedException('登录已过期，请重新登录');
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      include: { user: { include: { enterprise: true, groupMembers: true } } },
    });
    if (!row || row.revokedAt || row.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('登录已过期，请重新登录');
    }
    if (row.user.status !== 'ACTIVE') throw new UnauthorizedException('账号不可用');
    await this.prisma.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
    const accessToken = await this.signAccess(row.user);
    const refreshToken = await this.createRefreshToken(row.user.id, meta);
    return { accessToken, refreshToken, user: this.toPublic(row.user) };
  }

  async logout(rawToken?: string) {
    if (rawToken) {
      await this.prisma.refreshToken.updateMany({
        where: { tokenHash: hashToken(rawToken), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return { ok: true };
  }

  toPublic(user: any) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      role: user.role,
      status: user.status,
      enterpriseId: user.enterpriseId,
      enterpriseName: user.enterprise?.name ?? null,
      groupIds: (user.groupMembers ?? []).map((g: any) => g.groupId),
    };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { enterprise: true, groupMembers: true },
    });
    if (!user) throw new UnauthorizedException('用户不存在');
    const settings = await this.settings.getAll();
    return { ...this.toPublic(user), siteName: settings.siteName };
  }

  async createAuthToken(userId: string, type: 'INVITE' | 'RESET_PASSWORD', hours: number) {
    const raw = randomToken(32);
    await this.prisma.authToken.create({
      data: {
        userId,
        type,
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + hours * 3600_000),
      },
    });
    return raw;
  }

  private async consumeToken(raw: string, type: 'INVITE' | 'RESET_PASSWORD') {
    const row = await this.prisma.authToken.findUnique({
      where: { tokenHash: hashToken(raw) },
      include: { user: true },
    });
    if (!row || row.type !== type || row.usedAt || row.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('链接无效或已过期，请联系管理员重新发送');
    }
    return row;
  }

  async activate(token: string, password: string) {
    const row = await this.consumeToken(token, 'INVITE');
    if (row.user.status === 'DISABLED') throw new ForbiddenException('账号已被禁用，请联系管理员');
    await this.prisma.$transaction([
      this.prisma.authToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
      this.prisma.user.update({
        where: { id: row.userId },
        data: {
          passwordHash: hashPassword(password),
          status: 'ACTIVE',
          activatedAt: new Date(),
        },
      }),
    ]);
    const user = await this.prisma.user.findUnique({
      where: { id: row.userId },
      include: { enterprise: true, groupMembers: true },
    });
    return { ok: true, email: user?.email };
  }

  async forgotPassword(email: string) {
    const normalized = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email: normalized } });
    if (user && user.status !== 'DISABLED') {
      const raw = await this.createAuthToken(user.id, 'RESET_PASSWORD', 2);
      const link = `${this.config.get('APP_BASE_URL') || 'http://localhost:5173'}/reset-password?token=${raw}`;
      await this.mail.enqueue({ toEmail: user.email, template: 'resetPassword', data: { name: user.name, link } });
    }
    return { ok: true, message: '如果该邮箱已注册，我们已发送重置邮件' };
  }

  async resetPassword(token: string, password: string) {
    const row = await this.consumeToken(token, 'RESET_PASSWORD');
    await this.prisma.$transaction([
      this.prisma.authToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
      this.prisma.user.update({ where: { id: row.userId }, data: { passwordHash: hashPassword(password) } }),
      this.prisma.refreshToken.updateMany({
        where: { userId: row.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return { ok: true };
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !verifyPassword(oldPassword, user.passwordHash)) {
      throw new BadRequestException('原密码不正确');
    }
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash: hashPassword(newPassword) } }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return { ok: true };
  }
}
