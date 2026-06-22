import type { AgentEvent } from '../schemas/agent-event';
import type { AgentEventRepository } from '../interfaces/agent-event-repository';
import type { ProcessInstanceRepository } from '../interfaces/process-instance-repository';

/**
 * In-memory implementation of `AgentEventRepository` for tests.
 * Stores events in an array; reads always re-sort by `sequence ASC` so order
 * doesn't depend on insertion order.
 *
 * Namespace-scoped reads (`*InNamespaces`) resolve the parent run's namespace
 * via the injected `ProcessInstanceRepository`. Tests that don't exercise that
 * path may omit the dep.
 */
export class InMemoryAgentEventRepository implements AgentEventRepository {
  private events: AgentEvent[] = [];

  constructor(private readonly parents?: ProcessInstanceRepository) {}

  /** Test seam: append an event. The real write path lives in `agent-runtime`. */
  async append(event: AgentEvent): Promise<AgentEvent> {
    this.events.push(event);
    return event;
  }

  async listByInstance(instanceId: string, afterSequence?: number): Promise<AgentEvent[]> {
    return this.events
      .filter((e) => e.processInstanceId === instanceId)
      .filter((e) => afterSequence === undefined || e.sequence > afterSequence)
      .slice()
      .sort((a, b) => a.sequence - b.sequence);
  }

  async listByStep(instanceId: string, stepId: string, afterSequence?: number): Promise<AgentEvent[]> {
    return this.events
      .filter((e) => e.processInstanceId === instanceId && e.stepId === stepId)
      .filter((e) => afterSequence === undefined || e.sequence > afterSequence)
      .slice()
      .sort((a, b) => a.sequence - b.sequence);
  }

  async listByInstanceInNamespaces(
    instanceId: string,
    allowed: readonly string[],
    afterSequence?: number,
  ): Promise<AgentEvent[]> {
    if (this.parents === undefined) {
      throw new Error('InMemoryAgentEventRepository: ProcessInstanceRepository required for namespace-scoped methods');
    }
    const parent = await this.parents.getById(instanceId);
    if (!parent || typeof parent.namespace !== 'string') return [];
    if (!allowed.includes(parent.namespace)) return [];
    return this.listByInstance(instanceId, afterSequence);
  }

  async listByStepInNamespaces(
    instanceId: string,
    stepId: string,
    allowed: readonly string[],
    afterSequence?: number,
  ): Promise<AgentEvent[]> {
    if (this.parents === undefined) {
      throw new Error('InMemoryAgentEventRepository: ProcessInstanceRepository required for namespace-scoped methods');
    }
    const parent = await this.parents.getById(instanceId);
    if (!parent || typeof parent.namespace !== 'string') return [];
    if (!allowed.includes(parent.namespace)) return [];
    return this.listByStep(instanceId, stepId, afterSequence);
  }

  /** Test helper: all stored events (insertion order). */
  getAll(): AgentEvent[] {
    return [...this.events];
  }

  /** Test helper: clear all stored events. */
  clear(): void {
    this.events = [];
  }
}
