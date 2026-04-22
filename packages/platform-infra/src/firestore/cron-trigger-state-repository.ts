import type { Firestore } from 'firebase-admin/firestore';
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
    const snap = await this.db
      .collection(this.collectionName)
      .doc(this.docKey(definitionName, triggerName))
      .get();
    if (!snap.exists) return null;
    return CronTriggerStateSchema.parse(snap.data());
  }

  async set(state: CronTriggerState): Promise<void> {
    await this.db
      .collection(this.collectionName)
      .doc(this.docKey(state.definitionName, state.triggerName))
      .set(state);
  }
}
