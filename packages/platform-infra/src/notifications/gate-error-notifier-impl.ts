import type {
  GateErrorNotifier,
  GateErrorNotification,
  NotificationService,
  NotificationTarget,
} from '@mediforce/platform-core';

/**
 * NotificationGateErrorNotifier: real GateErrorNotifier backed by NotificationService.
 * Replaces NoOpGateErrorNotifier in production.
 * Uses fire-and-forget pattern — gate error notifications never block the caller.
 */
export class NotificationGateErrorNotifier implements GateErrorNotifier {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly notificationTargets: NotificationTarget[],
  ) {}

  async notifyGateError(notification: GateErrorNotification): Promise<void> {
    // Fire-and-forget: gate errors use agent_escalation type as closest match
    this.notificationService
      .send(
        {
          type: 'agent_escalation',
          processInstanceId: notification.instanceId,
          stepId: notification.stepId,
          assignedRole: 'admin', // Gate errors notify admin/process-author
          entityId: notification.instanceId,
          timestamp: notification.timestamp,
        },
        this.notificationTargets,
      )
      .catch((err: unknown) => {
        console.error(`Gate error notification failed (non-fatal): ${err}`);
      });
  }
}
