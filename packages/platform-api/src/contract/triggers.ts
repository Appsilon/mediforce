import { z } from 'zod';
import { TriggerResourceSchema, TriggerTypeSchema } from '@mediforce/platform-core';

/**
 * Contract for Trigger management on the unified `triggers` table (ADR-0011).
 *
 * Supports `cron` and `manual` for now (Issue 4 wires `webhook`): create carries
 * a `type` that defaults to `'cron'` and the handler rejects the rest. `schedule`
 * is only meaningful for cron — it is optional on the wire and the handler
 * requires it for cron / forbids it for manual. Cron schedule syntax is
 * validated in the handlers via `validateCronSchedule` (UTC, 15-minute
 * alignment) so CLI and UI reject identically at one boundary.
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
  // Cron-only: required for `cron`, forbidden for `manual`. Enforced in the handler.
  schedule: z.string().min(1).optional(),
  enabled: z.boolean().default(true),
});
export const CreateTriggerOutputSchema = z.object({
  trigger: TriggerResourceSchema,
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
