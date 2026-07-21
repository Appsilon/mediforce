import { eq, sql } from 'drizzle-orm';
import type { Database } from '../postgres/client';
import { authUsers } from '../postgres/schema/auth-user';

/**
 * Set (or replace) a user's bcrypt password hash on `auth_users` (ADR-0002 §4,
 * PR2). The Credentials provider reads this hash in `authorize`; this is the
 * only write path for it (seed-based invites leave it null, so a user adds a
 * password via the change-password flow). Returns `true` when a row matched.
 *
 * The caller owns hashing — bcrypt runs in the route (platform-ui) so this
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
