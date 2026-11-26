import { describe, expect, it } from 'vitest';
import { HttpException } from '@nestjs/common';
import { AiRateLimitService } from '../src/ai/rate-limit.service';

describe('AI 接口限流', () => {
  it('超过每分钟次数后返回 429', () => {
    const limiter = new AiRateLimitService();
    for (let i = 0; i < 3; i += 1) limiter.consume('u1', 3);
    try {
      limiter.consume('u1', 3);
      throw new Error('应当被限流');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(429);
      expect((error as any).getResponse().code).toBe('AI_RATE_LIMITED');
    }
  });

  it('按用户独立计数', () => {
    const limiter = new AiRateLimitService();
    limiter.consume('a', 1);
    expect(() => limiter.consume('b', 1)).not.toThrow();
  });
});
