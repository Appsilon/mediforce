import {
  collection,
  doc,
  getDoc,
  setDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  type Firestore,
} from 'firebase/firestore';
import { AgentRunSchema, type AgentRun, type AgentRunRepository } from '@mediforce/platform-core';

export class FirestoreAgentRunRepository implements AgentRunRepository {
  private readonly collectionName = 'agentRuns';

  constructor(private readonly db: Firestore) {}

  async create(run: AgentRun): Promise<AgentRun> {
    const docRef = doc(this.db, this.collectionName, run.id);
    await setDoc(docRef, run);
    return run;
  }

  async getById(runId: string): Promise<AgentRun | null> {
    const snap = await getDoc(doc(this.db, this.collectionName, runId));
    if (!snap.exists()) return null;
    return AgentRunSchema.parse(snap.data());
  }

  async getByInstanceId(instanceId: string): Promise<AgentRun[]> {
    const q = query(
      collection(this.db, this.collectionName),
      where('processInstanceId', '==', instanceId),
      orderBy('startedAt', 'desc'),
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => AgentRunSchema.parse(d.data()));
  }

  async getAll(limitN = 100): Promise<AgentRun[]> {
    const q = query(
      collection(this.db, this.collectionName),
      orderBy('startedAt', 'desc'),
      limit(limitN),
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => AgentRunSchema.parse(d.data()));
  }
}
