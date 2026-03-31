import { doc, getDoc, setDoc, type Firestore } from 'firebase/firestore';
import {
  CronTriggerStateSchema,
  type CronTriggerState,
  type CronTriggerStateRepository,
} from '@mediforce/platform-core';

export class FirestoreCronTriggerStateRepository implements CronTriggerStateRepository {
  private readonly collectionName = 'cronTriggerState';

  constructor(private readonly db: Firestore) {}

  private docKey(definitionName: string, triggerName: string): string {
    return `${definitionName}:${triggerName}`;
  }

  async get(definitionName: string, triggerName: string): Promise<CronTriggerState | null> {
    const snap = await getDoc(
      doc(this.db, this.collectionName, this.docKey(definitionName, triggerName)),
    );
    if (!snap.exists()) return null;
    return CronTriggerStateSchema.parse(snap.data());
  }

  async set(state: CronTriggerState): Promise<void> {
    await setDoc(
      doc(
        this.db,
        this.collectionName,
        this.docKey(state.definitionName, state.triggerName),
      ),
      state,
    );
  }
}
