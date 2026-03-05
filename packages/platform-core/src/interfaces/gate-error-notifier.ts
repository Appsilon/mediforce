export interface GateErrorNotification {
  instanceId: string;
  gateName: string;
  stepId: string;
  error: string;
  timestamp: string;
}

export interface GateErrorNotifier {
  notifyGateError(notification: GateErrorNotification): Promise<void>;
}
