import { z } from 'zod';
import { WebhookTriggerConfigSchema } from './workflow-definition';

/**
 * The unified, detached Trigger resource (ADR-0011, triggers-detachment epic).
 *
 * A Trigger is a first-class **mutable** resource keyed by
 * `(namespace, workflowName, name)`, stored in one `triggers` table
 * discriminated by `type`, and attached to a Workflow independently of its
 * immutable versioned Definition. It generalises the cron-only overlay
 * (`cron_trigger_state`) to `manual`, `webhook`, and `cron`.
 *
 * Named `TriggerResource*` transitionally — see ADR-0011 / CONTEXT.md "Trigger".
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

/** cron config: the live cadence. (The fire cursor `lastTriggeredAt` is a
 *  top-level field on the cron variant, not part of this config.) */
export const CronTriggerConfigSchema = z.object({
  schedule: z.string().min(1),
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

export type CronTriggerResource = z.infer<typeof CronTriggerResourceSchema>;
export type WebhookTriggerResource = z.infer<typeof WebhookTriggerResourceSchema>;
export type ManualTriggerResource = z.infer<typeof ManualTriggerResourceSchema>;
export type TriggerResource = z.infer<typeof TriggerResourceSchema>;
export type TriggerConfig = TriggerResource['config'];
