import { z } from 'zod';
import { CronTriggerStateSchema } from '@mediforce/platform-core';

/**
 * Contract for Cron Trigger management (ADR-0010). Schedule syntax is validated
 * in the handlers via `validateCronSchedule` (UTC, 15-minute alignment) so CLI
 * and UI reject identically at the same boundary.
 */

const key = {
  namespace: z.string().min(1),
  definitionName: z.string().min(1),
  triggerName: z.string().min(1),
};

export const ListCronTriggersInputSchema = z.object({
  namespace: z.string().min(1),
  definitionName: z.string().min(1),
});
export const ListCronTriggersOutputSchema = z.object({
  triggers: z.array(CronTriggerStateSchema),
});

export const CreateCronTriggerInputSchema = z.object({
  ...key,
  schedule: z.string().min(1),
  enabled: z.boolean().default(true),
});
export const CreateCronTriggerOutputSchema = z.object({
  trigger: CronTriggerStateSchema,
});

export const UpdateCronTriggerInputSchema = z.object({
  ...key,
  schedule: z.string().min(1),
});
export const UpdateCronTriggerOutputSchema = z.object({
  trigger: CronTriggerStateSchema,
});

export const SetCronTriggerEnabledInputSchema = z.object({
  ...key,
  enabled: z.boolean(),
});
export const SetCronTriggerEnabledOutputSchema = z.object({
  trigger: CronTriggerStateSchema,
});

export const DeleteCronTriggerInputSchema = z.object({ ...key });
export const DeleteCronTriggerOutputSchema = z.object({
  success: z.literal(true),
});

export type ListCronTriggersInput = z.infer<typeof ListCronTriggersInputSchema>;
export type ListCronTriggersOutput = z.infer<typeof ListCronTriggersOutputSchema>;
export type CreateCronTriggerInput = z.infer<typeof CreateCronTriggerInputSchema>;
export type CreateCronTriggerOutput = z.infer<typeof CreateCronTriggerOutputSchema>;
export type UpdateCronTriggerInput = z.infer<typeof UpdateCronTriggerInputSchema>;
export type UpdateCronTriggerOutput = z.infer<typeof UpdateCronTriggerOutputSchema>;
export type SetCronTriggerEnabledInput = z.infer<typeof SetCronTriggerEnabledInputSchema>;
export type SetCronTriggerEnabledOutput = z.infer<typeof SetCronTriggerEnabledOutputSchema>;
export type DeleteCronTriggerInput = z.infer<typeof DeleteCronTriggerInputSchema>;
export type DeleteCronTriggerOutput = z.infer<typeof DeleteCronTriggerOutputSchema>;
