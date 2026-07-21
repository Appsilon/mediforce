import type { CredentialsRepository } from '../interfaces/credentials-repository';

/**
 * In-memory `CredentialsRepository`. Seed known uids with `seedUser` so
 * `setPasswordHash` can report the "no such user" case the Postgres impl
 * returns; an unseeded repository accepts every uid.
 */
export class InMemoryCredentialsRepository implements CredentialsRepository {
  private readonly hashes = new Map<string, string>();
  private readonly knownUids = new Set<string>();
  private restrictToKnownUids = false;

  /** Register a uid as existing; the first call switches on strict mode. */
  seedUser(uid: string): void {
    this.restrictToKnownUids = true;
    this.knownUids.add(uid);
  }

  async setPasswordHash(uid: string, passwordHash: string): Promise<boolean> {
    if (this.restrictToKnownUids === true && this.knownUids.has(uid) === false) {
      return false;
    }
    this.hashes.set(uid, passwordHash);
    return true;
  }

  getPasswordHash(uid: string): string | null {
    return this.hashes.get(uid) ?? null;
  }
}
