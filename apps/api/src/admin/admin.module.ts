import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { AdminController, MetaController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [AuthModule, MailModule],
  controllers: [AdminController, MetaController],
  providers: [AdminService],
})
export class AdminModule {}
