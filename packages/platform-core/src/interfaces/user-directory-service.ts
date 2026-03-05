export interface DirectoryUser {
  uid: string;
  email: string;
}

export interface UserDirectoryService {
  getUsersByRole(role: string): Promise<DirectoryUser[]>;
}
