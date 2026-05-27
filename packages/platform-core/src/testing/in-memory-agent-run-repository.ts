import { AgentRunSchema, type AgentRun } from '../schemas/agent-run.js';
import type { AgentRunRepository } from '../interfaces/agent-run-repository.js';
import type { ProcessInstanceRepository } from '../interfaces/process-instance-repository.js';

/**
 * In-memory implementation of AgentRunRepository for testing.
 *
 * Mirrors the Firestore + Postgres backends — every write parses through
 * Zod (parity with both real backends, ADR-0001 Implementation pattern 2).
 *
 * Namespace-scoped reads (`getByIdInNamespaces`,
 * `getByInstanceIdInNamespaces`) resolve the parent run's namespace via
 * the injected `ProcessInstanceRepository`. Tests that don't exercise
 * those paths may omit the dep.
 */
export class InMemoryAgentRunRepository implements AgentRunRepository {
  private runs: AgentRun[] = [];

  constructor(private readonly parents?: ProcessInstanceRepository) {}

  async create(run: AgentRun): Promise<AgentRun> {
    const parsed = AgentRunSchema.parse(run);
    this.runs.push(parsed);
    return parsed;
  }

  async getById(runId: string): Promise<AgentRun | null> {
    return this.runs.find((r) => r.id === runId) ?? null;
  }

  async getByIdInNamespaces(
    runId: string,
    allowed: readonly string[],
  ): Promise<AgentRun | null> {
    const run = await this.getById(runId);
    if (run === null) return null;
    if (this.parents === undefined) {
      throw new Error(
        'InMemoryAgentRunRepository: ProcessInstanceRepository required for namespace-scoped methods',
      );
    }
    const parent = await this.parents.getById(run.processInstanceId);
    if (!parent || typeof parent.namespace !== 'string') return null;
    return allowed.includes(parent.namespace) ? run : null;
  }

  async getByInstanceId(instanceId: string): Promise<AgentRun[]> {
    return this.runs
      .filter((r) => r.processInstanceId === instanceId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async getByInstanceIdInNamespaces(
    instanceId: string,
    allowed: readonly string[],
  ): Promise<AgentRun[]> {
    if (this.parents === undefined) {
      throw new Error(
        'InMemoryAgentRunRepository: ProcessInstanceRepository required for namespace-scoped methods',
      );
    }
    const parent = await this.parents.getById(instanceId);
    if (!parent || typeof parent.namespace !== 'string') return [];
    if (!allowed.includes(parent.namespace)) return [];
    return this.getByInstanceId(instanceId);
  }

  async getAll(limitN = 100): Promise<AgentRun[]> {
    return [...this.runs]
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, limitN);
  }

  /** Test helper: clear all stored runs */
  clear(): void {
    this.runs = [];
  }
}
