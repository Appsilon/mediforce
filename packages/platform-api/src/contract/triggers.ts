import { z } from 'zod';
import {
  HttpMethodSchema,
  TriggerConfigFileSchema,
  TriggerResourceSchema,
  TriggerTypeSchema,
} from '@mediforce/platform-core';

/**
 * Contract for Trigger management on the unified `triggers` table (ADR-0011).
 *
 * Supports `cron`, `manual`, and `webhook`: create carries a `type` that
 * defaults to `'cron'`. `schedule` is only meaningful for cron — it is optional
 * on the wire and the handler requires it for cron / forbids it elsewhere.
 * `method` + `path` are only meaningful for webhook — optional on the wire, the
 * handler requires `path` for webhook / forbids both elsewhere. `method`
 * defaults to `POST` and only `POST` is accepted, because the catch-all webhook
 * endpoint dispatches POST only. Cron schedule
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
  // Cron-only: the static input every tick of this row hands the Run (ADR-0012).
  // Validated against the target workflow's `triggerInput` in the handler, so a
  // row whose payload violates the contract can't be saved at all.
  payload: z.record(z.string(), z.unknown()).optional(),
  // Webhook-only: `path` required for `webhook`, forbidden otherwise. `method`
  // defaults to POST in the handler and only POST is accepted (the endpoint is
  // POST-only). Path format is validated via `WebhookTriggerConfigSchema`.
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

/** Edit a cron row's config. Both fields are optional so a caller can retime a
 *  schedule without restating its payload, but omitting both is a no-op write
 *  that would still bump `updatedAt` and emit an audit event, so the handler
 *  rejects it. `payload: {}` *clears* the static input, distinct from omission. */
export const UpdateTriggerInputSchema = z.object({
  ...key,
  schedule: z.string().min(1).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
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

/**
 * Export/import of the portable trigger-config file (Issue #933). Export
 * projects a workflow's live triggers to their instance-free form; import
 * materializes them into the target namespace, re-anchoring cron cursors to
 * `now` and re-deriving webhook URLs for the destination host. `replace`
 * overwrites an existing trigger of the same name; default is seed-if-absent.
 */
export const ExportTriggersInputSchema = z.object({
  namespace: z.string().min(1),
  definitionName: z.string().min(1),
});
export const ExportTriggersOutputSchema = z.object({
  triggers: TriggerConfigFileSchema,
});

export const ImportTriggersInputSchema = z.object({
  namespace: z.string().min(1),
  definitionName: z.string().min(1),
  triggers: TriggerConfigFileSchema,
  replace: z.boolean().default(false),
});
export const ImportedTriggerResultSchema = z.object({
  name: z.string(),
  type: TriggerTypeSchema,
  // What the import did with this entry: created new, replaced an existing row,
  // or skipped it — either because a colliding row existed and `replace` was
  // not set, or because it would have had to remove the mandatory manual
  // trigger, which is never deletable.
  outcome: z.enum(['created', 'replaced', 'skipped']),
  // Re-derived relative webhook URL for the target host; null for non-webhook
  // and for skipped webhooks.
  webhookUrl: z.string().nullable(),
});
export const ImportTriggersOutputSchema = z.object({
  results: z.array(ImportedTriggerResultSchema),
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
export type ExportTriggersInput = z.infer<typeof ExportTriggersInputSchema>;
export type ExportTriggersOutput = z.infer<typeof ExportTriggersOutputSchema>;
export type ImportTriggersInput = z.infer<typeof ImportTriggersInputSchema>;
export type ImportTriggersOutput = z.infer<typeof ImportTriggersOutputSchema>;
export type ImportedTriggerResult = z.infer<typeof ImportedTriggerResultSchema>;
