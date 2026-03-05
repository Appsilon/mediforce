import type { AgentEvent } from '@mediforce/platform-core';
import type { EmitPayload } from '../interfaces/agent-plugin.js';
import {
  collection,
  doc,
  setDoc,
  type Firestore,
} from 'firebase/firestore';

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

    // Write to Firestore immediately — no buffering (anti-pattern documented in RESEARCH.md)
    const agentEventsRef = collection(
      doc(this.db, 'processInstances', instanceId),
      'agentEvents',
    );
    await setDoc(doc(agentEventsRef, agentEvent.id), agentEvent);

    // Update in-memory cache
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
