export interface DirectoryUser {
  uid: string;
  email: string;
  displayName?: string;
}

export interface UserAuthMetadata {
  email: string | null;
  displayName: string | null;
  lastSignInTime: string | null;
  photoURL: string | null;
}

export interface UserDirectoryService {
  getUsersByRole(role: string): Promise<DirectoryUser[]>;
  resolveUser?(identifier: string): Promise<DirectoryUser | null>;
  getUserMetadata(uid: string): Promise<UserAuthMetadata | null>;
}
