import { and, eq, inArray } from 'drizzle-orm';
import {
  NamespaceSchema,
  NamespaceMemberSchema,
  type Namespace,
  type NamespaceMember,
  type NamespaceRepository,
} from '@mediforce/platform-core';
import type { Database } from '../client.js';
import { workspaces, workspaceMembers } from '../schema/workspace.js';

/**
 * Postgres-backed NamespaceRepository (ADR-0001 PR2).
 *
 * Original Firestore layout: `namespaces/{handle}` + nested
 * `members/{uid}` subcollection. Postgres maps that to two tables:
 * `workspaces` (handle PK) and `workspace_members` (composite PK
 * workspace + uid, with a standalone `uid` index that replaces the
 * Firestore collectionGroup query used for `getUserNamespaces`).
 *
 * Validation matches the Firestore + in-memory backends exactly: parse
 * on every read AND every write (ADR-0001 Implementation pattern 2).
 */
export class PostgresNamespaceRepository implements NamespaceRepository {
  constructor(private readonly db: Database) {}

  async getNamespace(handle: string): Promise<Namespace | null> {
    const rows = await this.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.handle, handle))
      .limit(1);
    const row = rows[0];
    return row ? NamespaceSchema.parse(toNamespace(row)) : null;
  }

  async createNamespace(namespace: Namespace): Promise<void> {
    const parsed = NamespaceSchema.parse(namespace);
    await this.db.insert(workspaces).values({
      handle: parsed.handle,
      type: parsed.type,
      displayName: parsed.displayName,
      avatarUrl: parsed.avatarUrl ?? null,
      icon: parsed.icon ?? null,
      linkedUserId: parsed.linkedUserId ?? null,
      bio: parsed.bio ?? null,
      createdAt: new Date(parsed.createdAt),
    });
  }

  async updateNamespace(handle: string, updates: Partial<Namespace>): Promise<void> {
    const set: Record<string, unknown> = {};
    if (updates.type !== undefined) set.type = updates.type;
    if (updates.displayName !== undefined) set.displayName = updates.displayName;
    if (updates.avatarUrl !== undefined) set.avatarUrl = updates.avatarUrl;
    if (updates.icon !== undefined) set.icon = updates.icon;
    if (updates.linkedUserId !== undefined) set.linkedUserId = updates.linkedUserId;
    if (updates.bio !== undefined) set.bio = updates.bio;
    if (updates.createdAt !== undefined) set.createdAt = new Date(updates.createdAt);
    if (Object.keys(set).length === 0) return;
    await this.db.update(workspaces).set(set).where(eq(workspaces.handle, handle));
  }

  async getNamespacesByUser(uid: string): Promise<Namespace[]> {
    const personalRows = await this.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.linkedUserId, uid));
    const personal = personalRows.map((r) => NamespaceSchema.parse(toNamespace(r)));

    const organizations = await this.getUserNamespaces(uid);

    const seen = new Set(personal.map((n) => n.handle));
    const merged = [...personal];
    for (const ns of organizations) {
      if (!seen.has(ns.handle)) {
        seen.add(ns.handle);
        merged.push(ns);
      }
    }
    return merged;
  }

  async addMember(handle: string, member: NamespaceMember): Promise<void> {
    const parsed = NamespaceMemberSchema.parse(member);
    const values = {
      workspace: handle,
      uid: parsed.uid,
      role: parsed.role,
      displayName: parsed.displayName ?? null,
      avatarUrl: parsed.avatarUrl ?? null,
      joinedAt: new Date(parsed.joinedAt),
    };
    await this.db
      .insert(workspaceMembers)
      .values(values)
      .onConflictDoUpdate({
        target: [workspaceMembers.workspace, workspaceMembers.uid],
        set: {
          role: values.role,
          displayName: values.displayName,
          avatarUrl: values.avatarUrl,
          joinedAt: values.joinedAt,
        },
      });
  }

  async removeMember(handle: string, uid: string): Promise<void> {
    await this.db
      .delete(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspace, handle),
          eq(workspaceMembers.uid, uid),
        ),
      );
  }

  async getMember(handle: string, uid: string): Promise<NamespaceMember | null> {
    const rows = await this.db
      .select()
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspace, handle),
          eq(workspaceMembers.uid, uid),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row ? NamespaceMemberSchema.parse(toMember(row)) : null;
  }

  async getMembers(handle: string): Promise<NamespaceMember[]> {
    const rows = await this.db
      .select()
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspace, handle));
    return rows.map((r) => NamespaceMemberSchema.parse(toMember(r)));
  }

  async getUserNamespaces(uid: string): Promise<Namespace[]> {
    const memberRows = await this.db
      .select({ workspace: workspaceMembers.workspace })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.uid, uid));
    const handles = memberRows.map((r) => r.workspace);
    if (handles.length === 0) return [];
    const rows = await this.db
      .select()
      .from(workspaces)
      .where(inArray(workspaces.handle, handles));
    return rows.map((r) => NamespaceSchema.parse(toNamespace(r)));
  }
}

function toNamespace(row: typeof workspaces.$inferSelect): Namespace {
  const out: Record<string, unknown> = {
    handle: row.handle,
    type: row.type,
    displayName: row.displayName,
    createdAt: row.createdAt.toISOString(),
  };
  if (row.avatarUrl !== null && row.avatarUrl !== undefined) out.avatarUrl = row.avatarUrl;
  if (row.icon !== null && row.icon !== undefined) out.icon = row.icon;
  if (row.linkedUserId !== null && row.linkedUserId !== undefined) out.linkedUserId = row.linkedUserId;
  if (row.bio !== null && row.bio !== undefined) out.bio = row.bio;
  return out as Namespace;
}

function toMember(row: typeof workspaceMembers.$inferSelect): NamespaceMember {
  const out: Record<string, unknown> = {
    uid: row.uid,
    role: row.role,
    joinedAt: row.joinedAt.toISOString(),
  };
  if (row.displayName !== null && row.displayName !== undefined) out.displayName = row.displayName;
  if (row.avatarUrl !== null && row.avatarUrl !== undefined) out.avatarUrl = row.avatarUrl;
  return out as NamespaceMember;
}
