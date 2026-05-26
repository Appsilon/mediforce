import {
  NamespaceSchema,
  NamespaceMemberSchema,
  type Namespace,
  type NamespaceMember,
} from '../schemas/namespace.js';
import type { NamespaceRepository } from '../interfaces/namespace-repository.js';

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

  /** Test helper: wipe all namespaces + members. */
  clear(): void {
    this.namespaces.clear();
    this.members.clear();
  }
}
