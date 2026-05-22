import type { Namespace, NamespaceMember } from '../schemas/index.js';

export interface NamespaceRepository {
  getNamespace(handle: string): Promise<Namespace | null>;
  createNamespace(namespace: Namespace): Promise<void>;
  updateNamespace(handle: string, updates: Partial<Namespace>): Promise<void>;
  getNamespacesByUser(uid: string): Promise<Namespace[]>;
  addMember(handle: string, member: NamespaceMember): Promise<void>;
  removeMember(handle: string, uid: string): Promise<void>;
  getMember(handle: string, uid: string): Promise<NamespaceMember | null>;
  getMembers(handle: string): Promise<NamespaceMember[]>;
  getUserNamespaces(uid: string): Promise<Namespace[]>;
}
