import { z } from 'zod';

export const CronTriggerStateSchema = z.object({
  definitionName: z.string().min(1),
  triggerName: z.string().min(1),
  lastTriggeredAt: z.string().datetime(),
});

export type CronTriggerState = z.infer<typeof CronTriggerStateSchema>;
