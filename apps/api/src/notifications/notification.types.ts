import type { EmailTemplateName } from '../mail/templates';

export interface NotificationRecipient {
  userId: string;
  email?: string | null;
  name: string;
  inApp?: boolean;
  emailEnabled?: boolean;
}

export interface NotificationEvent {
  type: string;
  title: string;
  body: string;
  ticketId?: string;
  recipients: NotificationRecipient[];
  email?: {
    template: EmailTemplateName;
    data: Record<string, any>;
  };
}

export interface NotificationChannel {
  readonly key: string;
  send(event: NotificationEvent): Promise<void>;
}

export const NOTIFICATION_CHANNELS = 'NOTIFICATION_CHANNELS';
