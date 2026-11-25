import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import type { ZodTypeAny } from 'zod';

@Injectable()
export class ZodPipe implements PipeTransform {
  constructor(private readonly schema: ZodTypeAny) {}

  transform(value: unknown) {
    const result = this.schema.safeParse(value ?? {});
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      }));
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: '参数校验失败', details });
    }
    return result.data;
  }
}
