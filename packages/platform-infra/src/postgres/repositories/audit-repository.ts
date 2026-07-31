import { and, asc, desc, eq, gte, inArray, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import {
  AuditEventSchema,
  parseRow,
  encodeAuditEventCursor,
  decodeAuditEventCursor,
  type AuditEvent,
  type AuditRepository,
  type GetByNamespaceOptions,
  type GetByNamespacePage,
  type ProcessInstanceRepository,
} from '@mediforce/platform-core';
import type { Database } from '../client';
import { auditEvents } from '../schema/audit-event';

/**
 * Postgres-backed AuditRepository (ADR-0001, PLAN §1.2 audit_events).
 *
 * Append-only. The hot query columns (actor, action, entity, process,
 * timestamps) are extracted; the legible/snapshot payload lives in a
 * single jsonb column. The `workspace` column is derived at insert time
 * from the parent ProcessInstance — AuditEvent itself carries no
 * namespace, so we resolve it via the injected
 * `ProcessInstanceRepository` (mirrors the Firestore impl).
 *
 * Reads stay simple: rows already carry `workspace`, so
 * `getByProcessInNamespaces` filters with `workspace = ANY($)` — no
 * parent lookup needed on the read path.
 *
 * Validation matches the Firestore + in-memory backends: parse on every
 * read AND every write (ADR-0001 Implementation pattern 2).
 */
export class PostgresAuditRepository implements AuditRepository {
  constructor(
    private readonly db: Database,
    private readonly parents: ProcessInstanceRepository,
  ) {}

  async append(
    event: Omit<AuditEvent, 'serverTimestamp'>,
  ): Promise<AuditEvent> {
    let workspace: string | undefined = event.namespace;
    if (workspace === undefined && typeof event.processInstanceId === 'string') {
      const parent = await this.parents.getById(event.processInstanceId);
      if (parent && typeof parent.namespace === 'string') {
        workspace = parent.namespace;
      }
    }
    if (workspace === undefined) {
      throw new Error(
        'PostgresAuditRepository.append: cannot resolve workspace — ' +
          'neither event.namespace nor a parent-instance namespace is available.',
      );
    }

    const [row] = await this.db
      .insert(auditEvents)
      .values({
        workspace,
        actorId: event.actorId,
        actorType: event.actorType,
        actorRole: event.actorRole,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        processInstanceId: event.processInstanceId ?? null,
        stepId: event.stepId ?? null,
        processDefinitionVersion: event.processDefinitionVersion ?? null,
        executorType: event.executorType ?? null,
        reviewerType: event.reviewerType ?? null,
        timestamp: new Date(event.timestamp),
        payload: {
          description: event.description,
          basis: event.basis,
          inputSnapshot: event.inputSnapshot,
          outputSnapshot: event.outputSnapshot,
        },
      })
      .returning();
    return toAuditEvent(row);
  }

  async getByEntity(
    entityType: string,
    entityId: string,
  ): Promise<AuditEvent[]> {
    const rows = await this.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.entityType, entityType),
          eq(auditEvents.entityId, entityId),
        ),
      )
      .orderBy(desc(auditEvents.timestamp));
    return rows.map((r) => toAuditEvent(r));
  }

  async getByProcess(processInstanceId: string): Promise<AuditEvent[]> {
    const rows = await this.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.processInstanceId, processInstanceId))
      .orderBy(asc(auditEvents.timestamp));
    return rows.map((r) => toAuditEvent(r));
  }

  async getByProcessInNamespaces(
    processInstanceId: string,
    allowed: readonly string[],
  ): Promise<AuditEvent[]> {
    if (allowed.length === 0) return [];
    const rows = await this.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.processInstanceId, processInstanceId),
          inArray(auditEvents.workspace, [...allowed]),
        ),
      )
      .orderBy(asc(auditEvents.timestamp));
    return rows.map((r) => toAuditEvent(r));
  }

  async getByActor(
    actorId: string,
    options?: { limit?: number },
  ): Promise<AuditEvent[]> {
    const base = this.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.actorId, actorId))
      .orderBy(desc(auditEvents.timestamp));
    const rows = options?.limit ? await base.limit(options.limit) : await base;
    return rows.map((r) => toAuditEvent(r));
  }

  async getByNamespace(
    namespace: string,
    options?: GetByNamespaceOptions,
  ): Promise<GetByNamespacePage> {
    const conditions: SQL[] = [eq(auditEvents.workspace, namespace)];
    if (options?.actions !== undefined && options.actions.length > 0) {
      conditions.push(inArray(auditEvents.action, [...options.actions]));
    }
    if (options?.actorId !== undefined) {
      conditions.push(eq(auditEvents.actorId, options.actorId));
    }
    if (options?.fromDate !== undefined) {
      conditions.push(gte(auditEvents.timestamp, new Date(`${options.fromDate}T00:00:00.000Z`)));
    }
    if (options?.toDate !== undefined) {
      conditions.push(lte(auditEvents.timestamp, new Date(`${options.toDate}T23:59:59.999Z`)));
    }
    if (options?.cursor !== undefined) {
      const after = decodeAuditEventCursor(options.cursor);
      if (after !== null) {
        // Keyset (timestamp, id) DESC: emit rows strictly past the cursor.
        conditions.push(
          or(
            lt(auditEvents.timestamp, new Date(after.timestamp)),
            and(
              eq(auditEvents.timestamp, new Date(after.timestamp)),
              sql`${auditEvents.id} < ${after.id}`,
            ),
          )!,
        );
      }
    }
    const limit = options?.limit ?? 20;
    const rows = await this.db
      .select()
      .from(auditEvents)
      .where(and(...conditions))
      .orderBy(desc(auditEvents.timestamp), desc(auditEvents.id))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const items = pageRows.map((r) => toAuditEvent(r));
    const last = pageRows[pageRows.length - 1];
    if (hasMore && last !== undefined) {
      return {
        items,
        nextCursor: encodeAuditEventCursor(last.timestamp.toISOString(), last.id),
      };
    }
    return { items };
  }
}

function toAuditEvent(row: typeof auditEvents.$inferSelect): AuditEvent {
  const payload = row.payload;
  return parseRow(AuditEventSchema, {
    id: row.id,
    actorId: row.actorId,
    actorType: row.actorType,
    actorRole: row.actorRole,
    action: row.action,
    description: payload.description,
    timestamp: row.timestamp.toISOString(),
    serverTimestamp: row.serverTimestamp.toISOString(),
    inputSnapshot: payload.inputSnapshot,
    outputSnapshot: payload.outputSnapshot,
    basis: payload.basis,
    entityType: row.entityType,
    entityId: row.entityId,
    processInstanceId: row.processInstanceId ?? undefined,
    stepId: row.stepId ?? undefined,
    processDefinitionVersion: row.processDefinitionVersion ?? undefined,
    executorType: row.executorType ?? undefined,
    reviewerType: row.reviewerType ?? undefined,
  });
}
