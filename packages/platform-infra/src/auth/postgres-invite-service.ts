import { randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from '../postgres/client';
import { authAccounts } from '../postgres/schema/auth-account';
import { authSessions } from '../postgres/schema/auth-session';
import { authUsers } from '../postgres/schema/auth-user';
import { userRoles } from '../postgres/schema/user-role';
import { workspaceMembers, workspaceAutojoinBlocks } from '../postgres/schema/workspace';

export interface SeedInviteInput {
  readonly email: string;
  readonly displayName?: string;
  readonly workspaceHandle: string;
  readonly membership: 'owner' | 'admin' | 'member';
  /**
   * Process-domain roles to grant in `workspaceHandle` (ADR-0019), across
   * every workflow in it. Distinct from `membership` above: that is who
   * administers the workspace, these are what the invitee does in a process.
   */
  readonly roles?: readonly string[];
  /**
   * Whether an authenticated admin is naming this specific person, as opposed
   * to an anonymous join-link holder typing an address into a public form
   * (ADR-0021 §4). Required, with no default: the two callers want materially
   * different writes, and a third that forgot to choose would silently get the
   * privileged one.
   *
   * `true` (admin invite) may modify an account that already exists — raise or
   * lower its membership, stamp `invited_at`, clear an auto-join tombstone.
   * Each of those is a deliberate act by someone entitled to perform it.
   *
   * `false` (join-link redemption) may only ever CREATE. The email is
   * attacker-supplied and unauthenticated, so touching an existing row would
   * hand any link holder three escalations the ADR never granted: demoting a
   * workspace owner to `member` by typing their address at a `member` link,
   * exempting an allowlist-blocked account from the domain gate by stamping
   * `invited_at` on it, and undoing a deliberate removal. A link is an
   * entrance; walking through one twice is a no-op.
   */
  readonly vouchedByAdmin: boolean;
}

export interface SeededInvite {
  readonly uid: string;
  /** True when the `auth_users` row already existed (email collision). */
  readonly isExisting: boolean;
}

/**
 * Postgres seed-based invite (PLAN-0002 §3.1; workspace-scoped roles per
 * ADR-0019).
 *
 * Replaces the Firebase create-user-with-temp-password flow. An invite
 * pre-seeds an `auth_users` row + the invitee's `workspace_members`
 * membership + any `user_roles` grants in that workspace, all in one
 * transaction. No temp
 * password and no magic-link email — the invitee signs in later via Google
 * verified-email auto-link (ADR-0002 §4b) onto the pre-seeded row, or by
 * setting a password.
 *
 * Idempotent: re-seeding the same email reuses the existing uid. What a
 * re-seed is allowed to CHANGE depends on `vouchedByAdmin` — an admin invite
 * may rewrite an existing membership, stamp `invited_at` and clear an
 * auto-join tombstone; an anonymous join-link redemption may only create. See
 * that field for why. Roles are additive either way.
 *
 * This is also the ONLY writer of `auth_users.invited_at` (migration 0048) —
 * the marker the ADR-0021 §5 sign-in gate reads to tell an admin's deliberate
 * add apart from a self-registration the Auth.js adapter wrote. Both admin
 * invites and redeemed join links reach it here, and nothing else may set it.
 */
export class PostgresInviteService {
  constructor(private readonly db: Database) {}

  async seedInvite(input: SeedInviteInput): Promise<SeededInvite> {
    // Case-insensitive identity (migration 0034): inviting `Alice@corp.com`
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
        // Stamped whichever caller this is. A brand-new row means nobody held
        // this address before, so there is no pre-existing standing for a
        // redemption to subvert — and the link it came through was minted by an
        // admin, which is the vouching ADR-0021 §5 asks for.
        await tx.insert(authUsers).values({
          id: uid,
          email: normalisedEmail,
          name: input.displayName ?? null,
          invitedAt: new Date(),
        });
      } else if (input.vouchedByAdmin) {
        // Only an admin naming this person may stamp a row that already exists.
        // This is the repair path for someone invited before migration 0048
        // shipped, and for a migrated account an admin now genuinely wants in.
        //
        // A redemption must NOT reach here: its email is attacker-supplied and
        // unauthenticated, so stamping would let any link holder exempt an
        // allowlist-blocked account from the domain gate by typing its address
        // — the exact control migration 0048 exists to preserve.
        //
        // First stamp wins: `invited_at` records when they were first vouched
        // for, so a later re-invite does not rewrite that history.
        await tx
          .update(authUsers)
          .set({ invitedAt: sql`now()` })
          .where(and(eq(authUsers.id, uid), isNull(authUsers.invitedAt)));
      }

      const memberInsert = tx
        .insert(workspaceMembers)
        .values({
          workspace: input.workspaceHandle,
          uid,
          role: input.membership,
          ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        });
      if (input.vouchedByAdmin) {
        // An admin re-inviting someone at a different level means it: role
        // parity with the pre-cutover `addMember` upsert.
        await memberInsert.onConflictDoUpdate({
          target: [workspaceMembers.workspace, workspaceMembers.uid],
          set: { role: input.membership },
        });
      } else {
        // A redemption never rewrites an existing seat, in either direction.
        // Upserting would let an anonymous link holder demote the workspace
        // OWNER to `member` by typing their address at a `member` link, and
        // promote themselves by redeeming an `admin` link they were already a
        // member under. Both are silent: the response is identical either way
        // (that identity is the anti-enumeration property), so the state change
        // would be invisible to everyone including the victim.
        await memberInsert.onConflictDoNothing();
      }

      // An explicit invite outranks a past removal: clear the auto-join
      // tombstone (migration 0043) so re-inviting someone who was removed
      // sticks, and so their next `leave` starts from a clean slate.
      //
      // A redemption does not: "an admin explicitly wants this person back" is
      // not something an anonymous holder of a shared link can assert on
      // somebody else's behalf. The membership insert above still adds them,
      // which is the accepted blast radius; the tombstone keeps guarding
      // auto-join, which is all it ever guarded.
      if (input.vouchedByAdmin) {
        await tx
          .delete(workspaceAutojoinBlocks)
          .where(
            and(
              eq(workspaceAutojoinBlocks.workspace, input.workspaceHandle),
              eq(workspaceAutojoinBlocks.uid, uid),
            ),
          );
      }

      for (const role of input.roles ?? []) {
        await tx
          .insert(userRoles)
          .values({ uid, role, namespace: input.workspaceHandle, workflowName: null })
          .onConflictDoNothing();
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
   * A seed-based invite is "pending" while the invitee has never established
   * an identity (PLAN-0002 §3.1). Not pending when ANY of these hold:
   *   - an `auth_sessions` row exists (they have signed in), OR
   *   - an `auth_accounts` row exists (they linked an OAuth/OIDC provider,
   *     e.g. Google — such users legitimately have no password), OR
   *   - `auth_users.password_hash` is set (they chose a Credentials password).
   * An OAuth-only user has no password yet is fully set up, so the
   * `auth_accounts` check must come before the password check — otherwise a
   * resend-invite would email an existing Google user a bogus "set up your
   * account" link. An unknown uid is treated as not pending so resend-invite
   * surfaces a clean precondition failure rather than re-notifying a
   * non-existent account.
   */
  async isInvitePending(uid: string): Promise<boolean> {
    const sessions = await this.db
      .select({ token: authSessions.sessionToken })
      .from(authSessions)
      .where(eq(authSessions.userId, uid))
      .limit(1);
    if (sessions.length > 0) return false;

    const accounts = await this.db
      .select({ provider: authAccounts.provider })
      .from(authAccounts)
      .where(eq(authAccounts.userId, uid))
      .limit(1);
    if (accounts.length > 0) return false;

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
