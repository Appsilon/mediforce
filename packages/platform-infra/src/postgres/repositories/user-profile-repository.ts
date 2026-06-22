import { eq, sql } from 'drizzle-orm';
import type { UserProfile, UserProfileRepository } from '@mediforce/platform-core';
import type { Database } from '../client';
import { userProfiles } from '../schema/user-profile';

/**
 * Postgres-backed UserProfileRepository (ADR-0001 final cutover, #534).
 * Replaces the Firestore `users/{uid}` doc — the last live Firestore data.
 *
 * Minimal surface: the only application-owned field read live is
 * `mustChangePassword`. `setMustChangePassword` upserts so a fresh invite
 * creates the row and a re-invite updates it in place.
 */
export class PostgresUserProfileRepository implements UserProfileRepository {
  constructor(private readonly db: Database) {}

  async getProfile(uid: string): Promise<UserProfile | null> {
    const rows = await this.db.select().from(userProfiles).where(eq(userProfiles.uid, uid)).limit(1);
    const row = rows[0];
    return row ? { mustChangePassword: row.mustChangePassword } : null;
  }

  async setMustChangePassword(uid: string, value: boolean): Promise<void> {
    await this.db
      .insert(userProfiles)
      .values({ uid, mustChangePassword: value })
      .onConflictDoUpdate({
        target: userProfiles.uid,
        set: { mustChangePassword: value, updatedAt: sql`now()` },
      });
  }
}
