import type { Firestore } from 'firebase-admin/firestore';
import {
  AgentRunSchema,
  type AgentRun,
  type AgentRunRepository,
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
}
