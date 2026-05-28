import type {
  Namespace,
  NamespaceMember,
  NamespaceMembership,
  NamespaceRepository,
} from '@mediforce/platform-core';

/**
 * Shared test double for `NamespaceRepository` used by the new PR4.5 handler
 * tests. Each method mirrors the semantics documented in the interface:
 * `createNamespaceWithOwner`, `removeMemberWithOrganizations`,
 * `deleteNamespaceCascade` keep the `users/{uid}.organizations` denormalised
 * array consistent with the member-subcollection so handler tests can
 * observe both sides of an "atomic" mutation.
 */
export class InMemoryNamespaceRepo implements NamespaceRepository {
  readonly namespaces = new Map<string, Namespace>();
  readonly members = new Map<string, NamespaceMember[]>();
  readonly userOrganizations = new Map<string, string[]>();

  seedNamespace(namespace: Namespace): void {
    this.namespaces.set(namespace.handle, namespace);
  }

  seedMember(handle: string, member: NamespaceMember): void {
    const existing = this.members.get(handle) ?? [];
    this.members.set(handle, [...existing.filter((m) => m.uid !== member.uid), member]);
    const orgs = this.userOrganizations.get(member.uid) ?? [];
    if (!orgs.includes(handle)) this.userOrganizations.set(member.uid, [...orgs, handle]);
  }

  async getNamespace(handle: string): Promise<Namespace | null> {
    return this.namespaces.get(handle) ?? null;
  }
  async createNamespace(namespace: Namespace): Promise<void> {
    this.namespaces.set(namespace.handle, namespace);
  }
  async createNamespaceWithOwner(input: { namespace: Namespace; ownerMember: NamespaceMember }): Promise<void> {
    this.namespaces.set(input.namespace.handle, input.namespace);
    this.seedMember(input.namespace.handle, input.ownerMember);
  }
  async updateNamespace(handle: string, updates: Partial<Namespace>): Promise<void> {
    const existing = this.namespaces.get(handle);
    if (existing === undefined) return;
    const merged: Namespace = { ...existing };
    for (const [key, value] of Object.entries(updates) as Array<[keyof Namespace, unknown]>) {
      if (value === undefined) {
        delete (merged as Record<string, unknown>)[key];
      } else {
        (merged as Record<string, unknown>)[key] = value;
      }
    }
    this.namespaces.set(handle, merged);
  }
  async getNamespacesByUser(): Promise<Namespace[]> {
    return [];
  }
  async addMember(handle: string, member: NamespaceMember): Promise<void> {
    this.seedMember(handle, member);
  }
  async removeMember(handle: string, uid: string): Promise<void> {
    const list = this.members.get(handle) ?? [];
    this.members.set(handle, list.filter((m) => m.uid !== uid));
  }
  async removeMemberWithOrganizations(handle: string, uid: string): Promise<void> {
    await this.removeMember(handle, uid);
    const orgs = this.userOrganizations.get(uid) ?? [];
    this.userOrganizations.set(uid, orgs.filter((h) => h !== handle));
  }
  async setMemberRole(handle: string, uid: string, role: NamespaceMember['role']): Promise<void> {
    const list = this.members.get(handle) ?? [];
    this.members.set(handle, list.map((m) => (m.uid === uid ? { ...m, role } : m)));
  }
  async deleteNamespaceCascade(handle: string): Promise<void> {
    const list = this.members.get(handle) ?? [];
    for (const member of list) {
      const orgs = this.userOrganizations.get(member.uid) ?? [];
      this.userOrganizations.set(member.uid, orgs.filter((h) => h !== handle));
    }
    this.members.delete(handle);
    this.namespaces.delete(handle);
  }
  async getMember(handle: string, uid: string): Promise<NamespaceMember | null> {
    return this.members.get(handle)?.find((m) => m.uid === uid) ?? null;
  }
  async getMembers(handle: string): Promise<NamespaceMember[]> {
    return this.members.get(handle) ?? [];
  }
  async getUserNamespaces(): Promise<Namespace[]> {
    return [];
  }
  async getMembershipsForUser(): Promise<readonly NamespaceMembership[]> {
    return [];
  }
}
