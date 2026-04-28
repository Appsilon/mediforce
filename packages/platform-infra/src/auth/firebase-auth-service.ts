import type { AuthService, AuthUser } from '@mediforce/platform-core';
import {
  onAuthStateChanged as firebaseOnAuthStateChanged,
  signOut as firebaseSignOut,
  type Auth,
} from 'firebase/auth';
import { doc, getDoc, type Firestore } from 'firebase/firestore';

/**
 * Firebase implementation of the AuthService interface.
 * Wraps Firebase Auth and fetches user roles from a Firestore 'users' collection.
 *
 * Receives Auth and Firestore instances via constructor injection —
 * calling code never imports Firebase Auth or Firestore directly.
 */
export class FirebaseAuthService implements AuthService {
  constructor(
    private readonly auth: Auth,
    private readonly db: Firestore,
  ) {}

  async getCurrentUser(): Promise<AuthUser | null> {
    const firebaseUser = this.auth.currentUser;

    if (!firebaseUser) {
      return null;
    }

    return this.mapFirebaseUser(firebaseUser);
  }

  async requireAuth(): Promise<AuthUser> {
    const user = await this.getCurrentUser();

    if (!user) {
      throw new Error('Authentication required. No user is currently signed in.');
    }

    return user;
  }

  async requireRole(role: string): Promise<AuthUser> {
    const user = await this.requireAuth();

    if (!user.roles.includes(role)) {
      throw new Error(
        `Authorization failed. User does not have required role: ${role}`,
      );
    }

    return user;
  }

  onAuthStateChanged(callback: (user: AuthUser | null) => void): () => void {
    return firebaseOnAuthStateChanged(this.auth, async (firebaseUser) => {
      if (!firebaseUser) {
        callback(null);
        return;
      }

      try {
        const authUser = await this.mapFirebaseUser(firebaseUser);
        callback(authUser);
      } catch {
        // If role lookup fails, still provide user with empty roles
        callback({
          uid: firebaseUser.uid,
          email: firebaseUser.email ?? '',
          displayName: firebaseUser.displayName,
          roles: [],
        });
      }
    });
  }

  async signOut(): Promise<void> {
    await firebaseSignOut(this.auth);
  }

  /**
   * Map a Firebase User to an AuthUser by fetching roles
   * from the Firestore 'users' collection.
   */
  private async mapFirebaseUser(
    firebaseUser: { uid: string; email: string | null; displayName: string | null },
  ): Promise<AuthUser> {
    const userDocRef = doc(this.db, 'users', firebaseUser.uid);
    const userDoc = await getDoc(userDocRef);

    let roles: string[] = [];
    let handle: string | undefined;
    if (userDoc.exists()) {
      const data = userDoc.data();
      // Support both 'role' (single string) and 'roles' (array) for flexibility
      if (Array.isArray(data.roles)) {
        roles = data.roles;
      } else if (typeof data.role === 'string') {
        roles = [data.role];
      }
      if (typeof data.handle === 'string') {
        handle = data.handle;
      }
    }

    return {
      uid: firebaseUser.uid,
      email: firebaseUser.email ?? '',
      displayName: firebaseUser.displayName,
      roles,
      handle,
    };
  }
}
