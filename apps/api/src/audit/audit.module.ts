import { Global, Injectable, Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(actorId: string, action: string, targetType: string, targetId: string, detail?: unknown) {
    await this.prisma.auditLog.create({
      data: {
        actorId,
        action,
        targetType,
        targetId,
        detail: detail === undefined ? null : JSON.stringify(detail),
      },
    });
  }
}

@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
