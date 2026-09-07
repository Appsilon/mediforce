import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from '../postgres/client';
import { workspaceJoinLinks } from '../postgres/schema/workspace';

/**
 * Membership a join link may grant. Never `owner` (ADR-0021 §3) — owner is the
 * seat that can delete the workspace, and no link handed to a room grants it.
 */
export type JoinLinkMembership = 'admin' | 'member';

export interface JoinLinkRecord {
  readonly id: string;
  readonly workspace: string;
  readonly membership: JoinLinkMembership;
  readonly expiresAt: string;
  readonly maxUses: number | null;
  readonly uses: number;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly revokedAt: string | null;
}

export interface CreateJoinLinkRecord {
  readonly id: string;
  readonly workspace: string;
  readonly tokenHash: string;
  readonly membership: JoinLinkMembership;
  readonly expiresAt: Date;
  readonly maxUses: number | null;
  readonly createdBy: string;
}

export type JoinLinkRejection = 'not_found' | 'revoked' | 'expired' | 'exhausted';

export type JoinLinkLookup =
  | { readonly ok: true; readonly link: JoinLinkRecord }
  | { readonly ok: false; readonly reason: JoinLinkRejection };

type Row = typeof workspaceJoinLinks.$inferSelect;

function toRecord(row: Row): JoinLinkRecord {
  return {
    id: row.id,
    workspace: row.workspace,
    membership: row.membership as JoinLinkMembership,
    expiresAt: row.expiresAt.toISOString(),
    maxUses: row.maxUses,
    uses: row.uses,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

/**
 * Why a row cannot be redeemed, evaluated in the order a holder cares about:
 * an admin's revocation outranks the clock, and the clock outranks a full
 * link. Shared by `find` (read-only) and `claim` (consuming) so the landing
 * page and the redemption can never disagree about a link's state.
 */
function rejectionFor(row: Row, now: Date): JoinLinkRejection | null {
  if (row.revokedAt !== null) return 'revoked';
  if (row.expiresAt.getTime() <= now.getTime()) return 'expired';
  if (row.maxUses !== null && row.uses >= row.maxUses) return 'exhausted';
  return null;
}

/**
 * Postgres store for workspace join links (ADR-0021).
 *
 * Reads and writes hashes only — the plaintext token exists for exactly as
 * long as the create response, so a database dump cannot be replayed into
 * anybody's workspace.
 */
export class PostgresJoinLinkService {
  constructor(private readonly db: Database) {}

  async create(record: CreateJoinLinkRecord): Promise<JoinLinkRecord> {
    const [row] = await this.db
      .insert(workspaceJoinLinks)
      .values({
        id: record.id,
        workspace: record.workspace,
        tokenHash: record.tokenHash,
        membership: record.membership,
        expiresAt: record.expiresAt,
        maxUses: record.maxUses,
        createdBy: record.createdBy,
      })
      .returning();
    if (row === undefined) throw new Error('Failed to create join link');
    return toRecord(row);
  }

  async listForWorkspace(workspace: string): Promise<readonly JoinLinkRecord[]> {
    const rows = await this.db
      .select()
      .from(workspaceJoinLinks)
      .where(eq(workspaceJoinLinks.workspace, workspace))
      .orderBy(desc(workspaceJoinLinks.createdAt));
    return rows.map(toRecord);
  }

  /**
   * Revoking is idempotent-safe rather than idempotent: the `revoked_at IS
   * NULL` predicate means a second call finds nothing and returns `null`, so
   * the handler can tell "revoked it" from "there was nothing live to revoke"
   * without a second round-trip.
   */
  async revoke(workspace: string, id: string, now: Date): Promise<JoinLinkRecord | null> {
    const [row] = await this.db
      .update(workspaceJoinLinks)
      .set({ revokedAt: now })
      .where(
        and(
          eq(workspaceJoinLinks.id, id),
          eq(workspaceJoinLinks.workspace, workspace),
          isNull(workspaceJoinLinks.revokedAt),
        ),
      )
      .returning();
    return row === undefined ? null : toRecord(row);
  }

  async find(tokenHash: string, now: Date): Promise<JoinLinkLookup> {
    const [row] = await this.db
      .select()
      .from(workspaceJoinLinks)
      .where(eq(workspaceJoinLinks.tokenHash, tokenHash))
      .limit(1);
    if (row === undefined) return { ok: false, reason: 'not_found' };
    const rejection = rejectionFor(row, now);
    return rejection === null ? { ok: true, link: toRecord(row) } : { ok: false, reason: rejection };
  }

  /**
   * Consume one use. The row is taken `FOR UPDATE` before the cap is checked so
   * two attendees redeeming the last seat of a capped link serialize — without
   * it both read `uses = maxUses - 1` and both succeed, handing out a seat that
   * does not exist.
   */
  async claim(tokenHash: string, now: Date): Promise<JoinLinkLookup> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(workspaceJoinLinks)
        .where(eq(workspaceJoinLinks.tokenHash, tokenHash))
        .limit(1)
        .for('update');
      if (row === undefined) return { ok: false, reason: 'not_found' } as const;

      const rejection = rejectionFor(row, now);
      if (rejection !== null) return { ok: false, reason: rejection } as const;

      const [updated] = await tx
        .update(workspaceJoinLinks)
        .set({ uses: sql`${workspaceJoinLinks.uses} + 1` })
        .where(eq(workspaceJoinLinks.id, row.id))
        .returning();
      if (updated === undefined) throw new Error('Failed to consume join link');
      return { ok: true, link: toRecord(updated) } as const;
    });
  }
}
