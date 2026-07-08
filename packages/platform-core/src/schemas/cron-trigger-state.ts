import { z } from 'zod';

/**
 * The persisted record for a **Cron Trigger** — the live, running schedule
 * attached to a Workflow (see CONTEXT.md). Keyed by
 * `(namespace, definitionName, triggerName)`. Owns the mutable operational
 * state that is deliberately decoupled from the immutable Workflow Definition
 * that declares it (ADR-0010):
 *
 *   - `enabled`        — start/stop toggle; the heartbeat only fires enabled rows.
 *   - `schedule`       — the live cadence (the Definition's declared schedule is
 *                        only a seed used to create this row; see ADR-0010).
 *   - `lastTriggeredAt`— fire cursor; `null` until the first fire.
 *
 * The symbol name keeps its historical `CronTriggerState` spelling: `CronTrigger`
 * is already taken by the workflow-engine class that instantiates a run.
 */
export const CronTriggerStateSchema = z.object({
  namespace: z.string().min(1),
  definitionName: z.string().min(1),
  triggerName: z.string().min(1),
  schedule: z.string().min(1),
  enabled: z.boolean(),
  lastTriggeredAt: z.string().datetime().nullable(),
});

export type CronTriggerState = z.infer<typeof CronTriggerStateSchema>;

/** Mutable fields a namespace member may change on an existing Cron Trigger. */
export const CronTriggerStatePatchSchema = z
  .object({
    schedule: z.string().min(1),
    enabled: z.boolean(),
  })
  .partial();

export type CronTriggerStatePatch = z.infer<typeof CronTriggerStatePatchSchema>;
