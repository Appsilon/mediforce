import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Database } from '../postgres/client';
import { authSessions } from '../postgres/schema/auth-session';
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
 * Idempotent: re-seeding the same email reuses the existing uid. A re-invite
 * with a different membership updates the existing workspace membership row
 * (role parity with the pre-cutover Firebase `addMember` upsert); roles are
 * additive.
 */
export class PostgresInviteService {
  constructor(private readonly db: Database) {}

  async seedInvite(input: SeedInviteInput): Promise<SeededInvite> {
    // Case-insensitive identity (migration 0033): inviting `Alice@corp.com`
    // must reach the same account her Google sign-in creates as
    // `alice@corp.com`, or the invite silently orphans.
    const normalisedEmail = input.email.toLowerCase();
    return this.db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: authUsers.id })
        .from(authUsers)
        .where(eq(authUsers.email, normalisedEmail))
        .limit(1);

      const isExisting = existing.length > 0;
      const uid = existing[0]?.id ?? randomUUID();

      if (!isExisting) {
        await tx.insert(authUsers).values({
          id: uid,
          email: normalisedEmail,
          name: input.displayName ?? null,
        });
      }

      await tx
        .insert(workspaceMembers)
        .values({
          workspace: input.workspaceHandle,
          uid,
          membership: input.membership,
          ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        })
        .onConflictDoUpdate({
          target: [workspaceMembers.workspace, workspaceMembers.uid],
          set: { membership: input.membership },
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

  /**
   * A seed-based invite is "pending" while the invitee still needs to
   * establish a session (ADR-0002 §3.1): no `auth_sessions` row exists for the
   * uid AND no password has been set (`auth_users.password_hash` is null, i.e.
   * they never signed in via Credentials and never linked Google). An unknown
   * uid is treated as not pending so resend-invite surfaces a clean
   * precondition failure rather than re-notifying a non-existent account.
   */
  async isInvitePending(uid: string): Promise<boolean> {
    const sessions = await this.db
      .select({ token: authSessions.sessionToken })
      .from(authSessions)
      .where(eq(authSessions.userId, uid))
      .limit(1);
    if (sessions.length > 0) return false;

    const users = await this.db
      .select({ passwordHash: authUsers.passwordHash })
      .from(authUsers)
      .where(eq(authUsers.id, uid))
      .limit(1);
    const user = users[0];
    if (user === undefined) return false;
    return user.passwordHash === null;
  }
}
