export interface DirectoryUser {
  uid: string;
  email: string;
  displayName?: string;
}

export interface UserDirectoryService {
  getUsersByRole(role: string): Promise<DirectoryUser[]>;
  resolveUser?(identifier: string): Promise<DirectoryUser | null>;
}
