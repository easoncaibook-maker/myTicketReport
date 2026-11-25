import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { basename, extname, join, resolve } from 'path';
import { AuthUser } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.module';
import { TicketAccessService } from './ticket.access';
import { attachmentView } from './ticket.mapper';

const ALLOWED_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.txt', '.log', '.csv', '.zip', '.rar', '.7z',
]);

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TicketAccessService,
    private readonly settings: SettingsService,
  ) {}

  private root() {
    return resolve(process.env.UPLOAD_DIR || join(process.cwd(), 'data', 'uploads'));
  }

  async upload(user: AuthUser, ticketId: string, file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('请选择要上传的文件');
    const ticket = await this.access.findAccessible(ticketId, user);
    const maxMb = await this.settings.getNumber('maxAttachmentMb');
    if (file.size > maxMb * 1024 * 1024) {
      throw new BadRequestException(`单个附件不能超过 ${maxMb}MB`);
    }
    const ext = extname(file.originalname || '').toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      throw new BadRequestException('不支持的文件类型');
    }
    const relativeDir = join(ticket.enterpriseId, ticketId);
    const storedName = `${randomUUID()}${ext}`;
    const absoluteDir = join(this.root(), relativeDir);
    await mkdir(absoluteDir, { recursive: true });
    await writeFile(join(absoluteDir, storedName), file.buffer);

    const attachment = await this.prisma.ticketAttachment.create({
      data: {
        ticketId,
        uploaderId: user.id,
        originalName: basename(file.originalname).slice(0, 200),
        storedPath: join(relativeDir, storedName),
        mimeType: file.mimetype || 'application/octet-stream',
        size: file.size,
      },
    });
    await this.prisma.ticket.update({ where: { id: ticketId }, data: { lastActivityAt: new Date() } });
    return attachmentView(attachment);
  }

  async download(user: AuthUser, attachmentId: string, res: Response) {
    const attachment = await this.prisma.ticketAttachment.findUnique({
      where: { id: attachmentId },
      include: { ticket: { select: { id: true } } },
    });
    if (!attachment) throw new NotFoundException('附件不存在');
    await this.access.findAccessible(attachment.ticketId, user);

    const absolute = resolve(this.root(), attachment.storedPath);
    if (!absolute.startsWith(this.root())) {
      throw new NotFoundException('附件不存在');
    }
    res.download(absolute, attachment.originalName);
  }
}
