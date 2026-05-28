import type { Firestore, Query } from 'firebase-admin/firestore';
import {
  AgentRunSchema,
  encodeAgentRunCursor,
  decodeAgentRunCursor,
  type AgentRun,
  type AgentRunRepository,
  type ListAgentRunsOptions,
  type ListAgentRunsPage,
  type ProcessInstanceRepository,
} from '@mediforce/platform-core';

export class FirestoreAgentRunRepository implements AgentRunRepository {
  private readonly collectionName = 'agentRuns';

  constructor(
    private readonly db: Firestore,
    private readonly parents: ProcessInstanceRepository,
  ) {}

  async create(run: AgentRun): Promise<AgentRun> {
    await this.db.collection(this.collectionName).doc(run.id).set(run);
    return run;
  }

  async getById(runId: string): Promise<AgentRun | null> {
    const snap = await this.db.collection(this.collectionName).doc(runId).get();
    if (!snap.exists) return null;
    return AgentRunSchema.parse(snap.data());
  }

  async getByIdInNamespaces(
    runId: string,
    allowed: readonly string[],
  ): Promise<AgentRun | null> {
    const run = await this.getById(runId);
    if (run === null) return null;
    const parent = await this.parents.getById(run.processInstanceId);
    if (!parent || typeof parent.namespace !== 'string') return null;
    return allowed.includes(parent.namespace) ? run : null;
  }

  async getByInstanceId(instanceId: string): Promise<AgentRun[]> {
    const snap = await this.db
      .collection(this.collectionName)
      .where('processInstanceId', '==', instanceId)
      .orderBy('startedAt', 'desc')
      .get();
    return snap.docs.map((d) => AgentRunSchema.parse(d.data()));
  }

  async getByInstanceIdInNamespaces(
    instanceId: string,
    allowed: readonly string[],
  ): Promise<AgentRun[]> {
    const parent = await this.parents.getById(instanceId);
    if (!parent || typeof parent.namespace !== 'string') return [];
    if (!allowed.includes(parent.namespace)) return [];
    return this.getByInstanceId(instanceId);
  }

  async getAll(limitN = 100): Promise<AgentRun[]> {
    const snap = await this.db
      .collection(this.collectionName)
      .orderBy('startedAt', 'desc')
      .limit(limitN)
      .get();
    return snap.docs.map((d) => AgentRunSchema.parse(d.data()));
  }

  async list(opts: ListAgentRunsOptions): Promise<ListAgentRunsPage> {
    const page = await this.fetchPage(opts);
    return this.toPage(page, opts.limit);
  }

  async listInNamespaces(
    allowed: readonly string[],
    opts: ListAgentRunsOptions,
  ): Promise<ListAgentRunsPage> {
    // Agent runs carry no namespace field; the parent ProcessInstance owns
    // workspace membership. Over-fetch by 2x to absorb namespace-filter
    // attrition without paging twice for the common "all my workspace" view.
    const allowedSet = new Set(allowed);
    const raw = await this.fetchPage({ ...opts, limit: opts.limit * 2 });
    const kept: AgentRun[] = [];
    for (const run of raw) {
      const parent = await this.parents.getById(run.processInstanceId);
      if (!parent || typeof parent.namespace !== 'string') continue;
      if (!allowedSet.has(parent.namespace)) continue;
      kept.push(run);
      if (kept.length >= opts.limit + 1) break;
    }
    return this.toPage(kept, opts.limit);
  }

  private async fetchPage(opts: ListAgentRunsOptions): Promise<AgentRun[]> {
    // Single explicit orderBy — Firestore tiebreaks ties on `__name__`
    // implicitly. Adding a second orderBy('id') would force a composite
    // index for the `agentRuns` collection and the `(processInstanceId,
    // startedAt, id)` slice; keyset stability via a DocumentSnapshot
    // cursor gives the same guarantees without the index requirement.
    let q: Query = this.db.collection(this.collectionName).orderBy('startedAt', 'desc');
    if (opts.runId !== undefined) {
      q = q.where('processInstanceId', '==', opts.runId);
    }
    if (opts.stepId !== undefined) {
      q = q.where('stepId', '==', opts.stepId);
    }
    if (opts.cursor !== undefined) {
      const cur = decodeAgentRunCursor(opts.cursor);
      if (cur !== null) {
        // Resolve the cursor doc so Firestore can apply its native
        // tie-break on `__name__` after `startedAt`. One extra read per
        // page in exchange for zero composite-index ops.
        const cursorSnap = await this.db.collection(this.collectionName).doc(cur.id).get();
        if (cursorSnap.exists) q = q.startAfter(cursorSnap);
      }
    }
    // +1 so we can detect "more pages" without a second query.
    const snap = await q.limit(opts.limit + 1).get();
    return snap.docs.map((d) => AgentRunSchema.parse(d.data()));
  }

  private toPage(runs: readonly AgentRun[], limit: number): ListAgentRunsPage {
    const hasMore = runs.length > limit;
    const items = hasMore ? runs.slice(0, limit) : [...runs];
    const last = items[items.length - 1];
    return {
      items,
      ...(hasMore && last !== undefined
        ? { nextCursor: encodeAgentRunCursor(last.startedAt, last.id) }
        : {}),
    };
  }
}
