import type { AgentEvent } from '@mediforce/platform-core';
import type { EmitPayload } from '../interfaces/agent-plugin.js';
import type { Firestore } from 'firebase-admin/firestore';

export interface AgentEventLog {
  write(instanceId: string, stepId: string, event: EmitPayload): Promise<void>;
  getEvents(instanceId: string, stepId: string): AgentEvent[]; // synchronous — reads in-memory cache
  getPartialWork(instanceId: string, stepId: string): AgentEvent[]; // alias for getEvents, named for fallback handler use
}

// FirestoreAgentEventLog: writes to Firestore immediately + maintains in-memory cache
// Firestore path: processInstances/{instanceId}/agentEvents/{eventId}
// (mirrors stepExecutions subcollection pattern from Phase 2)
export class FirestoreAgentEventLog implements AgentEventLog {
  private cache = new Map<string, AgentEvent[]>(); // key: `${instanceId}:${stepId}`

  constructor(private readonly db: Firestore) {}

  async write(instanceId: string, stepId: string, event: EmitPayload): Promise<void> {
    const key = `${instanceId}:${stepId}`;
    const existing = this.cache.get(key) ?? [];
    const agentEvent: AgentEvent = {
      id: crypto.randomUUID(),
      processInstanceId: instanceId,
      stepId,
      sequence: existing.length,
      ...event,
    };

    await this.db
      .collection('processInstances')
      .doc(instanceId)
      .collection('agentEvents')
      .doc(agentEvent.id)
      .set(agentEvent);

    existing.push(agentEvent);
    this.cache.set(key, existing);
  }

  getEvents(instanceId: string, stepId: string): AgentEvent[] {
    return this.cache.get(`${instanceId}:${stepId}`) ?? [];
  }

  getPartialWork(instanceId: string, stepId: string): AgentEvent[] {
    return this.getEvents(instanceId, stepId);
  }
}
