import type {
  Namespace,
  NamespaceMember,
  NamespaceMembership,
  NamespaceRepository,
  NamespaceUpdates,
} from '@mediforce/platform-core';

/**
 * In-memory `NamespaceRepository` shared by every test that exercises the
 * namespace handlers, the integration loopback, or the getMe bootstrap path.
 * Mirrors the Firestore impl's atomic mutations so tests can observe both
 * sides of an "atomic" operation: the member subcollection AND the
 * denormalised `users/{uid}.organizations` array.
 */
export class InMemoryNamespaceRepo implements NamespaceRepository {
  readonly namespaces = new Map<string, Namespace>();
  readonly members = new Map<string, NamespaceMember[]>();
  readonly userOrganizations = new Map<string, string[]>();

  /** Seed a namespace doc without touching the member subcollection. */
  seedNamespace(namespace: Namespace): void {
    this.namespaces.set(namespace.handle, namespace);
  }

  /** Seed a member doc and keep the denormalised organizations array in sync. */
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
  async updateNamespace(handle: string, updates: NamespaceUpdates): Promise<void> {
    const existing = this.namespaces.get(handle);
    if (existing === undefined) return;
    const merged: Record<string, unknown> = { ...existing };
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) continue;
      if (value === null) {
        delete merged[key];
      } else {
        merged[key] = value;
      }
    }
    this.namespaces.set(handle, merged as Namespace);
  }
  async getNamespacesByUser(uid: string): Promise<Namespace[]> {
    const out: Namespace[] = [];
    const seen = new Set<string>();
    for (const ns of this.namespaces.values()) {
      if (ns.type === 'personal' && ns.linkedUserId === uid) {
        out.push(ns);
        seen.add(ns.handle);
      }
    }
    for (const handle of this.userOrganizations.get(uid) ?? []) {
      if (seen.has(handle)) continue;
      const ns = this.namespaces.get(handle);
      if (ns !== undefined) out.push(ns);
    }
    return out;
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
  async getUserNamespaces(uid: string): Promise<Namespace[]> {
    return this.getNamespacesByUser(uid);
  }
  async getMembershipsForUser(uid: string): Promise<readonly NamespaceMembership[]> {
    const out: NamespaceMembership[] = [];
    for (const ns of this.namespaces.values()) {
      if (ns.type === 'personal' && ns.linkedUserId === uid) {
        out.push({ handle: ns.handle, role: 'owner' });
      }
    }
    for (const handle of this.userOrganizations.get(uid) ?? []) {
      const member = await this.getMember(handle, uid);
      if (member !== null && !out.some((m) => m.handle === handle)) {
        out.push({ handle, role: member.role });
      }
    }
    return out;
  }
}
