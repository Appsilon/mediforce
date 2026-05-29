import type { AgentEvent } from '@mediforce/platform-core';
import type { EmitPayload } from '../interfaces/agent-plugin';
import type { Firestore } from 'firebase-admin/firestore';

export interface AgentEventLog {
  write(instanceId: string, stepId: string, event: EmitPayload): Promise<void>;
  getEvents(instanceId: string, stepId: string): AgentEvent[]; // synchronous — reads in-memory cache
  getPartialWork(instanceId: string, stepId: string): AgentEvent[]; // alias for getEvents, named for fallback handler use
}

// FirestoreAgentEventLog: writes to Firestore immediately + maintains in-memory cache.
//
// Per-step writes are serialized through a promise chain so concurrent emits (e.g. the
// fire-and-forget per-line activity events fed by ScriptContainerPlugin) cannot race
// on `existing.length` and produce duplicate `sequence` values. Each `write()` returns a
// promise that resolves only after its slot in the chain has been written; awaiting the
// final emit therefore waits for all in-flight emits to land in order.
//
// Firestore path: processInstances/{instanceId}/agentEvents/{eventId}
// (mirrors stepExecutions subcollection pattern from Phase 2)
export class FirestoreAgentEventLog implements AgentEventLog {
  private cache = new Map<string, AgentEvent[]>(); // key: `${instanceId}:${stepId}`
  private writeChains = new Map<string, Promise<unknown>>(); // key: same as cache; tail of the per-step write queue

  constructor(private readonly db: Firestore) {}

  async write(instanceId: string, stepId: string, event: EmitPayload): Promise<void> {
    const key = `${instanceId}:${stepId}`;
    const prev = this.writeChains.get(key) ?? Promise.resolve();
    const next = prev.then(() => this.writeImpl(key, instanceId, stepId, event));
    // Store a tail that swallows rejections so a single failed write doesn't poison
    // the chain for every subsequent emit. The original `next` (which propagates errors)
    // is what we return to the caller.
    this.writeChains.set(key, next.catch(() => undefined));
    return next;
  }

  private async writeImpl(
    key: string,
    instanceId: string,
    stepId: string,
    event: EmitPayload,
  ): Promise<void> {
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
