import type { CredentialsRepository } from '@mediforce/platform-core';
import { getUserPasswordHash, setUserPasswordHash } from '../../auth/credentials-store';
import { deleteUserSessions } from '../../auth/session-store';
import type { Database } from '../client';

/**
 * Postgres-backed `CredentialsRepository` (ADR-0002 §4). Thin adapter over the
 * `credentials-store` / `session-store` primitives so the handler layer sees
 * the port, not the `auth_users` / `auth_sessions` tables.
 */
export class PostgresCredentialsRepository implements CredentialsRepository {
  constructor(private readonly db: Database) {}

  async getPasswordHash(uid: string): Promise<string | null> {
    return getUserPasswordHash(this.db, uid);
  }

  async setPasswordHash(uid: string, passwordHash: string): Promise<boolean> {
    return setUserPasswordHash(this.db, uid, passwordHash);
  }

  async deleteSessions(uid: string, keepSessionToken: string | null): Promise<number> {
    return deleteUserSessions(this.db, { userId: uid, exceptSessionToken: keepSessionToken });
  }
}
