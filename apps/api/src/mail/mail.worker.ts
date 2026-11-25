import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service';

const MAX_ATTEMPTS = 3;

/**
 * 邮件投递 worker：扫描 outbox。
 * 未配置 SMTP 时不做真实投递，标记 SKIPPED_NO_SMTP，便于本地联调。
 */
@Injectable()
export class MailWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MailWorker.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.process(), 15000);
    void this.process();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private smtpConfigured() {
    return Boolean(process.env.SMTP_HOST);
  }

  private transporter() {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 465),
      secure: String(process.env.SMTP_SECURE ?? 'true') === 'true',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
        : undefined,
    });
  }

  async process() {
    if (this.running) return;
    this.running = true;
    try {
      if (!this.smtpConfigured()) {
        const skipped = await this.prisma.emailOutbox.updateMany({
          where: { status: 'PENDING' },
          data: { status: 'SKIPPED_NO_SMTP', lastError: 'SMTP 未配置，邮件保留在本地 outbox' },
        });
        if (skipped.count > 0) {
          this.logger.log(`SMTP 未配置，${skipped.count} 封邮件写入本地 outbox`);
        }
        return;
      }

      const now = new Date();
      const pending = await this.prisma.emailOutbox.findMany({
        where: {
          status: 'PENDING',
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        },
        orderBy: { createdAt: 'asc' },
        take: 20,
      });
      if (pending.length === 0) return;

      const transporter = this.transporter();
      for (const mail of pending) {
        try {
          await transporter.sendMail({
            from: process.env.SMTP_FROM || 'no-reply@example.com',
            to: mail.toEmail,
            subject: mail.subject,
            html: mail.bodyHtml,
            text: mail.bodyText,
          });
          await this.prisma.emailOutbox.update({
            where: { id: mail.id },
            data: { status: 'SENT', sentAt: new Date(), lastError: null },
          });
        } catch (e) {
          const attempts = mail.attempts + 1;
          const failed = attempts >= MAX_ATTEMPTS;
          await this.prisma.emailOutbox.update({
            where: { id: mail.id },
            data: {
              attempts,
              status: failed ? 'FAILED' : 'PENDING',
              lastError: (e as Error).message?.slice(0, 500),
              nextAttemptAt: failed ? null : new Date(Date.now() + attempts * 60_000),
            },
          });
          this.logger.warn(`邮件发送失败(${mail.toEmail}, 第${attempts}次): ${(e as Error).message}`);
        }
      }
    } catch (e) {
      this.logger.error(`邮件 worker 异常: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
