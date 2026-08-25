import { and, eq, isNull, or } from 'drizzle-orm';
import type {
  UserDirectoryService,
  DirectoryUser,
  RoleGrant,
  UserAuthMetadata,
} from '@mediforce/platform-core';
import type { Database } from '../postgres/client';
import { authUsers } from '../postgres/schema/auth-user';
import { userRoles } from '../postgres/schema/user-role';

/**
 * Postgres-backed UserDirectoryService (ADR-0002 §5, ADR-0019).
 *
 * Role reads are workspace-scoped: a grant lives in one workspace and, when
 * `workflow_name` is set, in one workflow of it. Every role query therefore
 * carries both dimensions — resolving a role without the workflow would let a
 * grant scoped to workflow A answer for workflow B.
 *
 * `getUserMetadata.lastSignInTime` reads `auth_users.last_sign_in_at`, stamped
 * by `recordSignIn` on every sign-in. Migrated users show `null` until they
 * next sign in — Firebase's own timestamps are not carried over. `photoURL`
 * comes from `auth_users.image` (seeded from Firebase `photoURL`) so the
 * member-list avatar fallback does not regress.
 */
export class PostgresUserDirectoryService implements UserDirectoryService {
  constructor(private readonly db: Database) {}

  async getUsersByRoleInNamespace(
    role: string,
    namespace: string,
    workflowName: string,
  ): Promise<DirectoryUser[]> {
    const rows = await this.db
      .selectDistinct({ uid: authUsers.id, email: authUsers.email, name: authUsers.name })
      .from(userRoles)
      .innerJoin(authUsers, eq(userRoles.uid, authUsers.id))
      .where(
        and(
          eq(userRoles.role, role),
          eq(userRoles.namespace, namespace),
          or(isNull(userRoles.workflowName), eq(userRoles.workflowName, workflowName)),
        ),
      );
    return rows.map(toDirectoryUser);
  }

  async getRolesForUser(
    uid: string,
    namespace: string,
    workflowName?: string,
  ): Promise<string[]> {
    const scope =
      workflowName === undefined
        ? undefined
        : or(isNull(userRoles.workflowName), eq(userRoles.workflowName, workflowName));
    const rows = await this.db
      .selectDistinct({ role: userRoles.role })
      .from(userRoles)
      .where(and(eq(userRoles.uid, uid), eq(userRoles.namespace, namespace), scope));
    return rows.map((row) => row.role);
  }

  /**
   * Full replace in one transaction: a reader between the delete and the
   * insert would otherwise see the member holding no roles at all, which is
   * exactly the window an enforcement check would fail closed in.
   */
  async setRolesForUser(
    uid: string,
    namespace: string,
    grants: readonly RoleGrant[],
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(userRoles)
        .where(and(eq(userRoles.uid, uid), eq(userRoles.namespace, namespace)));
      if (grants.length === 0) return;
      await tx
        .insert(userRoles)
        .values(grants.map((grant) => ({ uid, namespace, role: grant.role, workflowName: grant.workflowName })))
        .onConflictDoNothing();
    });
  }

  async clearRolesForWorkflow(namespace: string, workflowName: string): Promise<void> {
    await this.db
      .delete(userRoles)
      .where(and(eq(userRoles.namespace, namespace), eq(userRoles.workflowName, workflowName)));
  }

  async getRolesInNamespace(namespace: string): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ role: userRoles.role })
      .from(userRoles)
      .where(eq(userRoles.namespace, namespace));
    return rows.map((row) => row.role);
  }

  async resolveUser(identifier: string): Promise<DirectoryUser | null> {
    // Emails are stored lower-cased (migration 0034); uids are opaque and
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
