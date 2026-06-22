import type { Auth } from 'firebase-admin/auth';
import type { UserProfileRepository } from '@mediforce/platform-core';

function generateTemporaryPassword(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const randomBytes = new Uint32Array(9);
  crypto.getRandomValues(randomBytes);
  return 'Mf-' + Array.from(randomBytes, (byte) => chars[byte % chars.length]).join('');
}

export class FirebaseInviteService {
  constructor(
    private readonly adminAuth: Auth,
    private readonly userProfileRepo: UserProfileRepository,
  ) {}

  // Creates Firebase Auth user + marks the new user as must-change-password.
  // Returns { uid, temporaryPassword }. If user already exists in Firebase Auth, returns existing uid.
  async createInvitedUser(
    email: string,
    displayName?: string,
    password?: string,
  ): Promise<{ uid: string; temporaryPassword: string; isExisting: boolean }> {
    const actualPassword = password ?? generateTemporaryPassword();
    let uid: string;
    let isExisting = false;

    try {
      const userRecord = await this.adminAuth.createUser({
        email,
        password: actualPassword,
        ...(displayName !== undefined ? { displayName } : {}),
        emailVerified: false,
      });
      uid = userRecord.uid;
    } catch (err: unknown) {
      // User already exists in Firebase Auth — add them to the workspace without touching their password
      if (err !== null && typeof err === 'object' && 'code' in err && err.code === 'auth/email-already-exists') {
        const existing = await this.adminAuth.getUserByEmail(email);
        uid = existing.uid;
        isExisting = true;
      } else {
        throw err;
      }
    }

    // New users must change their temporary password on first sign-in.
    // Existing users keep their password and existing profile untouched.
    if (!isExisting) {
      await this.userProfileRepo.setMustChangePassword(uid, true);
    }

    return { uid, temporaryPassword: isExisting ? '' : actualPassword, isExisting };
  }

  async resetInvitePassword(uid: string): Promise<string> {
    const temporaryPassword = generateTemporaryPassword();
    await this.adminAuth.updateUser(uid, { password: temporaryPassword });
    await this.userProfileRepo.setMustChangePassword(uid, true);
    return temporaryPassword;
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
