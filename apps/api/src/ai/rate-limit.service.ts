import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

const WINDOW_MS = 60_000;

/** AI 接口限流：进程内滑动窗口，按用户计数；多实例部署需换成共享存储 */
@Injectable()
export class AiRateLimitService {
  private readonly hits = new Map<string, number[]>();

  consume(userId: string, perMinute: number): void {
    const limit = Math.max(1, perMinute);
    const now = Date.now();
    const recent = (this.hits.get(userId) || []).filter((time) => now - time < WINDOW_MS);
    if (recent.length >= limit) {
      this.hits.set(userId, recent);
      throw new HttpException(
        {
          code: 'AI_RATE_LIMITED',
          message: `提问过于频繁，请稍后再试（每分钟最多 ${limit} 次）`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    recent.push(now);
    this.hits.set(userId, recent);
    if (this.hits.size > 5000) this.cleanup(now);
  }

  private cleanup(now: number) {
    for (const [userId, times] of this.hits) {
      if (!times.some((time) => now - time < WINDOW_MS)) this.hits.delete(userId);
    }
  }
}
