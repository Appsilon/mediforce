import type { AgentRun } from '../schemas/agent-run.js';
import type {
  AgentRunRepository,
  ListAgentRunsOptions,
  ListAgentRunsPage,
} from '../interfaces/agent-run-repository.js';
import type { ProcessInstanceRepository } from '../interfaces/process-instance-repository.js';
import {
  encodeAgentRunCursor,
  decodeAgentRunCursor,
} from '../cursors/agent-run-cursor.js';

/**
 * Comparator: startedAt DESC then id DESC. Same ordering in-memory and
 * Firestore so cursor semantics agree across backends.
 */
function compareDesc(a: AgentRun, b: AgentRun): number {
  if (a.startedAt !== b.startedAt) return a.startedAt < b.startedAt ? 1 : -1;
  if (a.id !== b.id) return a.id < b.id ? 1 : -1;
  return 0;
}

export class InMemoryAgentRunRepository implements AgentRunRepository {
  private readonly byId = new Map<string, AgentRun>();

  constructor(private readonly parents?: ProcessInstanceRepository) {}

  async create(run: AgentRun): Promise<AgentRun> {
    this.byId.set(run.id, run);
    return run;
  }
  async getById(runId: string): Promise<AgentRun | null> {
    return this.byId.get(runId) ?? null;
  }
  async getByIdInNamespaces(
    runId: string,
    allowed: readonly string[],
  ): Promise<AgentRun | null> {
    const run = this.byId.get(runId);
    if (!run) return null;
    const parent = await this.requireParents().getById(run.processInstanceId);
    if (!parent || typeof parent.namespace !== 'string') return null;
    return allowed.includes(parent.namespace) ? run : null;
  }
  async getByInstanceId(instanceId: string): Promise<AgentRun[]> {
    return [...this.byId.values()].filter((r) => r.processInstanceId === instanceId);
  }
  async getByInstanceIdInNamespaces(
    instanceId: string,
    allowed: readonly string[],
  ): Promise<AgentRun[]> {
    const parent = await this.requireParents().getById(instanceId);
    if (!parent || typeof parent.namespace !== 'string') return [];
    if (!allowed.includes(parent.namespace)) return [];
    return this.getByInstanceId(instanceId);
  }
  async getAll(limit?: number): Promise<AgentRun[]> {
    const all = [...this.byId.values()];
    return limit === undefined ? all : all.slice(0, limit);
  }

  async list(opts: ListAgentRunsOptions): Promise<ListAgentRunsPage> {
    return this.pageOf(this.applyFilters([...this.byId.values()], opts), opts);
  }

  async listInNamespaces(
    allowed: readonly string[],
    opts: ListAgentRunsOptions,
  ): Promise<ListAgentRunsPage> {
    const parents = this.requireParents();
    const allowedSet = new Set(allowed);
    const kept: AgentRun[] = [];
    for (const run of this.byId.values()) {
      const parent = await parents.getById(run.processInstanceId);
      if (!parent || typeof parent.namespace !== 'string') continue;
      if (!allowedSet.has(parent.namespace)) continue;
      kept.push(run);
    }
    return this.pageOf(this.applyFilters(kept, opts), opts);
  }

  private applyFilters(runs: AgentRun[], opts: ListAgentRunsOptions): AgentRun[] {
    return runs.filter((r) => {
      if (opts.runId !== undefined && r.processInstanceId !== opts.runId) return false;
      if (opts.stepId !== undefined && r.stepId !== opts.stepId) return false;
      return true;
    });
  }

  private pageOf(runs: AgentRun[], opts: ListAgentRunsOptions): ListAgentRunsPage {
    const sorted = [...runs].sort(compareDesc);
    const after = opts.cursor !== undefined ? decodeAgentRunCursor(opts.cursor) : null;
    const sliced = after === null
      ? sorted
      : sorted.filter((r) =>
          r.startedAt < after.startedAt
          || (r.startedAt === after.startedAt && r.id < after.id),
        );
    const items = sliced.slice(0, opts.limit);
    const last = items[items.length - 1];
    const hasMore = sliced.length > items.length;
    return {
      items,
      ...(hasMore && last !== undefined
        ? { nextCursor: encodeAgentRunCursor(last.startedAt, last.id) }
        : {}),
    };
  }

  private requireParents(): ProcessInstanceRepository {
    if (this.parents === undefined) {
      throw new Error(
        'InMemoryAgentRunRepository: ProcessInstanceRepository required for namespace-scoped methods',
      );
    }
    return this.parents;
  }
}
