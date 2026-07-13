import { and, eq } from 'drizzle-orm';
import {
  CronTriggerStateSchema,
  type CronTriggerState,
  type CronTriggerStateRepository,
} from '@mediforce/platform-core';
import type { Database } from '../client';
import { cronTriggerState } from '../schema/cron-trigger-state';

/**
 * Postgres-backed CronTriggerStateRepository (ADR-0001, PLAN §5.2 #4).
 * Global table (no workspace column) — the cron heartbeat reads across
 * every workspace's definitions in a single system-actor pass.
 *
 * Validation matches the Firestore + in-memory backends: parse on every
 * read AND every write.
 */
export class PostgresCronTriggerStateRepository implements CronTriggerStateRepository {
  constructor(private readonly db: Database) {}

  async get(definitionName: string, triggerName: string): Promise<CronTriggerState | null> {
    const rows = await this.db
      .select()
      .from(cronTriggerState)
      .where(
        and(
          eq(cronTriggerState.definitionName, definitionName),
          eq(cronTriggerState.triggerName, triggerName),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row ? CronTriggerStateSchema.parse(toState(row)) : null;
  }

  async set(state: CronTriggerState): Promise<void> {
    const parsed = CronTriggerStateSchema.parse(state);
    await this.db
      .insert(cronTriggerState)
      .values({
        definitionName: parsed.definitionName,
        triggerName: parsed.triggerName,
        lastTriggeredAt: new Date(parsed.lastTriggeredAt),
      })
      .onConflictDoUpdate({
        target: [cronTriggerState.definitionName, cronTriggerState.triggerName],
        set: {
          lastTriggeredAt: new Date(parsed.lastTriggeredAt),
        },
      });
  }
}

function toState(row: typeof cronTriggerState.$inferSelect): CronTriggerState {
  return {
    definitionName: row.definitionName,
    triggerName: row.triggerName,
    lastTriggeredAt: row.lastTriggeredAt.toISOString(),
  };
}
