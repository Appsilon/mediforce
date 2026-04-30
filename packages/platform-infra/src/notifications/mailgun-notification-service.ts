import type { NotificationService, NotificationEvent, NotificationTarget, SendEmailFn } from '@mediforce/platform-core';

export class MailgunNotificationService implements NotificationService {
  constructor(private readonly sendEmail: SendEmailFn) {}

  async send(event: NotificationEvent, targets: NotificationTarget[]): Promise<void> {
    const emailTargets = targets.filter((t) => t.channel === 'email');
    if (emailTargets.length === 0) return;

    await Promise.allSettled(
      emailTargets.map((t) =>
        this.sendEmail({
          to: [t.address],
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
