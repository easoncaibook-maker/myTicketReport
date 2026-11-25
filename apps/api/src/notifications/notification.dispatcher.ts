import { Inject, Injectable, Logger } from '@nestjs/common';
import { NOTIFICATION_CHANNELS, NotificationChannel, NotificationEvent } from './notification.types';

@Injectable()
export class NotificationDispatcher {
  private readonly logger = new Logger(NotificationDispatcher.name);

  constructor(
    @Inject(NOTIFICATION_CHANNELS) private readonly channels: NotificationChannel[],
  ) {}

  /**
   * 业务代码只依赖该分发器；新增渠道（如企业微信）只需注册新的 NotificationChannel。
   */
  async dispatch(event: NotificationEvent): Promise<void> {
    const recipients = new Map<string, any>();
    for (const r of event.recipients) {
      if (!r.userId || recipients.has(r.userId)) continue;
      recipients.set(r.userId, r);
    }
    if (recipients.size === 0) return;
    const normalized: NotificationEvent = { ...event, recipients: [...recipients.values()] };

    const results = await Promise.allSettled(
      this.channels.map(async (channel) => {
        try {
          await channel.send(normalized);
        } catch (e) {
          this.logger.warn(`通知渠道 ${channel.key} 发送失败: ${(e as Error).message}`);
          throw e;
        }
      }),
    );
    if (results.some((r) => r.status === 'rejected')) {
      this.logger.warn(`通知事件 ${event.type} 部分渠道失败，不影响业务主流程`);
    }
  }
}
