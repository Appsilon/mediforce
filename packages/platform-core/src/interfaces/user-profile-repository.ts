/**
 * Per-user, Mediforce-side profile fields stored under `users/{uid}`.
 *
 * Distinct from `UserDirectoryService`, which surfaces Firebase Auth metadata
 * (email, lastSignInTime). `UserProfileRepository` owns the mutable
 * application-level fields that live on the same doc but are written by the
 * Mediforce app itself — today only `mustChangePassword`, but future profile
 * fields (preferences, default workspace, etc.) hang here too.
 */
export interface UserProfile {
  readonly mustChangePassword: boolean;
}

export interface UserProfileRepository {
  /**
   * Return the user's profile, or `null` when no `users/{uid}` doc exists yet.
   * Callers MUST default missing fields explicitly — this repository does not
   * synthesize a default profile for an absent doc.
   */
  getProfile(uid: string): Promise<UserProfile | null>;

  /**
   * Set `users/{uid}.mustChangePassword` via merge-write. Creates the doc if
   * it does not exist.
   */
  setMustChangePassword(uid: string, value: boolean): Promise<void>;
}
