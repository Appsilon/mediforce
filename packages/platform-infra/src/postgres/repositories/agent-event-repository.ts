import type {
  AgentEvent,
  AgentEventRepository,
} from '@mediforce/platform-core';
import type { PostgresProcessInstanceRepository } from './process-instance-repository';

/**
 * Postgres implementation of `AgentEventRepository` — the read port over the
 * `agent_events` table that `PostgresAgentEventLog` writes to.
 *
 * Reads delegate to `PostgresProcessInstanceRepository.getAgentEvents`, which
 * owns the `agent_events` query (events colocated with the parent instance,
 * ordered by `sequence` ASC, each row parsed through `AgentEventSchema`). The
 * optional `afterSequence` cursor is applied here so the SQL building block
 * stays a single shared query.
 *
 * Namespace scoping mirrors the Firestore port: agent events have no namespace
 * column, so the parent `ProcessInstance` is resolved via
 * `getByIdInNamespaces` and out-of-scope reads return `[]`.
 */
export class PostgresAgentEventRepository implements AgentEventRepository {
  constructor(private readonly parents: PostgresProcessInstanceRepository) {}

  async listByInstance(
    instanceId: string,
    afterSequence?: number,
  ): Promise<AgentEvent[]> {
    const events = await this.parents.getAgentEvents(instanceId);
    return filterAfterSequence(events, afterSequence);
  }

  async listByStep(
    instanceId: string,
    stepId: string,
    afterSequence?: number,
  ): Promise<AgentEvent[]> {
    const events = await this.parents.getAgentEvents(instanceId, stepId);
    return filterAfterSequence(events, afterSequence);
  }

  async listByInstanceInNamespaces(
    instanceId: string,
    allowed: readonly string[],
    afterSequence?: number,
  ): Promise<AgentEvent[]> {
    if (!(await this.isInScope(instanceId, allowed))) return [];
    return this.listByInstance(instanceId, afterSequence);
  }

  async listByStepInNamespaces(
    instanceId: string,
    stepId: string,
    allowed: readonly string[],
    afterSequence?: number,
  ): Promise<AgentEvent[]> {
    if (!(await this.isInScope(instanceId, allowed))) return [];
    return this.listByStep(instanceId, stepId, afterSequence);
  }

  private async isInScope(
    instanceId: string,
    allowed: readonly string[],
  ): Promise<boolean> {
    const parent = await this.parents.getByIdInNamespaces(instanceId, allowed);
    return parent !== null;
  }
}

function filterAfterSequence(
  events: AgentEvent[],
  afterSequence: number | undefined,
): AgentEvent[] {
  if (afterSequence === undefined) return events;
  return events.filter((event) => event.sequence > afterSequence);
}
