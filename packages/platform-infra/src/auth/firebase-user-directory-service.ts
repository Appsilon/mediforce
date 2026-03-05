import type { Auth } from 'firebase-admin/auth';
import type { UserDirectoryService, DirectoryUser } from '@mediforce/platform-core';

/**
 * Firebase Admin SDK implementation of UserDirectoryService.
 * Resolves a role to users by filtering listUsers() results on custom claims.
 * Supports both 'role' (string) and 'roles' (array) custom claim formats.
 *
 * NOTE: listUsers() returns max 1000 users per call. For deployments with
 * >1000 users, implement pagination using result.pageToken.
 */
export class FirebaseUserDirectoryService implements UserDirectoryService {
  constructor(private readonly adminAuth: Auth) {}

  async getUsersByRole(role: string): Promise<DirectoryUser[]> {
    const result = await this.adminAuth.listUsers(1000);
    return result.users
      .filter((u) => {
        const claims = u.customClaims ?? {};
        if (Array.isArray(claims['roles'])) {
          return (claims['roles'] as string[]).includes(role);
        }
        return claims['role'] === role;
      })
      .map((u) => ({ uid: u.uid, email: u.email ?? '' }));
  }
}
