import type { Firestore } from 'firebase-admin/firestore';
import { AgentRunSchema, type AgentRun, type AgentRunRepository } from '@mediforce/platform-core';

export class FirestoreAgentRunRepository implements AgentRunRepository {
  private readonly collectionName = 'agentRuns';

  constructor(private readonly db: Firestore) {}

  async create(run: AgentRun): Promise<AgentRun> {
    await this.db.collection(this.collectionName).doc(run.id).set(run);
    return run;
  }

  async getById(runId: string): Promise<AgentRun | null> {
    const snap = await this.db.collection(this.collectionName).doc(runId).get();
    if (!snap.exists) return null;
    return AgentRunSchema.parse(snap.data());
  }

  async getByInstanceId(instanceId: string): Promise<AgentRun[]> {
    const snap = await this.db
      .collection(this.collectionName)
      .where('processInstanceId', '==', instanceId)
      .orderBy('startedAt', 'desc')
      .get();
    return snap.docs.map((d) => AgentRunSchema.parse(d.data()));
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
