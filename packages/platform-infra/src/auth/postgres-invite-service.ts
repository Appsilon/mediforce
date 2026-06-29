import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Database } from '../postgres/client';
import { authUsers } from '../postgres/schema/auth-user';
import { userRoles } from '../postgres/schema/user-role';
import { workspaceMembers } from '../postgres/schema/workspace';

export interface SeedInviteInput {
  readonly email: string;
  readonly displayName?: string;
  readonly workspaceHandle: string;
  readonly membership: 'owner' | 'admin' | 'member';
  readonly roles?: readonly string[];
}

export interface SeededInvite {
  readonly uid: string;
  /** True when the `auth_users` row already existed (email collision). */
  readonly isExisting: boolean;
}

/**
 * Postgres seed-based invite (ADR-0002 §3.1, §5, PR1).
 *
 * Replaces the Firebase create-user-with-temp-password flow. An invite
 * pre-seeds an `auth_users` row + the invitee's `workspace_members`
 * membership + any global `user_roles`, all in one transaction. No temp
 * password and no magic-link email — the invitee signs in later (Google
 * verified-email auto-link in PR2) onto the pre-seeded row.
 *
 * Built and unit-tested in PR1 but NOT wired live: Firebase is still the
 * login source until the PR2 cutover, so a seed-only invite would leave a new
 * invitee unable to sign in. Wiring behind the (reshaped) invite port happens
 * in PR2.
 *
 * Idempotent: re-seeding the same email reuses the existing uid and leaves
 * the existing membership/roles untouched.
 */
export class PostgresInviteService {
  constructor(private readonly db: Database) {}

  async seedInvite(input: SeedInviteInput): Promise<SeededInvite> {
    return this.db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: authUsers.id })
        .from(authUsers)
        .where(eq(authUsers.email, input.email))
        .limit(1);

      const isExisting = existing.length > 0;
      const uid = existing[0]?.id ?? randomUUID();

      if (!isExisting) {
        await tx.insert(authUsers).values({
          id: uid,
          email: input.email,
          name: input.displayName ?? null,
        });
      }

      await tx
        .insert(workspaceMembers)
        .values({
          workspace: input.workspaceHandle,
          uid,
          role: input.membership,
          ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        })
        .onConflictDoNothing({
          target: [workspaceMembers.workspace, workspaceMembers.uid],
        });

      for (const role of input.roles ?? []) {
        await tx
          .insert(userRoles)
          .values({ uid, role })
          .onConflictDoNothing({ target: [userRoles.uid, userRoles.role] });
      }

      return { uid, isExisting };
    });
  }

  async getUserEmail(uid: string): Promise<string | null> {
    const rows = await this.db
      .select({ email: authUsers.email })
      .from(authUsers)
      .where(eq(authUsers.id, uid))
      .limit(1);
    return rows[0]?.email ?? null;
  }
}
