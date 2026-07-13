import { and, eq } from 'drizzle-orm';
import {
  CronTriggerStateSchema,
  type CronTriggerState,
  type CronTriggerStatePatch,
  type CronTriggerStateRepository,
} from '@mediforce/platform-core';
import type { Database } from '../client';
import { cronTriggerState } from '../schema/cron-trigger-state';

/**
 * Postgres-backed CronTriggerStateRepository (ADR-0010). Stores live Cron
 * Trigger config keyed by `(namespace, definitionName, triggerName)`.
 * `listAllEnabled` is the heartbeat's cross-namespace read; every other method
 * is namespace-scoped. Validation parses on every read AND every write.
 */
export class PostgresCronTriggerStateRepository implements CronTriggerStateRepository {
  constructor(private readonly db: Database) {}

  async get(
    namespace: string,
    definitionName: string,
    triggerName: string,
  ): Promise<CronTriggerState | null> {
    const rows = await this.db
      .select()
      .from(cronTriggerState)
      .where(
        and(
          eq(cronTriggerState.namespace, namespace),
          eq(cronTriggerState.definitionName, definitionName),
          eq(cronTriggerState.triggerName, triggerName),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row ? CronTriggerStateSchema.parse(toState(row)) : null;
  }

  async listByDefinition(
    namespace: string,
    definitionName: string,
  ): Promise<CronTriggerState[]> {
    const rows = await this.db
      .select()
      .from(cronTriggerState)
      .where(
        and(
          eq(cronTriggerState.namespace, namespace),
          eq(cronTriggerState.definitionName, definitionName),
        ),
      );
    return rows.map((row) => CronTriggerStateSchema.parse(toState(row)));
  }

  async listAllEnabled(): Promise<CronTriggerState[]> {
    const rows = await this.db
      .select()
      .from(cronTriggerState)
      .where(eq(cronTriggerState.enabled, true));
    return rows.map((row) => CronTriggerStateSchema.parse(toState(row)));
  }

  async create(trigger: CronTriggerState): Promise<void> {
    const parsed = CronTriggerStateSchema.parse(trigger);
    await this.db.insert(cronTriggerState).values({
      namespace: parsed.namespace,
      definitionName: parsed.definitionName,
      triggerName: parsed.triggerName,
      schedule: parsed.schedule,
      enabled: parsed.enabled,
      lastTriggeredAt: parsed.lastTriggeredAt ? new Date(parsed.lastTriggeredAt) : null,
    });
  }

  async update(
    namespace: string,
    definitionName: string,
    triggerName: string,
    patch: CronTriggerStatePatch,
  ): Promise<void> {
    const set: Partial<typeof cronTriggerState.$inferInsert> = {};
    if (patch.schedule !== undefined) set.schedule = patch.schedule;
    if (patch.enabled !== undefined) set.enabled = patch.enabled;
    if (Object.keys(set).length === 0) return;
    await this.db
      .update(cronTriggerState)
      .set(set)
      .where(rowKey(namespace, definitionName, triggerName));
  }

  async recordTriggered(
    namespace: string,
    definitionName: string,
    triggerName: string,
    at: string,
  ): Promise<void> {
    await this.db
      .update(cronTriggerState)
      .set({ lastTriggeredAt: new Date(at) })
      .where(rowKey(namespace, definitionName, triggerName));
  }

  async delete(
    namespace: string,
    definitionName: string,
    triggerName: string,
  ): Promise<void> {
    await this.db
      .delete(cronTriggerState)
      .where(rowKey(namespace, definitionName, triggerName));
  }

  async deleteByDefinition(namespace: string, definitionName: string): Promise<void> {
    await this.db
      .delete(cronTriggerState)
      .where(
        and(
          eq(cronTriggerState.namespace, namespace),
          eq(cronTriggerState.definitionName, definitionName),
        ),
      );
  }
}

function rowKey(namespace: string, definitionName: string, triggerName: string) {
  return and(
    eq(cronTriggerState.namespace, namespace),
    eq(cronTriggerState.definitionName, definitionName),
    eq(cronTriggerState.triggerName, triggerName),
  );
}

function toState(row: typeof cronTriggerState.$inferSelect): CronTriggerState {
  return {
    namespace: row.namespace,
    definitionName: row.definitionName,
    triggerName: row.triggerName,
    schedule: row.schedule,
    enabled: row.enabled,
    lastTriggeredAt: row.lastTriggeredAt ? row.lastTriggeredAt.toISOString() : null,
  };
}
