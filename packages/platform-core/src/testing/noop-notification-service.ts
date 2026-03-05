import type { NotificationService, NotificationEvent, NotificationTarget } from '../interfaces/notification-service.js';

export class NoopNotificationService implements NotificationService {
  readonly sent: Array<{ event: NotificationEvent; targets: NotificationTarget[] }> = [];

  async send(event: NotificationEvent, targets: NotificationTarget[]): Promise<void> {
    this.sent.push({ event, targets });
    // No-op: captures calls for test assertions
  }
}
