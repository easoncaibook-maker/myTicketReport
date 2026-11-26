import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailTemplateName, renderEmail } from './templates';

@Injectable()
export class MailService {
  constructor(private readonly prisma: PrismaService) {}

  async enqueue(input: {
    toEmail: string;
    template: EmailTemplateName;
    data: Record<string, any>;
    ticketId?: string;
  }) {
    const rendered = renderEmail(input.template, input.data);
    return this.prisma.emailOutbox.create({
      data: {
        toEmail: input.toEmail,
        subject: rendered.subject,
        bodyHtml: rendered.html,
        bodyText: rendered.text,
        template: input.template,
        ticketId: input.ticketId ?? null,
      },
    });
  }

  async recent(limit = 50, withBody = false) {
    return this.prisma.emailOutbox.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        toEmail: true,
        subject: true,
        template: true,
        status: true,
        attempts: true,
        lastError: true,
        createdAt: true,
        sentAt: true,
        ...(withBody ? { bodyText: true } : {}),
      },
    });
  }
}
