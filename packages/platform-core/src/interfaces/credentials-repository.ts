/**
 * Password-credential writes for a user (ADR-0002 §4).
 *
 * Distinct from `UserProfileRepository`, which owns application-level profile
 * fields: this port owns a user's password credential and their sessions, as
 * the `setPassword` handler needs them. (Sign-in itself does not come through
 * here — `/api/auth/password-login` reads the credential directly, since it
 * runs outside the handler layer to set a cookie.) Hashing is the caller's job:
 * the port stores an already-hashed value, so no plaintext crosses this
 * boundary.
 */
export interface CredentialsRepository {
  /**
   * The user's current bcrypt hash, or `null` when the user has no password
   * credential yet (seeded invite, OAuth-only account) or no such user exists.
   * Callers compare against it with bcrypt; the port never sees plaintext.
   */
  getPasswordHash(uid: string): Promise<string | null>;

  /**
   * Replace the user's password hash. Returns `false` when no user with that
   * uid exists.
   */
  setPasswordHash(uid: string, passwordHash: string): Promise<boolean>;

  /**
   * Revoke the user's active sessions, keeping `keepSessionToken` alive when
   * it is a non-null token belonging to that user. Called after a password
   * change so the new credential kicks every other device while the caller
   * that performed the change stays signed in. Returns the number of sessions
   * deleted.
   */
  deleteSessions(uid: string, keepSessionToken: string | null): Promise<number>;
}
