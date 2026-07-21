import type { CredentialsRepository } from '@mediforce/platform-core';
import { setUserPasswordHash } from '../../auth/credentials-store';
import type { Database } from '../client';

/**
 * Postgres-backed `CredentialsRepository` (ADR-0002 §4). Thin adapter over the
 * `setUserPasswordHash` primitive so the handler layer sees the port, not the
 * `auth_users` table.
 */
export class PostgresCredentialsRepository implements CredentialsRepository {
  constructor(private readonly db: Database) {}

  async setPasswordHash(uid: string, passwordHash: string): Promise<boolean> {
    return setUserPasswordHash(this.db, uid, passwordHash);
  }
}
