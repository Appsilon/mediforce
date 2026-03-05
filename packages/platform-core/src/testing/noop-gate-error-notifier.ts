import type {
  GateErrorNotifier,
  GateErrorNotification,
} from '../interfaces/gate-error-notifier.js';

export class NoOpGateErrorNotifier implements GateErrorNotifier {
  readonly notifications: GateErrorNotification[] = [];

  async notifyGateError(notification: GateErrorNotification): Promise<void> {
    this.notifications.push(notification);
    // No-op: real notification wired in Phase 4 (email/webhook)
    // Stored in `notifications` array for test assertions
  }
}
