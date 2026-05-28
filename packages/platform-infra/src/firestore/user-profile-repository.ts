import type { UserProfile, UserProfileRepository } from '@mediforce/platform-core';
import type { Firestore } from 'firebase-admin/firestore';

export class FirestoreUserProfileRepository implements UserProfileRepository {
  private readonly usersCollection = 'users';

  constructor(private readonly db: Firestore) {}

  async getProfile(uid: string): Promise<UserProfile | null> {
    const snapshot = await this.db.collection(this.usersCollection).doc(uid).get();
    if (!snapshot.exists) return null;
    const data = snapshot.data() ?? {};
    return { mustChangePassword: data.mustChangePassword === true };
  }

  async setMustChangePassword(uid: string, value: boolean): Promise<void> {
    await this.db
      .collection(this.usersCollection)
      .doc(uid)
      .set({ mustChangePassword: value }, { merge: true });
  }
}
