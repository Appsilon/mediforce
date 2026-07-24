import { z } from 'zod';
import { HttpMethodSchema, TriggerResourceSchema, TriggerTypeSchema } from '@mediforce/platform-core';

/**
 * Contract for Trigger management on the unified `triggers` table (ADR-0011).
 *
 * Supports `cron`, `manual`, and `webhook`: create carries a `type` that
 * defaults to `'cron'`. `schedule` is only meaningful for cron — it is optional
 * on the wire and the handler requires it for cron / forbids it elsewhere.
 * `method` + `path` are only meaningful for webhook — optional on the wire, the
 * handler requires them for webhook / forbids them elsewhere. Cron schedule
 * syntax is validated in the handlers via `validateCronSchedule` (UTC, 15-minute
 * alignment) and webhook path format via `WebhookTriggerConfigSchema`, so CLI
 * and UI reject identically at one boundary.
 */

const key = {
  namespace: z.string().min(1),
  definitionName: z.string().min(1),
  triggerName: z.string().min(1),
};

export const ListTriggersInputSchema = z.object({
  namespace: z.string().min(1),
  definitionName: z.string().min(1),
});
export const ListTriggersOutputSchema = z.object({
  triggers: z.array(TriggerResourceSchema),
});

export const CreateTriggerInputSchema = z.object({
  ...key,
  type: TriggerTypeSchema.default('cron'),
  // Cron-only: required for `cron`, forbidden otherwise. Enforced in the handler.
  schedule: z.string().min(1).optional(),
  // Webhook-only: required for `webhook`, forbidden otherwise. Path format is
  // validated in the handler via `WebhookTriggerConfigSchema`.
  method: HttpMethodSchema.optional(),
  path: z.string().min(1).optional(),
  enabled: z.boolean().default(true),
});
export const CreateTriggerOutputSchema = z.object({
  trigger: TriggerResourceSchema,
  // The relative endpoint a webhook trigger listens on
  // (`/api/triggers/webhook/<namespace>/<workflow><path>`); null for non-webhook
  // triggers so every client learns the URL at creation without re-deriving it.
  webhookUrl: z.string().nullable(),
});

export const UpdateTriggerInputSchema = z.object({
  ...key,
  schedule: z.string().min(1),
});
export const UpdateTriggerOutputSchema = z.object({
  trigger: TriggerResourceSchema,
});

export const SetTriggerEnabledInputSchema = z.object({
  ...key,
  enabled: z.boolean(),
});
export const SetTriggerEnabledOutputSchema = z.object({
  trigger: TriggerResourceSchema,
});

export const DeleteTriggerInputSchema = z.object({ ...key });
export const DeleteTriggerOutputSchema = z.object({
  success: z.literal(true),
});

export type ListTriggersInput = z.infer<typeof ListTriggersInputSchema>;
export type ListTriggersOutput = z.infer<typeof ListTriggersOutputSchema>;
export type CreateTriggerInput = z.infer<typeof CreateTriggerInputSchema>;
export type CreateTriggerOutput = z.infer<typeof CreateTriggerOutputSchema>;
export type UpdateTriggerInput = z.infer<typeof UpdateTriggerInputSchema>;
export type UpdateTriggerOutput = z.infer<typeof UpdateTriggerOutputSchema>;
export type SetTriggerEnabledInput = z.infer<typeof SetTriggerEnabledInputSchema>;
export type SetTriggerEnabledOutput = z.infer<typeof SetTriggerEnabledOutputSchema>;
export type DeleteTriggerInput = z.infer<typeof DeleteTriggerInputSchema>;
export type DeleteTriggerOutput = z.infer<typeof DeleteTriggerOutputSchema>;
