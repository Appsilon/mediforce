import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  CoworkSessionSchema,
  ConversationTurnSchema,
  type ConversationTurn,
  type CoworkSession,
  type CoworkSessionRepository,
  type ProcessInstanceRepository,
} from '@mediforce/platform-core';
import type { Database } from '../client';
import { coworkSessions, coworkTurns } from '../schema/cowork-session';

/**
 * Postgres-backed CoworkSessionRepository (ADR-0001, PLAN §1.2
 * cowork_sessions + cowork_turns).
 *
 * Two tables, one repo: sessions hold the header (lifecycle, agent
 * config, working artifact); turns hold the append-only conversation log
 * (with tool-turn fields nullable for human/agent turns). `getById`
 * issues two queries and rehydrates the full `CoworkSession.turns` array.
 *
 * Soft-mutable lifecycle: status active → finalized | abandoned. The
 * `set_updated_at` trigger on `cowork_sessions` maintains `updated_at` on
 * every UPDATE so callers don't have to bookkeep it. Turns are mutated
 * only via `updateTurn` (tool-status transitions) and have no
 * `updated_at` of their own — the parent session's timestamp already
 * records "last activity".
 *
 * The `workspace` column is derived at insert time from the parent
 * ProcessInstance — CoworkSession itself carries no namespace field
 * (mirrors audit/agent-run/human-task/handoff). Reads stay simple: rows
 * carry `workspace`, so namespace-scoped variants filter with
 * `workspace IN (...)` — no parent lookup on the read path.
 *
 * Validation matches the Firestore + in-memory backends: parse on every
 * read AND every write.
 */
export class PostgresCoworkSessionRepository
  implements CoworkSessionRepository
{
  constructor(
    private readonly db: Database,
    private readonly parents: ProcessInstanceRepository,
  ) {}

  async create(session: CoworkSession): Promise<CoworkSession> {
    const parsed = CoworkSessionSchema.parse(session);
    const parent = await this.parents.getById(parsed.processInstanceId);
    if (!parent || typeof parent.namespace !== 'string') {
      throw new Error(
        'PostgresCoworkSessionRepository.create: cannot resolve workspace — ' +
          `parent ProcessInstance ${parsed.processInstanceId} missing or has no namespace.`,
      );
    }
    const workspace = parent.namespace;

    await this.db.transaction(async (tx) => {
      await tx.insert(coworkSessions).values({
        id: parsed.id,
        workspace,
        processInstanceId: parsed.processInstanceId,
        stepId: parsed.stepId,
        assignedRole: parsed.assignedRole,
        assignedUserId: parsed.assignedUserId,
        status: parsed.status,
        agent: parsed.agent,
        model: parsed.model,
        systemPrompt: parsed.systemPrompt,
        outputSchema: parsed.outputSchema,
        voiceConfig: parsed.voiceConfig,
        mcpServers: parsed.mcpServers,
        artifact: parsed.artifact,
        validationResult: parsed.validationResult,
        presentation: parsed.presentation,
        finalizedAt: parsed.finalizedAt ? new Date(parsed.finalizedAt) : null,
        createdAt: new Date(parsed.createdAt),
        updatedAt: new Date(parsed.updatedAt),
      });
      for (let i = 0; i < parsed.turns.length; i += 1) {
        await tx.insert(coworkTurns).values(turnToRow(parsed.id, i, parsed.turns[i]));
      }
    });

    // Re-fetch to return the canonical shape (parses through Zod too).
    return (await this.getById(parsed.id))!;
  }

  async getById(sessionId: string): Promise<CoworkSession | null> {
    const rows = await this.db
      .select()
      .from(coworkSessions)
      .where(eq(coworkSessions.id, sessionId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const turnRows = await this.db
      .select()
      .from(coworkTurns)
      .where(eq(coworkTurns.sessionId, sessionId))
      .orderBy(asc(coworkTurns.idx));
    return CoworkSessionSchema.parse(toSession(row, turnRows));
  }

  async getByIdInNamespaces(
    sessionId: string,
    allowed: readonly string[],
  ): Promise<CoworkSession | null> {
    if (allowed.length === 0) return null;
    const rows = await this.db
      .select()
      .from(coworkSessions)
      .where(
        and(
          eq(coworkSessions.id, sessionId),
          inArray(coworkSessions.workspace, [...allowed]),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const turnRows = await this.db
      .select()
      .from(coworkTurns)
      .where(eq(coworkTurns.sessionId, sessionId))
      .orderBy(asc(coworkTurns.idx));
    return CoworkSessionSchema.parse(toSession(row, turnRows));
  }

  async getByInstanceId(instanceId: string): Promise<CoworkSession[]> {
    const rows = await this.db
      .select()
      .from(coworkSessions)
      .where(eq(coworkSessions.processInstanceId, instanceId))
      .orderBy(asc(coworkSessions.createdAt));
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const turnRows = await this.db
      .select()
      .from(coworkTurns)
      .where(inArray(coworkTurns.sessionId, ids))
      .orderBy(asc(coworkTurns.sessionId), asc(coworkTurns.idx));
    const turnsBySession = groupBySession(turnRows);
    return rows.map((r) =>
      CoworkSessionSchema.parse(toSession(r, turnsBySession.get(r.id) ?? [])),
    );
  }

  async listAll(): Promise<CoworkSession[]> {
    const rows = await this.db
      .select()
      .from(coworkSessions)
      .orderBy(desc(coworkSessions.createdAt));
    return this.rehydrate(rows);
  }

  async listInNamespaces(allowed: readonly string[]): Promise<CoworkSession[]> {
    if (allowed.length === 0) return [];
    const rows = await this.db
      .select()
      .from(coworkSessions)
      .where(inArray(coworkSessions.workspace, [...allowed]))
      .orderBy(desc(coworkSessions.createdAt));
    return this.rehydrate(rows);
  }

  async listByRoleAll(role: string): Promise<CoworkSession[]> {
    const rows = await this.db
      .select()
      .from(coworkSessions)
      .where(eq(coworkSessions.assignedRole, role))
      .orderBy(desc(coworkSessions.createdAt));
    return this.rehydrate(rows);
  }

  async listByRoleInNamespaces(
    role: string,
    allowed: readonly string[],
  ): Promise<CoworkSession[]> {
    if (allowed.length === 0) return [];
    const rows = await this.db
      .select()
      .from(coworkSessions)
      .where(
        and(
          eq(coworkSessions.assignedRole, role),
          inArray(coworkSessions.workspace, [...allowed]),
        ),
      )
      .orderBy(desc(coworkSessions.createdAt));
    return this.rehydrate(rows);
  }

  private async rehydrate(
    rows: (typeof coworkSessions.$inferSelect)[],
  ): Promise<CoworkSession[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const turnRows = await this.db
      .select()
      .from(coworkTurns)
      .where(inArray(coworkTurns.sessionId, ids))
      .orderBy(asc(coworkTurns.sessionId), asc(coworkTurns.idx));
    const turnsBySession = groupBySession(turnRows);
    return rows.map((r) =>
      CoworkSessionSchema.parse(toSession(r, turnsBySession.get(r.id) ?? [])),
    );
  }

  async findMostRecentActive(instanceId: string): Promise<CoworkSession | null> {
    const rows = await this.db
      .select()
      .from(coworkSessions)
      .where(
        and(
          eq(coworkSessions.processInstanceId, instanceId),
          eq(coworkSessions.status, 'active'),
        ),
      )
      .orderBy(desc(coworkSessions.createdAt))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const turnRows = await this.db
      .select()
      .from(coworkTurns)
      .where(eq(coworkTurns.sessionId, row.id))
      .orderBy(asc(coworkTurns.idx));
    return CoworkSessionSchema.parse(toSession(row, turnRows));
  }

  async findMostRecentActiveInNamespaces(
    instanceId: string,
    allowed: readonly string[],
  ): Promise<CoworkSession | null> {
    if (allowed.length === 0) return null;
    const rows = await this.db
      .select()
      .from(coworkSessions)
      .where(
        and(
          eq(coworkSessions.processInstanceId, instanceId),
          eq(coworkSessions.status, 'active'),
          inArray(coworkSessions.workspace, [...allowed]),
        ),
      )
      .orderBy(desc(coworkSessions.createdAt))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const turnRows = await this.db
      .select()
      .from(coworkTurns)
      .where(eq(coworkTurns.sessionId, row.id))
      .orderBy(asc(coworkTurns.idx));
    return CoworkSessionSchema.parse(toSession(row, turnRows));
  }

  async addTurn(sessionId: string, turn: ConversationTurn): Promise<CoworkSession> {
    const parsedTurn = ConversationTurnSchema.parse(turn);
    await this.db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: coworkSessions.id })
        .from(coworkSessions)
        .where(eq(coworkSessions.id, sessionId))
        .limit(1);
      if (existing.length === 0) {
        throw new Error(`CoworkSession not found: ${sessionId}`);
      }
      const maxRows = await tx
        .select({ next: sql<number>`coalesce(max(${coworkTurns.idx}), -1) + 1` })
        .from(coworkTurns)
        .where(eq(coworkTurns.sessionId, sessionId));
      const nextIdx = Number(maxRows[0]?.next ?? 0);
      await tx.insert(coworkTurns).values(turnToRow(sessionId, nextIdx, parsedTurn));
      // Touch the parent session so the trigger refreshes updated_at.
      await tx
        .update(coworkSessions)
        .set({ updatedAt: new Date() })
        .where(eq(coworkSessions.id, sessionId));
    });
    return (await this.getById(sessionId))!;
  }

  async updateTurn(
    sessionId: string,
    turnId: string,
    patch: Partial<ConversationTurn>,
  ): Promise<CoworkSession> {
    await this.db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(coworkTurns)
        .where(and(eq(coworkTurns.sessionId, sessionId), eq(coworkTurns.id, turnId)))
        .limit(1);
      if (existing.length === 0) {
        throw new Error(`Turn not found: ${turnId}`);
      }
      const current = existing[0];
      // role + id are immutable — patch cannot change the discriminant.
      const merged: Record<string, unknown> = {};
      if (patch.content !== undefined) merged.content = patch.content;
      if (patch.artifactDelta !== undefined) merged.artifactDelta = patch.artifactDelta;
      if (patch.timestamp !== undefined) merged.timestamp = new Date(patch.timestamp);
      if (current.role === 'tool') {
        const toolPatch = patch as Partial<ConversationTurn> & {
          toolName?: string;
          toolArgs?: Record<string, unknown>;
          toolResult?: string;
          toolStatus?: 'running' | 'success' | 'error';
          serverName?: string;
        };
        if (toolPatch.toolName !== undefined) merged.toolName = toolPatch.toolName;
        if (toolPatch.toolArgs !== undefined) merged.toolArgs = toolPatch.toolArgs;
        if (toolPatch.toolResult !== undefined) merged.toolResult = toolPatch.toolResult;
        if (toolPatch.toolStatus !== undefined) merged.toolStatus = toolPatch.toolStatus;
        if (toolPatch.serverName !== undefined) merged.serverName = toolPatch.serverName;
      }
      if (Object.keys(merged).length > 0) {
        await tx
          .update(coworkTurns)
          .set(merged)
          .where(and(eq(coworkTurns.sessionId, sessionId), eq(coworkTurns.id, turnId)));
      }
      await tx
        .update(coworkSessions)
        .set({ updatedAt: new Date() })
        .where(eq(coworkSessions.id, sessionId));
    });
    return (await this.getById(sessionId))!;
  }

  async updateArtifact(
    sessionId: string,
    artifact: Record<string, unknown>,
  ): Promise<CoworkSession> {
    const [row] = await this.db
      .update(coworkSessions)
      .set({ artifact })
      .where(eq(coworkSessions.id, sessionId))
      .returning({ id: coworkSessions.id });
    if (!row) throw new Error(`CoworkSession not found: ${sessionId}`);
    return (await this.getById(sessionId))!;
  }

  async updateValidationResult(
    sessionId: string,
    result: { valid: boolean; errors: string[] },
  ): Promise<CoworkSession> {
    const [row] = await this.db
      .update(coworkSessions)
      .set({ validationResult: result })
      .where(eq(coworkSessions.id, sessionId))
      .returning({ id: coworkSessions.id });
    if (!row) throw new Error(`CoworkSession not found: ${sessionId}`);
    return (await this.getById(sessionId))!;
  }

  async updatePresentation(sessionId: string, html: string): Promise<CoworkSession> {
    const [row] = await this.db
      .update(coworkSessions)
      .set({ presentation: html })
      .where(eq(coworkSessions.id, sessionId))
      .returning({ id: coworkSessions.id });
    if (!row) throw new Error(`CoworkSession not found: ${sessionId}`);
    return (await this.getById(sessionId))!;
  }

  async finalize(
    sessionId: string,
    artifact: Record<string, unknown>,
  ): Promise<CoworkSession> {
    const [row] = await this.db
      .update(coworkSessions)
      .set({
        status: 'finalized',
        artifact,
        finalizedAt: new Date(),
      })
      .where(eq(coworkSessions.id, sessionId))
      .returning({ id: coworkSessions.id });
    if (!row) throw new Error(`CoworkSession not found: ${sessionId}`);
    return (await this.getById(sessionId))!;
  }

  async abandon(sessionId: string): Promise<CoworkSession> {
    const [row] = await this.db
      .update(coworkSessions)
      .set({ status: 'abandoned' })
      .where(eq(coworkSessions.id, sessionId))
      .returning({ id: coworkSessions.id });
    if (!row) throw new Error(`CoworkSession not found: ${sessionId}`);
    return (await this.getById(sessionId))!;
  }
}

function turnToRow(
  sessionId: string,
  idx: number,
  turn: ConversationTurn,
): typeof coworkTurns.$inferInsert {
  const base = {
    id: turn.id,
    sessionId,
    idx,
    role: turn.role,
    content: turn.content,
    artifactDelta: turn.artifactDelta,
    timestamp: new Date(turn.timestamp),
  };
  if (turn.role === 'tool') {
    return {
      ...base,
      toolName: turn.toolName,
      toolArgs: turn.toolArgs,
      toolResult: turn.toolResult ?? null,
      toolStatus: turn.toolStatus,
      serverName: turn.serverName,
    };
  }
  return base;
}

function toSession(
  row: typeof coworkSessions.$inferSelect,
  turnRows: (typeof coworkTurns.$inferSelect)[],
): CoworkSession {
  return {
    id: row.id,
    processInstanceId: row.processInstanceId,
    stepId: row.stepId,
    assignedRole: row.assignedRole,
    assignedUserId: row.assignedUserId,
    status: row.status as CoworkSession['status'],
    agent: row.agent as CoworkSession['agent'],
    model: row.model,
    systemPrompt: row.systemPrompt,
    outputSchema: row.outputSchema as CoworkSession['outputSchema'],
    voiceConfig: row.voiceConfig as CoworkSession['voiceConfig'],
    artifact: row.artifact as CoworkSession['artifact'],
    validationResult: row.validationResult as CoworkSession['validationResult'],
    presentation: row.presentation as CoworkSession['presentation'] ?? null,
    mcpServers: row.mcpServers as CoworkSession['mcpServers'],
    turns: turnRows.map(toTurn),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    finalizedAt: row.finalizedAt ? row.finalizedAt.toISOString() : null,
  };
}

function toTurn(row: typeof coworkTurns.$inferSelect): ConversationTurn {
  const base = {
    id: row.id,
    content: row.content,
    timestamp: row.timestamp.toISOString(),
    artifactDelta: (row.artifactDelta as Record<string, unknown> | null) ?? null,
  };
  if (row.role === 'tool') {
    return {
      ...base,
      role: 'tool',
      toolName: row.toolName ?? '',
      toolArgs: (row.toolArgs as Record<string, unknown>) ?? {},
      toolStatus: (row.toolStatus ?? 'running') as 'running' | 'success' | 'error',
      serverName: row.serverName ?? '',
      toolResult: row.toolResult ?? undefined,
    };
  }
  return {
    ...base,
    role: row.role as 'human' | 'agent',
  };
}

function groupBySession(
  rows: (typeof coworkTurns.$inferSelect)[],
): Map<string, (typeof coworkTurns.$inferSelect)[]> {
  const map = new Map<string, (typeof coworkTurns.$inferSelect)[]>();
  for (const row of rows) {
    const list = map.get(row.sessionId) ?? [];
    list.push(row);
    map.set(row.sessionId, list);
  }
  return map;
}
