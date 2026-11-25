import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { AttachmentsService } from './attachments.service';
import { TicketAccessService } from './ticket.access';
import { AttachmentsController, TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';

@Module({
  imports: [NotificationsModule],
  controllers: [TicketsController, AttachmentsController],
  providers: [TicketsService, TicketAccessService, AttachmentsService],
  exports: [TicketsService, TicketAccessService],
})
export class TicketsModule {}
