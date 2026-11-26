import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { LoginVerificationMode } from '@ticketreport/shared';
import { hashToken, randomToken } from '../common/password';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.module';
import { createSliderChallenge, sliderPayload, verifySliderPosition } from './slider';
import {
  buildOtpauthUrl,
  generateEmailCode,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  maskEmail,
  normalizeRecoveryCode,
  parseRecoveryCodes,
  totpStep,
  verifyTotpCode,
} from './totp';

const SLIDER_TTL_MS = 2 * 60 * 1000;
const EMAIL_TTL_MS = 10 * 60 * 1000;
const TOTP_TTL_MS = 5 * 60 * 1000;
const ENROLL_TTL_MS = 10 * 60 * 1000;
const EMAIL_RESEND_INTERVAL_MS = 60 * 1000;
const EMAIL_MAX_SENDS = 5;
const VERIFY_FAIL_WINDOW_MS = 15 * 60 * 1000;
const VERIFY_MAX_FAILS = 10;

export const CHALLENGE_MODE = {
  SLIDER: 'SLIDER',
  EMAIL_CODE: 'EMAIL_CODE',
  TOTP: 'TOTP',
  TOTP_ENROLL: 'TOTP_ENROLL',
} as const;

interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class LoginVerificationService {
  /** 二次验证失败按用户计数，避免通过反复新建挑战暴力猜测 */
  private readonly fails = new Map<string, { count: number; firstAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly mail: MailService,
  ) {}

  // ---------- 登录第二步 ----------

  async start(user: any, meta: RequestMeta, deviceToken?: string) {
    const settings = await this.settings.getAll();
    const mode = settings.loginVerificationMode as LoginVerificationMode;

    if (mode === 'EMAIL_CODE' && deviceToken) {
      const device = await this.checkTrustedDevice(user.id, deviceToken);
      if (device) return { skip: true as const };
    }

    if (mode === 'SLIDER') {
      return { payload: await this.issueSlider(user, meta) };
    }
    if (mode === 'EMAIL_CODE') {
      return { payload: await this.issueEmailCode(user, meta) };
    }

    // TOTP：已绑定走动态码；强制绑定时走首次绑定；否则回退滑块避免账号被锁死
    if (user.totpEnabledAt && user.totpSecret) {
      return { payload: await this.issueTotp(user, meta) };
    }
    if (settings.requireTotpForOps && user.role !== 'REPORTER') {
      return { payload: await this.issueTotpEnroll(user, meta) };
    }
    return { payload: await this.issueSlider(user, meta, 'TOTP_NOT_BOUND') };
  }

  async verify(
    input: {
      challengeId: string;
      sliderX?: number;
      code?: string;
      recoveryCode?: string;
      rememberDevice?: boolean;
    },
    meta: RequestMeta,
  ) {
    const challenge = await this.findChallenge(input.challengeId);
    const user = await this.prisma.user.findUnique({
      where: { id: challenge.userId },
      include: { enterprise: true, groupMembers: true },
    });
    if (!user) throw new BadRequestException('用户不存在');
    this.assertNotBlocked(user.id);

    if (challenge.mode === CHALLENGE_MODE.SLIDER) {
      if (!verifySliderPosition(Number(challenge.secret), input.sliderX)) {
        throw await this.failChallenge(challenge, '滑块位置不正确，请重试');
      }
      await this.consume(challenge.id);
      this.fails.delete(user.id);
      return {
        user,
        trustedDeviceToken: null as string | null,
        trustedDeviceExpiresAt: null as Date | null,
      };
    }

    if (challenge.mode === CHALLENGE_MODE.EMAIL_CODE) {
      const code = String(input.code ?? '').replace(/\s/g, '');
      if (!/^\d{6}$/.test(code) || hashToken(code) !== challenge.secret) {
        throw await this.failChallenge(challenge, '验证码不正确或已失效');
      }
      await this.consume(challenge.id);
      this.fails.delete(user.id);
      let trustedDeviceToken: string | null = null;
      let trustedDeviceExpiresAt: Date | null = null;
      if (input.rememberDevice !== false) {
        const device = await this.createTrustedDevice(user.id, meta);
        trustedDeviceToken = device.token;
        trustedDeviceExpiresAt = device.expiresAt;
      }
      return { user, trustedDeviceToken, trustedDeviceExpiresAt };
    }

    if (challenge.mode === CHALLENGE_MODE.TOTP) {
      if (!user.totpSecret) throw new BadRequestException('请先绑定验证器');
      const raw = String(input.code ?? input.recoveryCode ?? '').trim();
      if (/^\d{6}$/.test(raw)) {
        const result = verifyTotpCode(user.totpSecret, raw, { lastStep: user.totpLastStep });
        if (!result.ok) throw await this.failChallenge(challenge, '动态码不正确或已被使用');
        await this.consume(challenge.id);
        await this.prisma.user.update({
          where: { id: user.id },
          data: { totpLastStep: result.step ?? totpStep() },
        });
        this.fails.delete(user.id);
        return {
          user,
          trustedDeviceToken: null as string | null,
          trustedDeviceExpiresAt: null as Date | null,
        };
      }
      const used = await this.consumeRecoveryCode(user.id, raw);
      if (!used) throw await this.failChallenge(challenge, '恢复码不正确或已被使用');
      await this.consume(challenge.id);
      this.fails.delete(user.id);
      return {
        user,
        trustedDeviceToken: null as string | null,
        trustedDeviceExpiresAt: null as Date | null,
      };
    }

    throw new BadRequestException('不支持的验证方式，请重新登录');
  }

  /** 重新发送邮件验证码（频率与次数限制） */
  async resendEmailCode(challengeId: string) {
    const challenge = await this.findChallenge(challengeId);
    if (challenge.mode !== CHALLENGE_MODE.EMAIL_CODE) {
      throw new BadRequestException('当前登录无需邮件验证码');
    }
    if (challenge.sendCount >= EMAIL_MAX_SENDS) {
      throw new HttpException('验证码发送次数过多，请重新登录', HttpStatus.TOO_MANY_REQUESTS);
    }
    if (challenge.lastSentAt) {
      const wait = EMAIL_RESEND_INTERVAL_MS - (Date.now() - challenge.lastSentAt.getTime());
      if (wait > 0) {
        throw new HttpException(`请 ${Math.ceil(wait / 1000)} 秒后再发送`, HttpStatus.TOO_MANY_REQUESTS);
      }
    }
    const user = await this.prisma.user.findUnique({ where: { id: challenge.userId } });
    if (!user) throw new BadRequestException('用户不存在');
    const code = generateEmailCode();
    await this.prisma.loginChallenge.update({
      where: { id: challenge.id },
      data: { secret: hashToken(code), sendCount: { increment: 1 }, lastSentAt: new Date() },
    });
    await this.sendCodeMail(user, code);
    return this.codeResponse(code);
  }

  /** 滑块失败后换一张图，避免因遮挡无法继续 */
  async refreshSlider(challengeId: string, meta: RequestMeta) {
    const challenge = await this.findChallenge(challengeId);
    if (challenge.mode !== CHALLENGE_MODE.SLIDER) throw new BadRequestException('当前登录无需滑块验证');
    const user = await this.prisma.user.findUnique({ where: { id: challenge.userId } });
    if (!user) throw new BadRequestException('用户不存在');
    await this.consume(challenge.id);
    return this.issueSlider(user, meta);
  }

  /** 强制绑定场景下完成 TOTP 首次绑定并返回恢复码 */
  async enrollTotp(enrollToken: string, code: string) {
    const challenge = await this.findChallenge(enrollToken);
    if (challenge.mode !== CHALLENGE_MODE.TOTP_ENROLL || !challenge.secret) {
      throw new BadRequestException('绑定请求已失效，请重新登录');
    }
    this.assertNotBlocked(challenge.userId);
    const result = verifyTotpCode(challenge.secret, code);
    if (!result.ok) throw await this.failChallenge(challenge, '动态码不正确，请核对验证器时间后重试');
    const user = await this.prisma.user.findUnique({
      where: { id: challenge.userId },
      include: { enterprise: true, groupMembers: true },
    });
    if (!user) throw new BadRequestException('用户不存在');
    const recoveryCodes = generateRecoveryCodes();
    await this.consume(challenge.id);
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        totpSecret: challenge.secret,
        totpEnabledAt: new Date(),
        totpLastStep: result.step ?? totpStep(),
        totpRecoveryCodes: JSON.stringify(recoveryCodes.map((c) => ({ hash: hashRecoveryCode(c), usedAt: null }))),
      },
    });
    this.fails.delete(user.id);
    return { user, recoveryCodes };
  }

  // ---------- 信任设备 ----------

  async listTrustedDevices(userId: string) {
    const rows = await this.prisma.trustedDevice.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      ip: r.ip,
      userAgent: r.userAgent,
      createdAt: r.createdAt,
      lastUsedAt: r.lastUsedAt,
      expiresAt: r.expiresAt,
    }));
  }

  async revokeTrustedDevice(userId: string, id: string) {
    const row = await this.prisma.trustedDevice.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundException('信任设备不存在');
    await this.prisma.trustedDevice.update({ where: { id }, data: { revokedAt: new Date() } });
    return { ok: true };
  }

  async revokeAllTrustedDevices(userId: string) {
    await this.prisma.trustedDevice.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  }

  // ---------- 个人 TOTP 绑定 ----------

  async totpStatus(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('用户不存在');
    const codes = parseRecoveryCodes(user.totpRecoveryCodes);
    return {
      enabled: !!user.totpEnabledAt && !!user.totpSecret,
      boundAt: user.totpEnabledAt,
      recoveryCodesLeft: codes.filter((c) => !c.usedAt).length,
    };
  }

  async setupTotp(userId: string, account: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('用户不存在');
    if (user.totpEnabledAt) throw new BadRequestException('已绑定验证器，如需重新绑定请联系管理员解绑');
    const secret = generateTotpSecret();
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: secret, totpEnabledAt: null, totpRecoveryCodes: null },
    });
    return { secret, otpauthUrl: buildOtpauthUrl(secret, account) };
  }

  async enableTotp(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('用户不存在');
    if (user.totpEnabledAt) throw new BadRequestException('验证器已启用');
    if (!user.totpSecret) throw new BadRequestException('请先生成绑定密钥');
    const result = verifyTotpCode(user.totpSecret, code);
    if (!result.ok) throw new BadRequestException('动态码不正确，请核对验证器时间后重试');
    const recoveryCodes = generateRecoveryCodes();
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        totpEnabledAt: new Date(),
        totpLastStep: result.step ?? totpStep(),
        totpRecoveryCodes: JSON.stringify(recoveryCodes.map((c) => ({ hash: hashRecoveryCode(c), usedAt: null }))),
      },
    });
    return { recoveryCodes };
  }

  /** 管理员解绑：清空密钥与恢复码，用户下次登录重新绑定 */
  async resetTotp(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('用户不存在');
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: null, totpEnabledAt: null, totpRecoveryCodes: null, totpLastStep: null },
    });
    await this.prisma.loginChallenge.updateMany({
      where: { userId, mode: { in: [CHALLENGE_MODE.TOTP, CHALLENGE_MODE.TOTP_ENROLL] }, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    return { ok: true };
  }

  // ---------- 内部实现 ----------

  private codeResponse(code: string) {
    return {
      sent: true,
      resendAfterSeconds: Math.floor(EMAIL_RESEND_INTERVAL_MS / 1000),
      expiresInSeconds: Math.floor(EMAIL_TTL_MS / 1000),
      // 未配置 SMTP 时（内测/演示）直接回显，便于无法收信的环境完成验证
      devCode: this.settings.smtpConfigured() ? undefined : code,
    };
  }

  private async issueSlider(user: any, meta: RequestMeta, fallbackReason?: string) {
    const challenge = createSliderChallenge();
    const { token } = await this.createChallenge(
      user.id,
      CHALLENGE_MODE.SLIDER,
      String(challenge.targetX),
      SLIDER_TTL_MS,
      3,
      meta,
    );
    return {
      requiresVerification: true as const,
      mode: 'SLIDER' as const,
      challengeId: token,
      expiresInSeconds: Math.floor(SLIDER_TTL_MS / 1000),
      slider: sliderPayload(challenge),
      fallbackReason,
    };
  }

  private async issueEmailCode(user: any, meta: RequestMeta) {
    const code = generateEmailCode();
    const trustedDeviceDays = await this.settings.getNumber('trustedDeviceDays');
    const { token, row } = await this.createChallenge(
      user.id,
      CHALLENGE_MODE.EMAIL_CODE,
      hashToken(code),
      EMAIL_TTL_MS,
      5,
      meta,
    );
    // 首次发送即计入频率限制，避免紧接着立即重发
    await this.prisma.loginChallenge.update({
      where: { id: row.id },
      data: { sendCount: 1, lastSentAt: new Date() },
    });
    await this.sendCodeMail(user, code);
    return {
      requiresVerification: true as const,
      mode: 'EMAIL_CODE' as const,
      challengeId: token,
      expiresInSeconds: Math.floor(EMAIL_TTL_MS / 1000),
      maskedEmail: maskEmail(user.email),
      trustedDeviceDays,
      ...this.codeResponse(code),
    };
  }

  private async issueTotp(user: any, meta: RequestMeta) {
    const { token } = await this.createChallenge(user.id, CHALLENGE_MODE.TOTP, null, TOTP_TTL_MS, 5, meta);
    return {
      requiresVerification: true as const,
      mode: 'TOTP' as const,
      challengeId: token,
      expiresInSeconds: Math.floor(TOTP_TTL_MS / 1000),
      maskedEmail: maskEmail(user.email),
    };
  }

  private async issueTotpEnroll(user: any, meta: RequestMeta) {
    const secret = generateTotpSecret();
    const { token } = await this.createChallenge(
      user.id,
      CHALLENGE_MODE.TOTP_ENROLL,
      secret,
      ENROLL_TTL_MS,
      5,
      meta,
    );
    return {
      requiresTotpSetup: true as const,
      enrollToken: token,
      secret,
      otpauthUrl: buildOtpauthUrl(secret, user.email),
      expiresInSeconds: Math.floor(ENROLL_TTL_MS / 1000),
    };
  }

  private async sendCodeMail(user: any, code: string) {
    await this.mail.enqueue({
      toEmail: user.email,
      template: 'loginCode',
      data: { name: user.name, code, minutes: Math.floor(EMAIL_TTL_MS / 60000) },
    });
  }

  private async createChallenge(
    userId: string,
    mode: string,
    secret: string | null,
    ttlMs: number,
    maxAttempts: number,
    meta: RequestMeta,
  ) {
    const token = randomToken(24);
    const row = await this.prisma.loginChallenge.create({
      data: {
        userId,
        mode,
        tokenHash: hashToken(token),
        secret,
        maxAttempts,
        expiresAt: new Date(Date.now() + ttlMs),
        ip: meta.ip,
      },
    });
    // 顺带清理一天前的过期挑战，避免表无限增长
    await this.prisma.loginChallenge
      .deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 86400_000) } } })
      .catch(() => undefined);
    return { token, row };
  }

  private async findChallenge(rawId: string) {
    if (!rawId) throw new BadRequestException('验证信息缺失，请重新登录');
    const row = await this.prisma.loginChallenge.findUnique({ where: { tokenHash: hashToken(rawId) } });
    if (!row || row.consumedAt || row.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('验证已失效，请重新登录');
    }
    return row;
  }

  private async consume(id: string) {
    const updated = await this.prisma.loginChallenge.updateMany({
      where: { id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (updated.count === 0) throw new BadRequestException('验证已失效，请重新登录');
  }

  /** 记录一次失败；超过挑战尝试次数后作废挑战 */
  private async failChallenge(challenge: { id: string; attempts: number; maxAttempts: number; userId: string }, message: string) {
    const attempts = challenge.attempts + 1;
    const consumed = attempts >= challenge.maxAttempts;
    await this.prisma.loginChallenge.update({
      where: { id: challenge.id },
      data: { attempts, ...(consumed ? { consumedAt: new Date() } : {}) },
    });
    this.markFail(challenge.userId);
    return new BadRequestException({
      code: consumed ? 'VERIFICATION_LOCKED' : 'VERIFICATION_FAILED',
      message: consumed ? `${message}，本次验证已失效，请重新登录` : `${message}（剩余 ${challenge.maxAttempts - attempts} 次）`,
    });
  }

  private assertNotBlocked(userId: string) {
    const entry = this.fails.get(userId);
    if (!entry) return;
    if (Date.now() - entry.firstAt > VERIFY_FAIL_WINDOW_MS) {
      this.fails.delete(userId);
      return;
    }
    if (entry.count >= VERIFY_MAX_FAILS) {
      throw new HttpException('验证失败次数过多，请 15 分钟后再试', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private markFail(userId: string) {
    const entry = this.fails.get(userId);
    if (!entry || Date.now() - entry.firstAt > VERIFY_FAIL_WINDOW_MS) {
      this.fails.set(userId, { count: 1, firstAt: Date.now() });
    } else {
      entry.count += 1;
    }
  }

  private async createTrustedDevice(userId: string, meta: RequestMeta) {
    const days = await this.settings.getNumber('trustedDeviceDays');
    const token = randomToken(48);
    const expiresAt = new Date(Date.now() + Math.max(1, days) * 86400_000);
    await this.prisma.trustedDevice.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        expiresAt,
        userAgent: meta.userAgent?.slice(0, 200),
        ip: meta.ip,
        lastUsedAt: new Date(),
      },
    });
    return { token, expiresAt };
  }

  private async checkTrustedDevice(userId: string, token: string) {
    const row = await this.prisma.trustedDevice.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!row || row.userId !== userId || row.revokedAt || row.expiresAt.getTime() < Date.now()) return null;
    await this.prisma.trustedDevice.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
    return row;
  }

  private async consumeRecoveryCode(userId: string, raw: string) {
    const normalized = normalizeRecoveryCode(raw);
    if (normalized.length !== 10) return false;
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.totpRecoveryCodes) return false;
    const codes = parseRecoveryCodes(user.totpRecoveryCodes);
    const target = hashRecoveryCode(raw);
    const index = codes.findIndex((c) => c.hash === target && !c.usedAt);
    if (index < 0) return false;
    codes[index] = { hash: codes[index].hash, usedAt: new Date().toISOString() };
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpRecoveryCodes: JSON.stringify(codes) },
    });
    return true;
  }
}
