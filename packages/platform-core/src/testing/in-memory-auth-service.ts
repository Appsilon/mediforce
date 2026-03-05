import type { AuthService, AuthUser } from '../index.js';

/**
 * In-memory implementation of AuthService for testing.
 * Provides a setCurrentUser() helper to control auth state in tests.
 * Reusable by any package that needs test doubles for auth operations.
 */
export class InMemoryAuthService implements AuthService {
  private currentUser: AuthUser | null = null;

  /** Test helper: set the current authenticated user */
  setCurrentUser(user: AuthUser | null): void {
    this.currentUser = user;
  }

  async getCurrentUser(): Promise<AuthUser | null> {
    return this.currentUser;
  }

  async requireAuth(): Promise<AuthUser> {
    if (!this.currentUser) {
      throw new Error(
        'Authentication required. No user is currently signed in.',
      );
    }
    return this.currentUser;
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
    // Call callback with current user immediately
    callback(this.currentUser);

    // Return no-op unsubscribe
    return () => {};
  }

  async signOut(): Promise<void> {
    this.currentUser = null;
  }
}
