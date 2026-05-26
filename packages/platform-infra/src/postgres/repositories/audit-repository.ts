import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import {
  AuditEventSchema,
  type AuditEvent,
  type AuditRepository,
  type ProcessInstanceRepository,
} from '@mediforce/platform-core';
import type { Database } from '../client.js';
import { auditEvents } from '../schema/audit-event.js';

/**
 * Postgres-backed AuditRepository (ADR-0001 PR2, PLAN §1.2 audit_events).
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
    let workspace: string | undefined;
    if (typeof event.processInstanceId === 'string') {
      const parent = await this.parents.getById(event.processInstanceId);
      if (parent && typeof parent.namespace === 'string') {
        workspace = parent.namespace;
      }
    }
    if (workspace === undefined) {
      throw new Error(
        'PostgresAuditRepository.append: cannot resolve workspace — ' +
          'event.processInstanceId is missing or its parent run has no namespace.',
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
    return AuditEventSchema.parse(toAuditEvent(row));
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
    return rows.map((r) => AuditEventSchema.parse(toAuditEvent(r)));
  }

  async getByProcess(processInstanceId: string): Promise<AuditEvent[]> {
    const rows = await this.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.processInstanceId, processInstanceId))
      .orderBy(asc(auditEvents.timestamp));
    return rows.map((r) => AuditEventSchema.parse(toAuditEvent(r)));
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
    return rows.map((r) => AuditEventSchema.parse(toAuditEvent(r)));
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
    return rows.map((r) => AuditEventSchema.parse(toAuditEvent(r)));
  }
}

function toAuditEvent(row: typeof auditEvents.$inferSelect): AuditEvent {
  const payload = row.payload;
  const out: Record<string, unknown> = {
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
  };
  if (row.processInstanceId !== null) out.processInstanceId = row.processInstanceId;
  if (row.stepId !== null) out.stepId = row.stepId;
  if (row.processDefinitionVersion !== null)
    out.processDefinitionVersion = row.processDefinitionVersion;
  if (row.executorType !== null) out.executorType = row.executorType;
  if (row.reviewerType !== null) out.reviewerType = row.reviewerType;
  return out as AuditEvent;
}
