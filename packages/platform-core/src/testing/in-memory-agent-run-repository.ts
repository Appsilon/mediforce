import { AgentRunSchema, type AgentRun, type AgentRunCardStatus } from '../schemas/agent-run';
import type {
  AgentRunRepository,
  ListAgentRunsOptions,
  ListAgentRunsPage,
  AgentRunCardStatusCounts,
} from '../interfaces/agent-run-repository';
import type { ProcessInstanceRepository } from '../interfaces/process-instance-repository';
import {
  encodeAgentRunCursor,
  decodeAgentRunCursor,
} from '../cursors/agent-run-cursor';

const CARD_STATUSES: readonly AgentRunCardStatus[] = ['running', 'completed', 'error', 'flagged'];

// Mirrors cardStatusConditions() in platform-infra's
// PostgresAgentRunRepository — hand-ported, kept in sync manually.
function matchesCardStatus(run: AgentRun, bucket: AgentRunCardStatus): boolean {
  switch (bucket) {
    case 'running':
      return run.status === 'running';
    case 'completed':
      return run.status === 'completed';
    case 'error':
      return run.fallbackReason === 'error' || run.fallbackReason === 'timeout';
    case 'flagged':
      return run.status === 'escalated' || run.status === 'flagged';
  }
}

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
    const parsed = AgentRunSchema.parse(run);
    this.byId.set(parsed.id, parsed);
    return parsed;
  }
  async update(runId: string, updates: Partial<AgentRun>): Promise<void> {
    const current = this.byId.get(runId);
    if (current === undefined) {
      throw new Error(`AgentRun not found: ${runId}`);
    }
    const parsed = AgentRunSchema.parse({
      ...current,
      ...updates,
      id: runId,
      processInstanceId: current.processInstanceId,
    });
    this.byId.set(runId, parsed);
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
    return [...this.byId.values()]
      .filter((r) => r.processInstanceId === instanceId)
      .sort(compareDesc);
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
    const sorted = [...this.byId.values()].sort(compareDesc);
    return limit === undefined ? sorted : sorted.slice(0, limit);
  }

  async list(opts: ListAgentRunsOptions): Promise<ListAgentRunsPage> {
    const kept = opts.namespace === undefined
      ? [...this.byId.values()]
      : await this.filterByResolvedNamespace([...this.byId.values()], (ns) => ns === opts.namespace);
    return this.pageOf(this.applyFilters(kept, opts), opts);
  }

  async listInNamespaces(
    allowed: readonly string[],
    opts: ListAgentRunsOptions,
  ): Promise<ListAgentRunsPage> {
    const allowedSet = new Set(allowed);
    // Intersection semantics (matches every other Authorized*Repository
    // wrapper): `opts.namespace` further narrows *within* `allowed` — a
    // namespace outside the caller's allowed set yields empty, not the
    // caller's other namespaces.
    const kept = await this.filterByResolvedNamespace(
      [...this.byId.values()],
      (ns) => allowedSet.has(ns) && (opts.namespace === undefined || ns === opts.namespace),
    );
    return this.pageOf(this.applyFilters(kept, opts), opts);
  }

  private async filterByResolvedNamespace(
    runs: AgentRun[],
    predicate: (namespace: string) => boolean,
  ): Promise<AgentRun[]> {
    const parents = this.requireParents();
    const kept: AgentRun[] = [];
    for (const run of runs) {
      const parent = await parents.getById(run.processInstanceId);
      if (!parent || typeof parent.namespace !== 'string') continue;
      if (!predicate(parent.namespace)) continue;
      kept.push(run);
    }
    return kept;
  }

  private applyFilters(
    runs: AgentRun[],
    opts: Pick<ListAgentRunsOptions, 'runId' | 'stepId' | 'status' | 'processInstanceIds' | 'cardStatus'>,
  ): AgentRun[] {
    return runs.filter((r) => {
      if (opts.runId !== undefined && r.processInstanceId !== opts.runId) return false;
      if (opts.stepId !== undefined && r.stepId !== opts.stepId) return false;
      if (opts.status !== undefined && r.status !== opts.status) return false;
      if (opts.processInstanceIds !== undefined && !opts.processInstanceIds.includes(r.processInstanceId)) {
        return false;
      }
      if (opts.cardStatus !== undefined && !matchesCardStatus(r, opts.cardStatus)) return false;
      return true;
    });
  }

  async countByCardStatus(
    opts: Pick<ListAgentRunsOptions, 'namespace' | 'processInstanceIds' | 'status'>,
  ): Promise<AgentRunCardStatusCounts> {
    return this.tallyCardStatus(this.applyFilters([...this.byId.values()], opts));
  }

  async countByCardStatusInNamespaces(
    allowed: readonly string[],
    opts: Pick<ListAgentRunsOptions, 'namespace' | 'processInstanceIds' | 'status'>,
  ): Promise<AgentRunCardStatusCounts> {
    const parents = this.requireParents();
    const allowedSet = new Set(allowed);
    const kept: AgentRun[] = [];
    for (const run of this.byId.values()) {
      const parent = await parents.getById(run.processInstanceId);
      if (!parent || typeof parent.namespace !== 'string') continue;
      if (!allowedSet.has(parent.namespace)) continue;
      kept.push(run);
    }
    return this.tallyCardStatus(this.applyFilters(kept, opts));
  }

  private tallyCardStatus(runs: AgentRun[]): AgentRunCardStatusCounts {
    const counts: AgentRunCardStatusCounts = { total: 0, running: 0, completed: 0, error: 0, flagged: 0 };
    for (const run of runs) {
      counts.total++;
      for (const bucket of CARD_STATUSES) {
        if (matchesCardStatus(run, bucket)) counts[bucket]++;
      }
    }
    return counts;
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
