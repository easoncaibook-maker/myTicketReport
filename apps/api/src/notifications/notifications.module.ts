import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { EmailChannel } from './channels/email.channel';
import { InAppChannel } from './channels/in-app.channel';
import { NotificationDispatcher } from './notification.dispatcher';
import { NOTIFICATION_CHANNELS } from './notification.types';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [MailModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationDispatcher,
    InAppChannel,
    EmailChannel,
    {
      provide: NOTIFICATION_CHANNELS,
      inject: [InAppChannel, EmailChannel],
      useFactory: (inApp: InAppChannel, email: EmailChannel) => [inApp, email],
    },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
