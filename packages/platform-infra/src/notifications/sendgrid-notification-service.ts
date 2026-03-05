import sgMail from '@sendgrid/mail';
import type { NotificationService, NotificationEvent, NotificationTarget } from '@mediforce/platform-core';

export class SendGridNotificationService implements NotificationService {
  constructor(
    private readonly apiKey: string,
    private readonly fromEmail: string,
  ) {
    sgMail.setApiKey(apiKey);
  }

  async send(event: NotificationEvent, targets: NotificationTarget[]): Promise<void> {
    const emailTargets = targets.filter((t) => t.channel === 'email');
    if (emailTargets.length === 0) return;

    // Promise.allSettled: fire-and-forget; failures are swallowed (never throw to caller)
    await Promise.allSettled(
      emailTargets.map((t) =>
        sgMail.send({
          to: t.address,
          from: this.fromEmail,
          subject: this.buildSubject(event),
          text: this.buildBody(event),
        }),
      ),
    );
  }

  private buildSubject(event: NotificationEvent): string {
    switch (event.type) {
      case 'task_assigned':
        return `[Mediforce] Task assigned — step '${event.stepId}'`;
      case 'agent_escalation':
        return `[Mediforce] Agent escalation requires attention — step '${event.stepId}'`;
    }
  }

  private buildBody(event: NotificationEvent): string {
    return [
      `Event: ${event.type}`,
      `Process: ${event.processInstanceId}`,
      `Step: ${event.stepId}`,
      `Role: ${event.assignedRole}`,
      `Entity ID: ${event.entityId}`,
      `Timestamp: ${event.timestamp}`,
    ].join('\n');
  }
}
