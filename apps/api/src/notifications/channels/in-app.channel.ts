import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationChannel, NotificationEvent } from '../notification.types';

@Injectable()
export class InAppChannel implements NotificationChannel {
  readonly key = 'IN_APP';

  constructor(private readonly prisma: PrismaService) {}

  async send(event: NotificationEvent): Promise<void> {
    const recipients = event.recipients.filter((r) => r.inApp !== false);
    if (recipients.length === 0) return;
    await this.prisma.notification.createMany({
      data: recipients.map((r) => ({
        userId: r.userId,
        type: event.type,
        title: event.title,
        body: event.body,
        ticketId: event.ticketId ?? null,
      })),
    });
  }
}
