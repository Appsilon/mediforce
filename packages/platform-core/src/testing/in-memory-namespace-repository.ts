import {
  NamespaceSchema,
  NamespaceMemberSchema,
  type Namespace,
  type NamespaceMember,
  type NamespaceMembership,
} from '../schemas/namespace';
import type { NamespaceRepository } from '../interfaces/namespace-repository';

/**
 * In-memory NamespaceRepository double. Mirrors the Firestore + Postgres
 * backends — every write parses through Zod (parity with both real
 * backends, per ADR-0001 Implementation pattern 2).
 *
 * Members are stored per-namespace in nested maps keyed by uid, matching
 * the Firestore subcollection layout and the Postgres composite-PK layout.
 */
export class InMemoryNamespaceRepository implements NamespaceRepository {
  private readonly namespaces = new Map<string, Namespace>();
  private readonly members = new Map<string, Map<string, NamespaceMember>>();

  async getNamespace(handle: string): Promise<Namespace | null> {
    const ns = this.namespaces.get(handle);
    return ns ? { ...ns } : null;
  }

  async createNamespace(namespace: Namespace): Promise<void> {
    const parsed = NamespaceSchema.parse(namespace);
    this.namespaces.set(parsed.handle, { ...parsed });
  }

  async createNamespaceWithOwner(input: {
    namespace: Namespace;
    ownerMember: NamespaceMember;
  }): Promise<void> {
    const parsedNs = NamespaceSchema.parse(input.namespace);
    const parsedMember = NamespaceMemberSchema.parse(input.ownerMember);
    this.namespaces.set(parsedNs.handle, { ...parsedNs });
    const bucket = this.members.get(parsedNs.handle) ?? new Map<string, NamespaceMember>();
    bucket.set(parsedMember.uid, { ...parsedMember });
    this.members.set(parsedNs.handle, bucket);
  }

  async updateNamespace(handle: string, updates: Partial<Namespace>): Promise<void> {
    const current = this.namespaces.get(handle);
    if (!current) return;
    const merged = NamespaceSchema.parse({ ...current, ...updates });
    this.namespaces.set(handle, merged);
  }

  async getNamespacesByUser(uid: string): Promise<Namespace[]> {
    const personal = [...this.namespaces.values()].filter((n) => n.linkedUserId === uid);
    const organizations = await this.getUserNamespaces(uid);
    const seen = new Set(personal.map((n) => n.handle));
    const merged = [...personal];
    for (const ns of organizations) {
      if (!seen.has(ns.handle)) {
        seen.add(ns.handle);
        merged.push(ns);
      }
    }
    return merged.map((n) => ({ ...n }));
  }

  async addMember(handle: string, member: NamespaceMember): Promise<void> {
    const parsed = NamespaceMemberSchema.parse(member);
    const bucket = this.members.get(handle) ?? new Map<string, NamespaceMember>();
    bucket.set(parsed.uid, { ...parsed });
    this.members.set(handle, bucket);
  }

  async removeMember(handle: string, uid: string): Promise<void> {
    this.members.get(handle)?.delete(uid);
  }

  async removeMemberWithOrganizations(handle: string, uid: string): Promise<void> {
    // In-memory double has no `users/{uid}.organizations` mirror to keep in
    // sync — the namespace-side delete is sufficient for tests.
    this.members.get(handle)?.delete(uid);
  }

  async setMemberRole(
    handle: string,
    uid: string,
    role: NamespaceMember['role'],
  ): Promise<void> {
    const bucket = this.members.get(handle);
    const current = bucket?.get(uid);
    if (!bucket || !current) return;
    bucket.set(uid, { ...current, role });
  }

  async deleteNamespaceCascade(handle: string): Promise<void> {
    this.members.delete(handle);
    this.namespaces.delete(handle);
  }

  async getMember(handle: string, uid: string): Promise<NamespaceMember | null> {
    const member = this.members.get(handle)?.get(uid);
    return member ? { ...member } : null;
  }

  async getMembers(handle: string): Promise<NamespaceMember[]> {
    const bucket = this.members.get(handle);
    return bucket ? [...bucket.values()].map((m) => ({ ...m })) : [];
  }

  async getUserNamespaces(uid: string): Promise<Namespace[]> {
    const handles: string[] = [];
    for (const [handle, bucket] of this.members) {
      if (bucket.has(uid)) handles.push(handle);
    }
    return handles
      .map((h) => this.namespaces.get(h))
      .filter((n): n is Namespace => n !== undefined)
      .map((n) => ({ ...n }));
  }

  async getMembershipsForUser(uid: string): Promise<readonly NamespaceMembership[]> {
    const out: NamespaceMembership[] = [];
    // Personal namespace: implicit owner via linkedUserId.
    for (const ns of this.namespaces.values()) {
      if (ns.linkedUserId === uid) out.push({ handle: ns.handle, role: 'owner' });
    }
    // Org namespaces: explicit member role.
    for (const [handle, bucket] of this.members) {
      const member = bucket.get(uid);
      if (member && !out.some((m) => m.handle === handle)) {
        out.push({ handle, role: member.role });
      }
    }
    return out;
  }

  /** Test helper: wipe all namespaces + members. */
  clear(): void {
    this.namespaces.clear();
    this.members.clear();
  }
}
