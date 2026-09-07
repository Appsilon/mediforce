import { eq, sql } from 'drizzle-orm';
import type { Database } from '../postgres/client';
import { authUsers } from '../postgres/schema/auth-user';

/**
 * Set (or replace) a user's bcrypt password hash on `auth_users` (ADR-0002 §4).
 * The `/api/auth/password-login` route compares against this hash; this is the
 * only write path for it (seed-based invites leave it null, so a user adds a
 * password via the change-password flow). Returns `true` when a row matched.
 *
 * The caller owns hashing — bcrypt runs in the `setPassword` handler so this
 * module stays a thin, testable DB primitive.
 */
export async function setUserPasswordHash(
  db: Database,
  uid: string,
  passwordHash: string,
): Promise<boolean> {
  const updated = await db
    .update(authUsers)
    .set({ passwordHash, updatedAt: sql`now()` })
    .where(eq(authUsers.id, uid))
    .returning({ id: authUsers.id });
  return updated.length > 0;
}

/**
 * The user's stored bcrypt hash, or `null` when they have none (seeded invite,
 * OAuth-only account) or the uid does not exist. Backs the re-authentication
 * check on password change: a user who already has a credential must prove the
 * old one before replacing it.
 */
export async function getUserPasswordHash(db: Database, uid: string): Promise<string | null> {
  const [user] = await db
    .select({ passwordHash: authUsers.passwordHash })
    .from(authUsers)
    .where(eq(authUsers.id, uid))
    .limit(1);
  return user?.passwordHash ?? null;
}

export type PasswordCredentialRecord = {
  id: string;
  email: string | null;
  name: string | null;
  image: string | null;
  passwordHash: string | null;
};

/**
 * Look up the credential record password sign-in needs (ADR-0002 §4). Returns
 * `null` when no user has that email; the caller compares the bcrypt hash.
 *
 * The email is lower-cased to match the case-insensitive uniqueness index
 * (migration 0034) — addresses differing only in case are one account.
 */
export async function findPasswordCredentialByEmail(
  db: Database,
  email: string,
): Promise<PasswordCredentialRecord | null> {
  const [user] = await db
    .select({
      id: authUsers.id,
      email: authUsers.email,
      name: authUsers.name,
      image: authUsers.image,
      passwordHash: authUsers.passwordHash,
    })
    .from(authUsers)
    .where(eq(authUsers.email, email.toLowerCase()))
    .limit(1);
  return user ?? null;
}

/**
 * Whether an admin deliberately seeded this account — an invite, or a redeemed
 * join link (ADR-0021 §5, amending ADR-0002 §4a). Reads `auth_users.invited_at`
 * (migration 0048), which `PostgresInviteService.seedInvite` is the only writer
 * of.
 *
 * Deliberately NOT "an `auth_users` row exists", which is what §5's own text
 * proposed: `@auth/drizzle-adapter` writes such a row for every self-registered
 * OAuth user, and the Firebase migration wrote one for every account it carried
 * over, so an existence test would exempt those populations from the domain
 * allowlist too. The staging runbook records `ALLOWED_EMAIL_DOMAINS` being used
 * to block two migrated accounts by name — removing a domain is a live eviction
 * control, and only this narrower column leaves it working.
 *
 * Deliberately not `findPasswordCredentialByEmail` either: the question is
 * whether somebody vouched for this address, not what credentials it holds, and
 * an OAuth-only account has no password hash to read.
 */
export async function authUserWasInvited(
  db: Database,
  email: string | null | undefined,
): Promise<boolean> {
  if (typeof email !== 'string' || email === '') return false;
  const [row] = await db
    .select({ invitedAt: authUsers.invitedAt })
    .from(authUsers)
    .where(eq(authUsers.email, email.toLowerCase()))
    .limit(1);
  return row?.invitedAt !== undefined && row.invitedAt !== null;
}
