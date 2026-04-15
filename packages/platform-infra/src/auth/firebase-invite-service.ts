import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';

export class FirebaseInviteService {
  constructor(
    private readonly adminAuth: Auth,
    private readonly adminDb: Firestore,
  ) {}

  // Creates Firebase Auth user + Firestore user doc.
  // Returns the uid. If user already exists in Firebase Auth, returns existing uid.
  async createInvitedUser(email: string, displayName?: string): Promise<string> {
    let uid: string;
    try {
      const userRecord = await this.adminAuth.createUser({
        email,
        ...(displayName !== undefined ? { displayName } : {}),
        emailVerified: false,
      });
      uid = userRecord.uid;
    } catch (err: unknown) {
      // If user already exists in Firebase Auth, get their uid
      if (
        err !== null &&
        typeof err === 'object' &&
        'code' in err &&
        err.code === 'auth/email-already-exists'
      ) {
        const existing = await this.adminAuth.getUserByEmail(email);
        uid = existing.uid;
      } else {
        throw err;
      }
    }

    // Upsert Firestore user doc (merge so existing data is preserved)
    const userRef = this.adminDb.collection('users').doc(uid);
    await userRef.set(
      {
        uid,
        email,
        ...(displayName !== undefined ? { displayName } : {}),
      },
      { merge: true },
    );

    return uid;
  }
}
