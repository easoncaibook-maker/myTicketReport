import { Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { MailWorker } from './mail.worker';

@Module({
  providers: [MailService, MailWorker],
  exports: [MailService],
})
export class MailModule {}
