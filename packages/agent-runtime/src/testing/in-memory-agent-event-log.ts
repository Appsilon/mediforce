import type { AgentEvent } from '@mediforce/platform-core';
import type { AgentEventLog } from '../runner/agent-event-log.js';
import type { EmitPayload } from '../interfaces/agent-plugin.js';

export class InMemoryAgentEventLog implements AgentEventLog {
  private events: AgentEvent[] = [];

  async write(instanceId: string, stepId: string, event: EmitPayload): Promise<void> {
    this.events.push({
      id: crypto.randomUUID(),
      processInstanceId: instanceId,
      stepId,
      sequence: this.events.filter(
        (e) => e.processInstanceId === instanceId && e.stepId === stepId,
      ).length,
      ...event,
    });
  }

  getEvents(instanceId: string, stepId: string): AgentEvent[] {
    return this.events.filter(
      (e) => e.processInstanceId === instanceId && e.stepId === stepId,
    );
  }

  getPartialWork(instanceId: string, stepId: string): AgentEvent[] {
    return this.getEvents(instanceId, stepId);
  }

  /** Test helper */
  getAllEvents(): AgentEvent[] {
    return [...this.events];
  }

  /** Test helper */
  clear(): void {
    this.events = [];
  }
}
