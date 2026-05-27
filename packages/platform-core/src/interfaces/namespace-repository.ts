import type { Namespace, NamespaceMember, NamespaceMembership } from '../schemas/index.js';

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

  /**
   * Return every namespace the user is a member of, with their role.
   *
   * Covers both:
   *   - org namespaces (member subcollection: explicit `role`).
   *   - personal namespace (`linkedUserId == uid`: implicit `owner`).
   *
   * Used by the route layer to build `CallerIdentity.namespaceRoles` so
   * handler-side gates (`assertCallerIsNamespaceAdmin`) can authorize without
   * an extra Firestore hit per request.
   */
  getMembershipsForUser(uid: string): Promise<readonly NamespaceMembership[]>;
}
