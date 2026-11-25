import { Global, Injectable, Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULTS: Record<string, string> = {
  siteName: '运维工单系统',
  reopenWindowDays: '7',
  maxAttachmentMb: '20',
  emailEnabled: 'true',
};

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(key: string): Promise<string> {
    const row = await this.prisma.appSetting.findUnique({ where: { key } });
    return row?.value ?? DEFAULTS[key] ?? '';
  }

  async getNumber(key: string): Promise<number> {
    const value = await this.get(key);
    const n = Number(value);
    return Number.isFinite(n) ? n : Number(DEFAULTS[key] || 0);
  }

  async getAll() {
    const rows = await this.prisma.appSetting.findMany();
    const map: Record<string, string> = { ...DEFAULTS };
    for (const row of rows) map[row.key] = row.value;
    return {
      siteName: map.siteName,
      reopenWindowDays: Number(map.reopenWindowDays),
      maxAttachmentMb: Number(map.maxAttachmentMb),
      emailEnabled: map.emailEnabled === 'true',
    };
  }

  async updateMany(values: Record<string, unknown>, actorId: string) {
    const allowed = ['siteName', 'reopenWindowDays', 'maxAttachmentMb', 'emailEnabled'];
    const entries = Object.entries(values).filter(([k, v]) => allowed.includes(k) && v !== undefined);
    for (const [key, value] of entries) {
      const str = typeof value === 'boolean' ? String(value) : String(value);
      await this.prisma.appSetting.upsert({
        where: { key },
        create: { key, value: str, updatedBy: actorId },
        update: { value: str, updatedBy: actorId },
      });
    }
    return this.getAll();
  }

  smtpConfigured(): boolean {
    return Boolean(process.env.SMTP_HOST);
  }
}

@Global()
@Module({
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
