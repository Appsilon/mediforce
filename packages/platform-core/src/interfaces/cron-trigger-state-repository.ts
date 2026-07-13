import type { CronTriggerState, CronTriggerStatePatch } from '../schemas/cron-trigger-state';

/**
 * Persistence for Cron Triggers (ADR-0010). The record is the live trigger
 * config, not merely a last-fire cache — hence `create` / `update` / `delete`
 * alongside the heartbeat's read/record methods.
 *
 * `listAllEnabled` is the heartbeat's cross-namespace, system-actor read; every
 * other method is keyed by `(namespace, definitionName, triggerName)` so the
 * `AuthorizedCronTriggerStateRepository` wrapper can gate on namespace membership.
 */
export interface CronTriggerStateRepository {
  get(
    namespace: string,
    definitionName: string,
    triggerName: string,
  ): Promise<CronTriggerState | null>;

  /** Every Cron Trigger declared for one workflow, enabled or not. */
  listByDefinition(namespace: string, definitionName: string): Promise<CronTriggerState[]>;

  /** Enabled rows across every namespace — the heartbeat's fire candidates. */
  listAllEnabled(): Promise<CronTriggerState[]>;

  /** Insert a new row. Callers check `get` first and reject conflicts. */
  create(trigger: CronTriggerState): Promise<void>;

  /** Patch `schedule` and/or `enabled` on an existing row. */
  update(
    namespace: string,
    definitionName: string,
    triggerName: string,
    patch: CronTriggerStatePatch,
  ): Promise<void>;

  /** Advance the fire cursor after a successful fire. */
  recordTriggered(
    namespace: string,
    definitionName: string,
    triggerName: string,
    at: string,
  ): Promise<void>;

  delete(namespace: string, definitionName: string, triggerName: string): Promise<void>;

  /** Cascade: remove every Cron Trigger for a workflow (on workflow delete). */
  deleteByDefinition(namespace: string, definitionName: string): Promise<void>;
}
