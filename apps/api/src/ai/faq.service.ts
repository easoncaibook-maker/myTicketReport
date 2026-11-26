import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { FaqVisibility } from '@ticketreport/shared';
import { AuditService } from '../audit/audit.module';
import { PrismaService } from '../prisma/prisma.service';
import { parseFaqText, type ParsedFaqItem } from './faq-import';

export interface FaqInput {
  question: string;
  answer: string;
  keywords?: string | null;
  visibility?: FaqVisibility;
  status?: 'ACTIVE' | 'DISABLED';
  enterpriseId?: string | null;
}

@Injectable()
export class FaqService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async enterpriseNames(ids: Array<string | null>) {
    const unique = Array.from(new Set(ids.filter((id): id is string => !!id)));
    if (!unique.length) return new Map<string, string>();
    const rows = await this.prisma.enterprise.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  async list(query: {
    keyword?: string;
    page?: number;
    pageSize?: number;
    visibility?: string;
    status?: string;
    enterpriseId?: string;
  }) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
    const keyword = (query.keyword || '').trim();
    const where: any = {};
    if (keyword) {
      where.OR = [
        { question: { contains: keyword } },
        { answer: { contains: keyword } },
        { keywords: { contains: keyword } },
      ];
    }
    if (query.visibility) where.visibility = query.visibility;
    if (query.status) where.status = query.status;
    if (query.enterpriseId) where.enterpriseId = query.enterpriseId;

    const [total, rows] = await Promise.all([
      this.prisma.faqEntry.count({ where }),
      this.prisma.faqEntry.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const names = await this.enterpriseNames(rows.map((row) => row.enterpriseId));
    return {
      items: rows.map((row) => ({
        ...row,
        enterpriseName: row.enterpriseId ? names.get(row.enterpriseId) || null : null,
      })),
      total,
      page,
      pageSize,
    };
  }

  private async assertEnterprise(enterpriseId?: string | null) {
    if (!enterpriseId) return;
    const exists = await this.prisma.enterprise.findUnique({ where: { id: enterpriseId } });
    if (!exists) throw new BadRequestException('指定的客户企业不存在');
  }

  async create(actorId: string, input: FaqInput) {
    await this.assertEnterprise(input.enterpriseId);
    const row = await this.prisma.faqEntry.create({
      data: {
        question: input.question.trim(),
        answer: input.answer.trim(),
        keywords: input.keywords?.trim() || null,
        visibility: input.visibility || 'PUBLIC',
        status: input.status || 'ACTIVE',
        enterpriseId: input.enterpriseId || null,
        createdBy: actorId,
      },
    });
    await this.audit.log(actorId, 'FAQ_CREATE', 'FaqEntry', row.id, {
      question: row.question,
      visibility: row.visibility,
      enterpriseId: row.enterpriseId,
    });
    return row;
  }

  async update(actorId: string, id: string, input: Partial<FaqInput>) {
    const existing = await this.prisma.faqEntry.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('FAQ 条目不存在');
    if (input.enterpriseId !== undefined) await this.assertEnterprise(input.enterpriseId);
    const row = await this.prisma.faqEntry.update({
      where: { id },
      data: {
        question: input.question?.trim(),
        answer: input.answer?.trim(),
        keywords: input.keywords === undefined ? undefined : input.keywords?.trim() || null,
        visibility: input.visibility,
        status: input.status,
        enterpriseId: input.enterpriseId === undefined ? undefined : input.enterpriseId || null,
      },
    });
    await this.audit.log(actorId, 'FAQ_UPDATE', 'FaqEntry', id, {
      question: row.question,
      visibility: row.visibility,
      status: row.status,
    });
    return row;
  }

  async remove(actorId: string, id: string) {
    const existing = await this.prisma.faqEntry.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('FAQ 条目不存在');
    await this.prisma.faqEntry.delete({ where: { id } });
    await this.audit.log(actorId, 'FAQ_DELETE', 'FaqEntry', id, { question: existing.question });
    return { ok: true };
  }

  async import(
    actorId: string,
    input: {
      text?: string;
      items?: ParsedFaqItem[];
      visibility?: FaqVisibility;
      enterpriseId?: string | null;
    },
  ) {
    await this.assertEnterprise(input.enterpriseId);
    const parsed = input.items?.length ? input.items : parseFaqText(input.text || '');
    const valid = parsed
      .map((item) => ({ question: item.question.trim(), answer: item.answer.trim() }))
      .filter((item) => item.question && item.answer)
      .slice(0, 200);
    if (!valid.length) {
      throw new BadRequestException('未解析到有效问答，请使用「Q: 问题 / A: 答案」格式，条目间空行分隔');
    }
    for (const item of valid) {
      await this.prisma.faqEntry.create({
        data: {
          question: item.question.slice(0, 200),
          answer: item.answer.slice(0, 5000),
          visibility: input.visibility || 'PUBLIC',
          enterpriseId: input.enterpriseId || null,
          createdBy: actorId,
        },
      });
    }
    await this.audit.log(actorId, 'FAQ_IMPORT', 'FaqEntry', 'bulk', {
      count: valid.length,
      visibility: input.visibility || 'PUBLIC',
      enterpriseId: input.enterpriseId || null,
    });
    return { created: valid.length };
  }
}
