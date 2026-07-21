import { eq } from 'drizzle-orm';
import type {
  UserDirectoryService,
  DirectoryUser,
  UserAuthMetadata,
} from '@mediforce/platform-core';
import type { Database } from '../postgres/client';
import { authUsers } from '../postgres/schema/auth-user';
import { userRoles } from '../postgres/schema/user-role';

/**
 * Postgres-backed UserDirectoryService (ADR-0002 §5, §3.1, PR1).
 * Replaces FirebaseUserDirectoryService behind the same port — no consumer
 * (`workflow-engine` escalation, `caller-scope`) changes.
 *
 * `getUsersByRole` reads the GLOBAL `user_roles` table (no namespace scope),
 * matching today's Firebase `customClaims.roles` semantics — an empty table
 * silently stops escalation notifications, so the one-time seed
 * (`seed-user-roles`) MUST run when this goes live.
 *
 * `getUserMetadata.lastSignInTime` reads `auth_users.last_sign_in_at`, stamped
 * by `recordSignIn` on every sign-in. Migrated users show `null` until they
 * next sign in — Firebase's own timestamps are not carried over. `photoURL`
 * comes from `auth_users.image` (seeded from Firebase `photoURL`) so the
 * member-list avatar fallback does not regress.
 */
export class PostgresUserDirectoryService implements UserDirectoryService {
  constructor(private readonly db: Database) {}

  async getUsersByRole(role: string): Promise<DirectoryUser[]> {
    const rows = await this.db
      .select({ uid: authUsers.id, email: authUsers.email, name: authUsers.name })
      .from(userRoles)
      .innerJoin(authUsers, eq(userRoles.uid, authUsers.id))
      .where(eq(userRoles.role, role));
    return rows.map(toDirectoryUser);
  }

  async resolveUser(identifier: string): Promise<DirectoryUser | null> {
    // Emails are stored lower-cased (migration 0033); uids are opaque and
    // case-sensitive, so only the email branch normalises.
    const isEmail = identifier.includes('@');
    const column = isEmail ? authUsers.email : authUsers.id;
    const value = isEmail ? identifier.toLowerCase() : identifier;
    const rows = await this.db
      .select({ uid: authUsers.id, email: authUsers.email, name: authUsers.name })
      .from(authUsers)
      .where(eq(column, value))
      .limit(1);
    const row = rows[0];
    return row ? toDirectoryUser(row) : null;
  }

  async getUserMetadata(uid: string): Promise<UserAuthMetadata | null> {
    const rows = await this.db
      .select({
        email: authUsers.email,
        name: authUsers.name,
        image: authUsers.image,
        lastSignInAt: authUsers.lastSignInAt,
      })
      .from(authUsers)
      .where(eq(authUsers.id, uid))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      email: row.email !== '' ? row.email : null,
      displayName: row.name !== null && row.name !== '' ? row.name : null,
      lastSignInTime: row.lastSignInAt?.toISOString() ?? null,
      photoURL: row.image ?? null,
    };
  }
}

function toDirectoryUser(row: { uid: string; email: string; name: string | null }): DirectoryUser {
  return {
    uid: row.uid,
    email: row.email,
    ...(row.name !== null && row.name !== '' ? { displayName: row.name } : {}),
  };
}
