import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';

function generateTemporaryPassword(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return 'Mf-' + Array.from({ length: 9 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export class FirebaseInviteService {
  constructor(
    private readonly adminAuth: Auth,
    private readonly adminDb: Firestore,
  ) {}

  // Creates Firebase Auth user + Firestore user doc.
  // Returns { uid, temporaryPassword }. If user already exists in Firebase Auth, returns existing uid.
  async createInvitedUser(
    email: string,
    displayName?: string,
    password?: string,
  ): Promise<{ uid: string; temporaryPassword: string }> {
    const actualPassword = password ?? generateTemporaryPassword();
    let uid: string;
    try {
      const userRecord = await this.adminAuth.createUser({
        email,
        password: actualPassword,
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

    return { uid, temporaryPassword: actualPassword };
  }

  async getUsersLastSignIn(uids: string[]): Promise<Map<string, string | null>> {
    const result = new Map<string, string | null>();
    await Promise.all(
      uids.map(async (uid) => {
        try {
          const userRecord = await this.adminAuth.getUser(uid);
          result.set(uid, userRecord.metadata.lastSignInTime ?? null);
        } catch {
          result.set(uid, null);
        }
      }),
    );
    return result;
  }
}
