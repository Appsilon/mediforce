import type { Firestore } from 'firebase-admin/firestore';
import { ApiKeySchema, type ApiKey } from '@mediforce/platform-core';

export class FirestoreApiKeyRepository {
  constructor(private readonly db: Firestore) {}

  private col() {
    return this.db.collection('apiKeys');
  }

  async create(apiKey: ApiKey): Promise<void> {
    const parsed = ApiKeySchema.parse(apiKey);
    await this.col().doc(parsed.id).set(parsed);
  }

  async getByKeyHash(keyHash: string): Promise<ApiKey | null> {
    const snap = await this.col()
      .where('keyHash', '==', keyHash)
      .limit(1)
      .get();
    if (snap.empty) return null;
    return ApiKeySchema.parse(snap.docs[0]!.data());
  }

  async listByUser(userId: string): Promise<ApiKey[]> {
    const snap = await this.col()
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();
    return snap.docs.map((doc) => ApiKeySchema.parse(doc.data()));
  }

  async revoke(keyId: string): Promise<boolean> {
    const ref = this.col().doc(keyId);
    const snap = await ref.get();
    if (!snap.exists) return false;
    await ref.update({ revokedAt: new Date().toISOString() });
    return true;
  }

  async touchLastUsed(keyId: string): Promise<void> {
    await this.col().doc(keyId).update({ lastUsedAt: new Date().toISOString() });
  }
}
