import { Controller, Get } from '@nestjs/common';
import { Public } from './common/decorators';
import { PrismaService } from './prisma/prisma.service';

@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get('health')
  async health() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', db: 'ok', time: new Date().toISOString() };
    } catch (e) {
      return { status: 'ok', db: 'error', message: (e as Error).message };
    }
  }
}
