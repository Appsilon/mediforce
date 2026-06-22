import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  HandoffEntitySchema,
  handoffTypeRegistry,
  type HandoffEntity,
  type HandoffRepository,
  type ProcessInstanceRepository,
} from '@mediforce/platform-core';
import type { Database } from '../client';
import { handoffEntities } from '../schema/handoff';

/**
 * Postgres-backed HandoffRepository (ADR-0001, PLAN §1.2 handoff_entities).
 *
 * Soft-mutable lifecycle: status transitions created → acknowledged →
 * resolved. The `set_updated_at` trigger maintains `updated_at` on every
 * UPDATE so the Firestore-style "updated when?" semantics are preserved
 * without per-mutation bookkeeping in the repo.
 *
 * The `workspace` column is derived at insert time from the parent
 * ProcessInstance — HandoffEntity itself carries no namespace field, so we
 * resolve it via the injected `ProcessInstanceRepository` (mirrors the
 * Firestore impl and the agent-run / human-task repos). Reads stay simple:
 * rows already carry `workspace`, so namespace-scoped variants filter with
 * `workspace = ANY($)` — no parent lookup needed on the read path.
 *
 * Validation matches the Firestore + in-memory backends: parse on every
 * read AND every write (ADR-0001 Implementation pattern 2). `resolve()`
 * additionally validates the app-defined resolution via the
 * handoffTypeRegistry, mirroring the Firestore impl.
 */
export class PostgresHandoffRepository implements HandoffRepository {
  constructor(
    private readonly db: Database,
    private readonly parents: ProcessInstanceRepository,
  ) {}

  async create(entity: HandoffEntity): Promise<HandoffEntity> {
    const parsed = HandoffEntitySchema.parse(entity);
    const parent = await this.parents.getById(parsed.processInstanceId);
    if (!parent || typeof parent.namespace !== 'string') {
      throw new Error(
        'PostgresHandoffRepository.create: cannot resolve workspace — ' +
          `parent ProcessInstance ${parsed.processInstanceId} missing or has no namespace.`,
      );
    }
    const [row] = await this.db
      .insert(handoffEntities)
      .values({
        id: parsed.id,
        workspace: parent.namespace,
        type: parsed.type,
        processInstanceId: parsed.processInstanceId,
        stepId: parsed.stepId,
        agentRunId: parsed.agentRunId,
        assignedRole: parsed.assignedRole,
        assignedUserId: parsed.assignedUserId,
        status: parsed.status,
        agentWork: parsed.agentWork,
        agentReasoning: parsed.agentReasoning,
        agentQuestion: parsed.agentQuestion,
        payload: parsed.payload,
        resolution: parsed.resolution,
        resolvedAt: parsed.resolvedAt ? new Date(parsed.resolvedAt) : null,
        createdAt: new Date(parsed.createdAt),
        updatedAt: new Date(parsed.updatedAt),
      })
      .returning();
    return HandoffEntitySchema.parse(toHandoffEntity(row));
  }

  async getById(entityId: string): Promise<HandoffEntity | null> {
    const rows = await this.db.select().from(handoffEntities).where(eq(handoffEntities.id, entityId)).limit(1);
    const row = rows[0];
    return row ? HandoffEntitySchema.parse(toHandoffEntity(row)) : null;
  }

  async getByIdInNamespaces(entityId: string, allowed: readonly string[]): Promise<HandoffEntity | null> {
    if (allowed.length === 0) return null;
    const rows = await this.db
      .select()
      .from(handoffEntities)
      .where(and(eq(handoffEntities.id, entityId), inArray(handoffEntities.workspace, [...allowed])))
      .limit(1);
    const row = rows[0];
    return row ? HandoffEntitySchema.parse(toHandoffEntity(row)) : null;
  }

  async getByRoleAll(role: string): Promise<HandoffEntity[]> {
    // Matches Firestore: created + acknowledged statuses only (resolved
    // handoffs drop out of role queues).
    const rows = await this.db
      .select()
      .from(handoffEntities)
      .where(and(eq(handoffEntities.assignedRole, role), inArray(handoffEntities.status, ['created', 'acknowledged'])))
      .orderBy(asc(handoffEntities.createdAt));
    return rows.map((r) => HandoffEntitySchema.parse(toHandoffEntity(r)));
  }

  async getByRoleInNamespaces(role: string, allowed: readonly string[]): Promise<HandoffEntity[]> {
    if (allowed.length === 0) return [];
    const rows = await this.db
      .select()
      .from(handoffEntities)
      .where(
        and(
          eq(handoffEntities.assignedRole, role),
          inArray(handoffEntities.status, ['created', 'acknowledged']),
          inArray(handoffEntities.workspace, [...allowed]),
        ),
      )
      .orderBy(asc(handoffEntities.createdAt));
    return rows.map((r) => HandoffEntitySchema.parse(toHandoffEntity(r)));
  }

  async getByInstanceId(instanceId: string): Promise<HandoffEntity[]> {
    const rows = await this.db.select().from(handoffEntities).where(eq(handoffEntities.processInstanceId, instanceId));
    return rows.map((r) => HandoffEntitySchema.parse(toHandoffEntity(r)));
  }

  async getByInstanceIdInNamespaces(instanceId: string, allowed: readonly string[]): Promise<HandoffEntity[]> {
    if (allowed.length === 0) return [];
    const rows = await this.db
      .select()
      .from(handoffEntities)
      .where(and(eq(handoffEntities.processInstanceId, instanceId), inArray(handoffEntities.workspace, [...allowed])));
    return rows.map((r) => HandoffEntitySchema.parse(toHandoffEntity(r)));
  }

  async claim(entityId: string, userId: string): Promise<HandoffEntity> {
    // `updated_at` is maintained by the `set_updated_at` trigger.
    const [row] = await this.db
      .update(handoffEntities)
      .set({ assignedUserId: userId, status: 'acknowledged' })
      .where(eq(handoffEntities.id, entityId))
      .returning();
    if (!row) throw new Error(`HandoffEntity not found: ${entityId}`);
    return HandoffEntitySchema.parse(toHandoffEntity(row));
  }

  async acknowledge(entityId: string, userId: string): Promise<HandoffEntity> {
    const existing = await this.getById(entityId);
    if (!existing) throw new Error(`HandoffEntity '${entityId}' not found`);
    if (existing.assignedUserId !== userId) {
      throw new Error(
        `User '${userId}' cannot acknowledge handoff '${entityId}': assigned to '${existing.assignedUserId}'`,
      );
    }
    const [row] = await this.db
      .update(handoffEntities)
      .set({ status: 'acknowledged' })
      .where(eq(handoffEntities.id, entityId))
      .returning();
    if (!row) throw new Error(`HandoffEntity not found: ${entityId}`);
    return HandoffEntitySchema.parse(toHandoffEntity(row));
  }

  async resolve(entityId: string, userId: string, resolution: Record<string, unknown>): Promise<HandoffEntity> {
    const existing = await this.getById(entityId);
    if (!existing) throw new Error(`HandoffEntity '${entityId}' not found`);
    if (existing.assignedUserId !== userId) {
      throw new Error(
        `User '${userId}' cannot resolve handoff '${entityId}': assigned to '${existing.assignedUserId}'`,
      );
    }
    const resolutionSchema = handoffTypeRegistry.getResolutionSchema(existing.type);
    resolutionSchema.parse(resolution);

    const [row] = await this.db
      .update(handoffEntities)
      .set({
        status: 'resolved',
        resolution,
        resolvedAt: new Date(),
      })
      .where(eq(handoffEntities.id, entityId))
      .returning();
    if (!row) throw new Error(`HandoffEntity not found: ${entityId}`);
    return HandoffEntitySchema.parse(toHandoffEntity(row));
  }
}

function toHandoffEntity(row: typeof handoffEntities.$inferSelect): HandoffEntity {
  return {
    id: row.id,
    type: row.type,
    processInstanceId: row.processInstanceId,
    stepId: row.stepId,
    agentRunId: row.agentRunId,
    assignedRole: row.assignedRole,
    assignedUserId: row.assignedUserId,
    status: row.status as HandoffEntity['status'],
    agentWork: (row.agentWork ?? {}) as Record<string, unknown>,
    agentReasoning: row.agentReasoning ?? '',
    agentQuestion: row.agentQuestion ?? '',
    payload: (row.payload ?? {}) as Record<string, unknown>,
    resolution: row.resolution as Record<string, unknown> | null,
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
