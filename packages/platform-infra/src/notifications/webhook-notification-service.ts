import type { NotificationService, NotificationEvent, NotificationTarget } from '@mediforce/platform-core';

export class WebhookNotificationService implements NotificationService {
  async send(event: NotificationEvent, targets: NotificationTarget[]): Promise<void> {
    const webhookTargets = targets.filter((t) => t.channel === 'webhook');
    if (webhookTargets.length === 0) return;

    // Promise.allSettled: fire-and-forget; failures are swallowed (never throw to caller)
    await Promise.allSettled(
      webhookTargets.map((t) =>
        fetch(t.address, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(event),
        }),
      ),
    );
  }
}
