/**
 * Password-credential writes for a user (ADR-0002 §4).
 *
 * Distinct from `UserProfileRepository`, which owns application-level profile
 * fields: this port owns the authentication material the Credentials provider
 * reads in `authorize`. Hashing is the caller's job — the port stores an
 * already-hashed value so no plaintext password ever crosses this boundary.
 */
export interface CredentialsRepository {
  /**
   * Replace the user's password hash. Returns `false` when no user with that
   * uid exists.
   */
  setPasswordHash(uid: string, passwordHash: string): Promise<boolean>;
}
