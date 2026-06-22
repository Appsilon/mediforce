import type { AgentEvent } from '../schemas/agent-event';

/**
 * Storage-layer authorization (ADR-0004): agent events have no namespace
 * field — they're scoped by the parent `ProcessInstance`. Implementations
 * resolve parent namespaces internally via the authorized wrapper.
 *
 * Read-only port: the write side stays inside
 * `@mediforce/agent-runtime` (`FirestoreAgentEventLog`) which embeds its
 * own Firestore writes plus an in-memory cache. Unifying write+read is
 * tracked as post-phase-4 follow-up.
 */
export interface AgentEventRepository {
  /**
   * All events for an instance, sorted by sequence ASC. With `afterSequence`,
   * returns only events with `sequence > afterSequence` (incremental poll).
   */
  listByInstance(instanceId: string, afterSequence?: number): Promise<AgentEvent[]>;
  /**
   * Events for one (instance, step), sorted by sequence ASC. With
   * `afterSequence`, returns only events with `sequence > afterSequence`.
   */
  listByStep(instanceId: string, stepId: string, afterSequence?: number): Promise<AgentEvent[]>;
  /** Events scoped to a parent run in `allowed` namespaces. Out-of-scope → []. */
  listByInstanceInNamespaces(
    instanceId: string,
    allowed: readonly string[],
    afterSequence?: number,
  ): Promise<AgentEvent[]>;
  /** Events for one step, scoped by parent namespace. Out-of-scope → []. */
  listByStepInNamespaces(
    instanceId: string,
    stepId: string,
    allowed: readonly string[],
    afterSequence?: number,
  ): Promise<AgentEvent[]>;
}
