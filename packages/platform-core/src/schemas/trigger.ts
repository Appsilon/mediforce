import { z } from 'zod';
import { HttpMethodSchema } from './workflow-definition';

/**
 * The unified, detached Trigger resource (ADR-0011, triggers-detachment epic).
 *
 * A Trigger is a first-class **mutable** resource keyed by
 * `(namespace, workflowName, name)`, stored in one `triggers` table
 * discriminated by `type`, and attached to a Workflow independently of its
 * immutable versioned Definition. It generalises the cron-only overlay
 * (`cron_trigger_state`) to `manual`, `webhook`, and `cron`.
 *
 * Named `TriggerResource*` — the definition no longer declares triggers
 * (Issue #932), so this is the single, permanent Trigger schema (there is no
 * embedded `Trigger` declaration to rename back to). See ADR-0011 / CONTEXT.md.
 *
 * `event` is a reserved future type: no runtime, not part of the union yet.
 */
export const TriggerTypeSchema = z.enum(['manual', 'webhook', 'cron']);
export type TriggerType = z.infer<typeof TriggerTypeSchema>;

/** Fields every trigger carries regardless of type. */
const TriggerBaseSchema = z.object({
  namespace: z.string().min(1),
  workflowName: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

/** cron config: the live cadence plus the static input each tick hands the Run.
 *  (The fire cursor `lastTriggeredAt` is a top-level field on the cron variant,
 *  not part of this config.)
 *
 *  A cron tick has no caller to supply input, so the payload lives on the
 *  mutable Trigger row rather than the immutable Definition — which is what lets
 *  two schedules on one workflow fire different constants (`nightly-us` →
 *  `{region:"us"}`, `nightly-eu` → `{region:"eu"}`). It is validated against the
 *  workflow's `triggerInput` twice: at attach/update time (fail-fast, rejects
 *  the write) and again at fire time against the version actually resolved,
 *  where a drifted contract skips the tick with a reason instead of erroring
 *  (ADR-0012). */
export const CronTriggerConfigSchema = z.object({
  schedule: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).optional(),
});

/** webhook config: method + url path (relative to /api/triggers/webhook/<ns>/<wf>).
 *  The path discriminates when a workflow has multiple webhook triggers and is
 *  matched verbatim against the suffix segment(s) the caller used. */
export const WebhookTriggerConfigSchema = z.object({
  method: HttpMethodSchema,
  path: z
    .string()
    .min(1)
    .regex(/^\/[A-Za-z0-9_\-/]*$/, 'path must start with "/" and contain url-safe chars only'),
});

/** manual config: nothing — attaching a manual trigger is what makes a Workflow
 *  hand-startable. */
export const ManualTriggerConfigSchema = z.object({});

export const CronTriggerResourceSchema = TriggerBaseSchema.extend({
  type: z.literal('cron'),
  config: CronTriggerConfigSchema,
  lastTriggeredAt: z.string().datetime().nullable(),
});

export const WebhookTriggerResourceSchema = TriggerBaseSchema.extend({
  type: z.literal('webhook'),
  config: WebhookTriggerConfigSchema,
  lastTriggeredAt: z.null(),
});

export const ManualTriggerResourceSchema = TriggerBaseSchema.extend({
  type: z.literal('manual'),
  config: ManualTriggerConfigSchema,
  lastTriggeredAt: z.null(),
});

export const TriggerResourceSchema = z.discriminatedUnion('type', [
  CronTriggerResourceSchema,
  WebhookTriggerResourceSchema,
  ManualTriggerResourceSchema,
]);

export type WebhookTriggerConfig = z.infer<typeof WebhookTriggerConfigSchema>;
export type CronTriggerResource = z.infer<typeof CronTriggerResourceSchema>;
export type WebhookTriggerResource = z.infer<typeof WebhookTriggerResourceSchema>;
export type ManualTriggerResource = z.infer<typeof ManualTriggerResourceSchema>;
export type TriggerResource = z.infer<typeof TriggerResourceSchema>;
export type TriggerConfig = TriggerResource['config'];

/**
 * Portable, instance-free form of a Trigger (Issue #933): `name` + `type` +
 * `enabled` + the type's config fields, and nothing else. It excludes every
 * instance/runtime field (`namespace`, `workflowName`, the `lastTriggeredAt`
 * cursor, the derived URL) because those are re-anchored/re-derived on import,
 * so an exported file back-fires nothing on the destination. Config fields are
 * spread from the same `*TriggerConfigSchema` objects the resource uses, so a
 * portable file validates against the same rules at one boundary.
 *
 * Each variant is `.strict()`: a portable file that still carries an instance
 * field (`namespace`, `workflowName`, `lastTriggeredAt`, `createdAt`, …) is a
 * stale runtime dump, not a portable file, and is rejected rather than silently
 * stripped — so a mislabelled import fails loudly instead of half-applying.
 */
const PortableTriggerBaseSchema = z.object({
  name: z.string().min(1),
  enabled: z.boolean(),
});

const PortableCronTriggerSchema = PortableTriggerBaseSchema.extend({
  type: z.literal('cron'),
  ...CronTriggerConfigSchema.shape,
}).strict();

const PortableWebhookTriggerSchema = PortableTriggerBaseSchema.extend({
  type: z.literal('webhook'),
  ...WebhookTriggerConfigSchema.shape,
}).strict();

const PortableManualTriggerSchema = PortableTriggerBaseSchema.extend({
  type: z.literal('manual'),
}).strict();

export const PortableTriggerSchema = z.discriminatedUnion('type', [
  PortableCronTriggerSchema,
  PortableWebhookTriggerSchema,
  PortableManualTriggerSchema,
]);

/** The `triggers.json` file shape: an array of portable trigger entries. */
export const TriggerConfigFileSchema = z.array(PortableTriggerSchema);

export type PortableTrigger = z.infer<typeof PortableTriggerSchema>;
export type TriggerConfigFile = z.infer<typeof TriggerConfigFileSchema>;

/** Strip a stored Trigger down to its portable form — the export projection. */
export function toPortableTrigger(trigger: TriggerResource): PortableTrigger {
  if (trigger.type === 'cron') {
    return {
      name: trigger.name,
      type: 'cron',
      enabled: trigger.enabled,
      schedule: trigger.config.schedule,
      // Omitted rather than written as `undefined` so a payload-less cron
      // exports to the same file it did before ADR-0012.
      ...(trigger.config.payload === undefined ? {} : { payload: trigger.config.payload }),
    };
  }
  if (trigger.type === 'webhook') {
    return {
      name: trigger.name,
      type: 'webhook',
      enabled: trigger.enabled,
      method: trigger.config.method,
      path: trigger.config.path,
    };
  }
  return { name: trigger.name, type: 'manual', enabled: trigger.enabled };
}
