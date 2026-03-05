export interface AuthUser {
  uid: string;
  email: string;
  displayName: string | null;
  roles: string[];
}

export interface AuthService {
  getCurrentUser(): Promise<AuthUser | null>;
  requireAuth(): Promise<AuthUser>;
  requireRole(role: string): Promise<AuthUser>;
  onAuthStateChanged(callback: (user: AuthUser | null) => void): () => void;
  signOut(): Promise<void>;
}
