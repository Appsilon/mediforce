import { and, eq } from 'drizzle-orm';
import {
  TriggerResourceSchema,
  type TriggerRepository,
  type TriggerResource,
  type TriggerType,
  type TriggerUpdate,
} from '@mediforce/platform-core';
import type { Database } from '../client';
import { triggers } from '../schema/trigger';

/**
 * Postgres-backed {@link TriggerRepository} (ADR-0011).
 *
 * The row's flat `(type, config, last_triggered_at)` shape is reconstructed
 * into the discriminated `TriggerResource` union and validated on every read
 * and write — parity with the in-memory double. `recordTriggered` is scoped to
 * `type='cron'` in SQL so it is a genuine no-op for non-cron rows, keeping the
 * `last_triggered_at` column null (and thus schema-valid) for them.
 */
export class PostgresTriggerRepository implements TriggerRepository {
  constructor(private readonly db: Database) {}

  async listByWorkflow(namespace: string, workflowName: string): Promise<TriggerResource[]> {
    const rows = await this.db
      .select()
      .from(triggers)
      .where(and(eq(triggers.namespace, namespace), eq(triggers.workflowName, workflowName)));
    return rows.map(toResource);
  }

  async listEnabledByType(type: TriggerType): Promise<TriggerResource[]> {
    const rows = await this.db
      .select()
      .from(triggers)
      .where(and(eq(triggers.type, type), eq(triggers.enabled, true)));
    return rows.map(toResource);
  }

  async create(trigger: TriggerResource): Promise<TriggerResource> {
    const parsed = TriggerResourceSchema.parse(trigger);
    await this.db.insert(triggers).values(toRow(parsed));
    return parsed;
  }

  async update(
    namespace: string,
    workflowName: string,
    name: string,
    patch: TriggerUpdate,
  ): Promise<TriggerResource> {
    const rows = await this.db
      .select()
      .from(triggers)
      .where(pkWhere(namespace, workflowName, name))
      .limit(1);
    const current = rows[0];
    if (!current) {
      throw new Error(`trigger '${name}' not found for ${namespace}/${workflowName}`);
    }
    const next = TriggerResourceSchema.parse({
      ...toResource(current),
      ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
      ...(patch.config === undefined ? {} : { config: patch.config }),
      updatedAt: patch.updatedAt,
    });
    await this.db
      .update(triggers)
      .set({ enabled: next.enabled, config: next.config, updatedAt: new Date(next.updatedAt) })
      .where(pkWhere(namespace, workflowName, name));
    return next;
  }

  async recordTriggered(
    namespace: string,
    workflowName: string,
    name: string,
    triggeredAt: string,
  ): Promise<void> {
    await this.db
      .update(triggers)
      .set({ lastTriggeredAt: new Date(triggeredAt) })
      .where(and(pkWhere(namespace, workflowName, name), eq(triggers.type, 'cron')));
  }

  async delete(namespace: string, workflowName: string, name: string): Promise<void> {
    await this.db.delete(triggers).where(pkWhere(namespace, workflowName, name));
  }

  async deleteByWorkflow(namespace: string, workflowName: string): Promise<void> {
    await this.db
      .delete(triggers)
      .where(and(eq(triggers.namespace, namespace), eq(triggers.workflowName, workflowName)));
  }
}

function pkWhere(namespace: string, workflowName: string, name: string) {
  return and(
    eq(triggers.namespace, namespace),
    eq(triggers.workflowName, workflowName),
    eq(triggers.triggerName, name),
  );
}

function toRow(trigger: TriggerResource): typeof triggers.$inferInsert {
  return {
    namespace: trigger.namespace,
    workflowName: trigger.workflowName,
    triggerName: trigger.name,
    type: trigger.type,
    enabled: trigger.enabled,
    config: trigger.config,
    lastTriggeredAt:
      trigger.type === 'cron' && trigger.lastTriggeredAt !== null
        ? new Date(trigger.lastTriggeredAt)
        : null,
    createdAt: new Date(trigger.createdAt),
    updatedAt: new Date(trigger.updatedAt),
  };
}

function toResource(row: typeof triggers.$inferSelect): TriggerResource {
  return TriggerResourceSchema.parse({
    type: row.type,
    namespace: row.namespace,
    workflowName: row.workflowName,
    name: row.triggerName,
    enabled: row.enabled,
    config: row.config,
    lastTriggeredAt: row.type === 'cron' ? (row.lastTriggeredAt?.toISOString() ?? null) : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
