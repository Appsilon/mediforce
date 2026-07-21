import type { CredentialsRepository } from '../interfaces/credentials-repository';

/**
 * In-memory `CredentialsRepository`. Seed known uids with `seedUser` so
 * `setPasswordHash` can report the "no such user" case the Postgres impl
 * returns; an unseeded repository accepts every uid.
 *
 * Sessions are modelled as a token → uid map, mirroring the `auth_sessions`
 * lookup key. Seed them with `seedSession` to exercise revocation.
 */
export class InMemoryCredentialsRepository implements CredentialsRepository {
  private readonly hashes = new Map<string, string>();
  private readonly knownUids = new Set<string>();
  private readonly sessions = new Map<string, string>();
  private restrictToKnownUids = false;

  /** Register a uid as existing; the first call switches on strict mode. */
  seedUser(uid: string): void {
    this.restrictToKnownUids = true;
    this.knownUids.add(uid);
  }

  /** Register an active session token for a uid. */
  seedSession(uid: string, sessionToken: string): void {
    this.sessions.set(sessionToken, uid);
  }

  /** Session tokens still active for a uid, in insertion order. */
  listSessionTokens(uid: string): string[] {
    return [...this.sessions.entries()].filter(([, owner]) => owner === uid).map(([token]) => token);
  }

  async getPasswordHash(uid: string): Promise<string | null> {
    return this.hashes.get(uid) ?? null;
  }

  async setPasswordHash(uid: string, passwordHash: string): Promise<boolean> {
    if (this.restrictToKnownUids === true && this.knownUids.has(uid) === false) {
      return false;
    }
    this.hashes.set(uid, passwordHash);
    return true;
  }

  async deleteSessions(uid: string, keepSessionToken: string | null): Promise<number> {
    let deleted = 0;
    for (const [token, owner] of [...this.sessions.entries()]) {
      if (owner !== uid) continue;
      if (keepSessionToken !== null && token === keepSessionToken) continue;
      this.sessions.delete(token);
      deleted += 1;
    }
    return deleted;
  }
}
