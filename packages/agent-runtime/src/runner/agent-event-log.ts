import type { AgentEvent } from '@mediforce/platform-core';
import type { EmitPayload } from '../interfaces/step-executor-plugin';

export interface AgentEventLog {
  write(instanceId: string, stepId: string, event: EmitPayload): Promise<void>;
  getEvents(instanceId: string, stepId: string): AgentEvent[]; // synchronous — reads in-memory cache
  getPartialWork(instanceId: string, stepId: string): AgentEvent[]; // alias for getEvents, named for fallback handler use
}
