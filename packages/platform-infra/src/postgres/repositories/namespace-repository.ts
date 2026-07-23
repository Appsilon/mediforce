import { and, eq, inArray } from 'drizzle-orm';
import {
  NamespaceSchema,
  NamespaceMemberSchema,
  parseRow,
  type Namespace,
  type NamespaceMember,
  type NamespaceMembership,
  type NamespaceRepository,
} from '@mediforce/platform-core';
import type { Database } from '../client';
import { workspaces, workspaceMembers } from '../schema/workspace';

/**
 * Postgres-backed NamespaceRepository (ADR-0001).
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
    return row ? toNamespace(row) : null;
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

  async createNamespaceWithOwner(input: {
    namespace: Namespace;
    ownerMember: NamespaceMember;
  }): Promise<void> {
    const parsedNs = NamespaceSchema.parse(input.namespace);
    const parsedMember = NamespaceMemberSchema.parse(input.ownerMember);
    // Drizzle's transaction helper rolls back if the callback throws, giving
    // us the same all-or-nothing semantic as the Firestore WriteBatch path.
    await this.db.transaction(async (tx) => {
      await tx.insert(workspaces).values({
        handle: parsedNs.handle,
        type: parsedNs.type,
        displayName: parsedNs.displayName,
        avatarUrl: parsedNs.avatarUrl ?? null,
        icon: parsedNs.icon ?? null,
        linkedUserId: parsedNs.linkedUserId ?? null,
        bio: parsedNs.bio ?? null,
        createdAt: new Date(parsedNs.createdAt),
      });
      await tx.insert(workspaceMembers).values({
        workspace: parsedNs.handle,
        uid: parsedMember.uid,
        role: parsedMember.role,
        displayName: parsedMember.displayName ?? null,
        avatarUrl: parsedMember.avatarUrl ?? null,
        joinedAt: new Date(parsedMember.joinedAt),
      });
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
    const personal = personalRows.map((r) => toNamespace(r));

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

  async removeMemberWithOrganizations(handle: string, uid: string): Promise<void> {
    // Postgres membership lives entirely in `workspace_members`; there is no
    // `users/{uid}.organizations` denormalisation to keep in sync (that was a
    // Firestore-only mirror). Deleting the join-table row IS the org removal.
    await this.db
      .delete(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspace, handle),
          eq(workspaceMembers.uid, uid),
        ),
      );
  }

  async setMemberRole(
    handle: string,
    uid: string,
    role: NamespaceMember['role'],
  ): Promise<void> {
    await this.db
      .update(workspaceMembers)
      .set({ role })
      .where(
        and(
          eq(workspaceMembers.workspace, handle),
          eq(workspaceMembers.uid, uid),
        ),
      );
  }

  async deleteNamespaceCascade(handle: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(workspaceMembers)
        .where(eq(workspaceMembers.workspace, handle));
      await tx.delete(workspaces).where(eq(workspaces.handle, handle));
    });
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
    return row ? toMember(row) : null;
  }

  async getMembers(handle: string): Promise<NamespaceMember[]> {
    const rows = await this.db
      .select()
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspace, handle));
    return rows.map((r) => toMember(r));
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
    return rows.map((r) => toNamespace(r));
  }

  async getMembershipsForUser(uid: string): Promise<readonly NamespaceMembership[]> {
    // Explicit org memberships from workspace_members.
    const orgRows = await this.db
      .select({ handle: workspaceMembers.workspace, role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.uid, uid));
    // Implicit personal-workspace owner via workspaces.linkedUserId.
    const personalRows = await this.db
      .select({ handle: workspaces.handle })
      .from(workspaces)
      .where(eq(workspaces.linkedUserId, uid));

    const out: NamespaceMembership[] = personalRows.map((r) => ({
      handle: r.handle,
      role: 'owner' as const,
    }));
    const seen = new Set(out.map((m) => m.handle));
    for (const row of orgRows) {
      if (!seen.has(row.handle)) {
        seen.add(row.handle);
        out.push({ handle: row.handle, role: row.role as 'owner' | 'admin' | 'member' });
      }
    }
    return out;
  }
}

function toNamespace(row: typeof workspaces.$inferSelect): Namespace {
  return parseRow(NamespaceSchema, {
    handle: row.handle,
    type: row.type,
    displayName: row.displayName,
    createdAt: row.createdAt.toISOString(),
    avatarUrl: row.avatarUrl ?? undefined,
    icon: row.icon ?? undefined,
    linkedUserId: row.linkedUserId ?? undefined,
    bio: row.bio ?? undefined,
  });
}

function toMember(row: typeof workspaceMembers.$inferSelect): NamespaceMember {
  return parseRow(NamespaceMemberSchema, {
    uid: row.uid,
    role: row.role,
    joinedAt: row.joinedAt.toISOString(),
    displayName: row.displayName ?? undefined,
    avatarUrl: row.avatarUrl ?? undefined,
  });
}
