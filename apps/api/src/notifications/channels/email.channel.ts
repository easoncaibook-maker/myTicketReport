import { Injectable, Logger } from '@nestjs/common';
import { MailService } from '../../mail/mail.service';
import { SettingsService } from '../../settings/settings.module';
import { NotificationChannel, NotificationEvent } from '../notification.types';

@Injectable()
export class EmailChannel implements NotificationChannel {
  readonly key = 'EMAIL';
  private readonly logger = new Logger(EmailChannel.name);

  constructor(
    private readonly mail: MailService,
    private readonly settings: SettingsService,
  ) {}

  async send(event: NotificationEvent): Promise<void> {
    if (!event.email) return;
    if ((await this.settings.get('emailEnabled')) === 'false') return;
    const recipients = event.recipients.filter((r) => r.emailEnabled && r.email);
    for (const recipient of recipients) {
      await this.mail.enqueue({
        toEmail: recipient.email as string,
        template: event.email.template,
        data: { ...event.email.data, name: recipient.name, link: event.email.data.link },
        ticketId: event.ticketId,
      });
    }
  }
}
