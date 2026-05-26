import { z } from 'zod';

// Audit: `cron.trigger.fired` emitted per fired trigger; skips not audited.
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
