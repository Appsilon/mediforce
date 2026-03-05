export interface NotificationEvent {
  type: 'task_assigned' | 'agent_escalation';
  processInstanceId: string;
  stepId: string;
  assignedRole: string;
  entityId: string;   // taskId or handoffEntityId
  timestamp: string;
}

export interface NotificationTarget {
  channel: 'email' | 'webhook';
  address: string;
}

export interface NotificationService {
  send(event: NotificationEvent, targets: NotificationTarget[]): Promise<void>;
}
