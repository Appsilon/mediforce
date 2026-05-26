import { z } from 'zod';

/**
 * `POST /api/cron/heartbeat`.
 *
 * Operational endpoint invoked by the deployment's scheduler (cron, k8s
 * job, manual `mediforce cron heartbeat`) to fan out cron-triggered runs
 * for any workflow whose schedule is due. Caller must be apiKey
 * (system actor) — handler enforces.
 *
 * Audit emission per ADR-0005 §7:
 *   - `cron.heartbeat` itself stays `@no-audit` (operational call, no
 *     entity mutation).
 *   - `cron.trigger.fired` emitted ONCE PER FIRED TRIGGER inside the
 *     handler. Skipped triggers are not audited (they change no state);
 *     skip reasons surface in the response body + `console.log`.
 */
export const HeartbeatInputSchema = z.object({});

export const TriggeredEntrySchema = z.object({
  definitionName: z.string(),
  definitionVersion: z.number(),
  triggerName: z.string(),
  instanceId: z.string(),
});

export const SkippedEntrySchema = z.object({
  definitionName: z.string(),
  definitionVersion: z.number(),
  triggerName: z.string(),
  reason: z.string(),
});

export const HeartbeatOutputSchema = z.object({
  triggered: z.array(TriggeredEntrySchema),
  skipped: z.array(SkippedEntrySchema),
});

export type HeartbeatInput = z.infer<typeof HeartbeatInputSchema>;
export type HeartbeatOutput = z.infer<typeof HeartbeatOutputSchema>;
export type TriggeredEntry = z.infer<typeof TriggeredEntrySchema>;
export type SkippedEntry = z.infer<typeof SkippedEntrySchema>;
