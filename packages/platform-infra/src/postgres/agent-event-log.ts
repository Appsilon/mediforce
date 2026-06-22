import type { AgentEvent } from '@mediforce/platform-core';
import type { PostgresProcessInstanceRepository } from './repositories/process-instance-repository';

// EmitPayload-shaped input mirroring the agent-runtime interface (kept here
// inline so platform-infra doesn't need a circular dep on agent-runtime).
type EmitPayload = Omit<AgentEvent, 'id' | 'sequence' | 'processInstanceId' | 'stepId'>;

interface AgentEventLog {
  write(instanceId: string, stepId: string, event: EmitPayload): Promise<void>;
  getEvents(instanceId: string, stepId: string): AgentEvent[];
  getPartialWork(instanceId: string, stepId: string): AgentEvent[];
}

/**
 * Postgres-backed agent event log. Writes go to the `agent_events` table via
 * PostgresProcessInstanceRepository.addAgentEvent and are also cached in
 * memory so synchronous reads (`getEvents` / `getPartialWork`, used by
 * fallback handlers) stay free.
 *
 * Per-step writes are serialized through a promise chain so concurrent emits
 * cannot race on `existing.length` and produce duplicate `sequence` values.
 */
export class PostgresAgentEventLog implements AgentEventLog {
  private cache = new Map<string, AgentEvent[]>();
  private writeChains = new Map<string, Promise<unknown>>();

  constructor(private readonly instanceRepo: PostgresProcessInstanceRepository) {}

  async write(instanceId: string, stepId: string, event: EmitPayload): Promise<void> {
    const key = `${instanceId}:${stepId}`;
    const prev = this.writeChains.get(key) ?? Promise.resolve();
    const next = prev.then(() => this.writeImpl(key, instanceId, stepId, event));
    // Tail swallows rejections so one failed write doesn't poison the chain.
    this.writeChains.set(
      key,
      next.catch(() => undefined),
    );
    return next;
  }

  private async writeImpl(key: string, instanceId: string, stepId: string, event: EmitPayload): Promise<void> {
    const existing = this.cache.get(key) ?? [];
    const agentEvent: AgentEvent = {
      id: crypto.randomUUID(),
      processInstanceId: instanceId,
      stepId,
      sequence: existing.length,
      ...event,
    };
    const stored = await this.instanceRepo.addAgentEvent(instanceId, agentEvent);
    existing.push(stored);
    this.cache.set(key, existing);
  }

  getEvents(instanceId: string, stepId: string): AgentEvent[] {
    return this.cache.get(`${instanceId}:${stepId}`) ?? [];
  }

  getPartialWork(instanceId: string, stepId: string): AgentEvent[] {
    return this.getEvents(instanceId, stepId);
  }
}
