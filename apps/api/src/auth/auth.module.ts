import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MailModule } from '../mail/mail.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LoginVerificationService } from './login-verification.service';

@Module({
  imports: [
    MailModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_ACCESS_SECRET') || 'dev-access-secret',
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, LoginVerificationService],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
