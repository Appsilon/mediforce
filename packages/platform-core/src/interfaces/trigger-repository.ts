import type { TriggerConfig, TriggerResource, TriggerType } from '../schemas/trigger';

/** Mutable fields on a Trigger. `type`, `namespace`, `workflowName`, `name`,
 *  and `createdAt` are identity/immutable and are never patched. */
export interface TriggerUpdate {
  enabled?: boolean;
  config?: TriggerConfig;
  updatedAt: string;
}

/**
 * Storage port for the unified `triggers` table (ADR-0011).
 *
 * Keyed by `(namespace, workflowName, name)`. `listEnabledByType` is the
 * cross-namespace read the cron heartbeat uses (`type='cron'`); it runs as a
 * system actor. Everything else is workspace-scoped and gated by the
 * authorized wrapper.
 */
export interface TriggerRepository {
  listByWorkflow(namespace: string, workflowName: string): Promise<TriggerResource[]>;
  listEnabledByType(type: TriggerType): Promise<TriggerResource[]>;
  create(trigger: TriggerResource): Promise<TriggerResource>;
  update(
    namespace: string,
    workflowName: string,
    name: string,
    patch: TriggerUpdate,
  ): Promise<TriggerResource>;
  /** Advance the cron fire cursor (`lastTriggeredAt`). No-op semantics for
   *  non-cron rows, but the heartbeat only ever calls it for cron. */
  recordTriggered(
    namespace: string,
    workflowName: string,
    name: string,
    triggeredAt: string,
  ): Promise<void>;
  delete(namespace: string, workflowName: string, name: string): Promise<void>;
  deleteByWorkflow(namespace: string, workflowName: string): Promise<void>;
}
