import type {
  UserDirectoryService,
  DirectoryUser,
  UserAuthMetadata,
} from '../interfaces/user-directory-service';

export interface InMemoryDirectoryUser {
  readonly uid: string;
  readonly email: string;
  readonly displayName?: string | null;
  readonly image?: string | null;
}

/**
 * In-memory double for the global-`user_roles` UserDirectoryService
 * (ADR-0002 PR1). Mirrors `PostgresUserDirectoryService`: `getUsersByRole`
 * inner-joins roles to users (a role row for an unknown uid yields nothing),
 * `getUserMetadata.lastSignInTime` is always `null` (no sign-in record before
 * NextAuth sessions). The Postgres backend MUST satisfy the same contract.
 */
export class InMemoryUserDirectoryService implements UserDirectoryService {
  private readonly users = new Map<string, InMemoryDirectoryUser>();
  private readonly roles: { uid: string; role: string }[] = [];

  addUser(user: InMemoryDirectoryUser): void {
    this.users.set(user.uid, user);
  }

  addRole(uid: string, role: string): void {
    if (!this.roles.some((r) => r.uid === uid && r.role === role)) {
      this.roles.push({ uid, role });
    }
  }

  async getUsersByRole(role: string): Promise<DirectoryUser[]> {
    return this.roles
      .filter((r) => r.role === role)
      .map((r) => this.users.get(r.uid))
      .filter((u): u is InMemoryDirectoryUser => u !== undefined)
      .map(toDirectoryUser);
  }

  async resolveUser(identifier: string): Promise<DirectoryUser | null> {
    const match = identifier.includes('@')
      ? [...this.users.values()].find((u) => u.email === identifier)
      : this.users.get(identifier);
    return match ? toDirectoryUser(match) : null;
  }

  async getUserMetadata(uid: string): Promise<UserAuthMetadata | null> {
    const user = this.users.get(uid);
    if (!user) return null;
    return {
      email: user.email !== '' ? user.email : null,
      displayName:
        typeof user.displayName === 'string' && user.displayName !== ''
          ? user.displayName
          : null,
      lastSignInTime: null,
      photoURL: user.image ?? null,
    };
  }
}

function toDirectoryUser(user: InMemoryDirectoryUser): DirectoryUser {
  return {
    uid: user.uid,
    email: user.email,
    ...(typeof user.displayName === 'string' && user.displayName !== ''
      ? { displayName: user.displayName }
      : {}),
  };
}
