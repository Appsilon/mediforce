import type { AgentRun } from '../schemas/agent-run.js';

/**
 * Storage-layer authorization (ADR-0004): agent runs have no namespace field —
 * workspace is reached via the parent `ProcessInstance`.
 */
export interface AgentRunRepository {
  create(run: AgentRun): Promise<AgentRun>;

  getById(runId: string): Promise<AgentRun | null>;
  getByIdInNamespaces(runId: string, allowed: readonly string[]): Promise<AgentRun | null>;

  getByInstanceId(instanceId: string): Promise<AgentRun[]>;
  getByInstanceIdInNamespaces(instanceId: string, allowed: readonly string[]): Promise<AgentRun[]>;

  getAll(limitN?: number): Promise<AgentRun[]>;
}
