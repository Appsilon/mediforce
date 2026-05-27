export interface DirectoryUser {
  uid: string;
  email: string;
}

export interface UserAuthMetadata {
  email: string | null;
  lastSignInTime: string | null;
}

export interface UserDirectoryService {
  getUsersByRole(role: string): Promise<DirectoryUser[]>;
  /**
   * Look up a user's email + lastSignInTime by uid. Returns `null` when the
   * user is not known to the directory (e.g. Firebase Auth `auth/user-not-found`).
   * Callers treat the result as best-effort metadata — never block on it.
   */
  getUserMetadata(uid: string): Promise<UserAuthMetadata | null>;
}
