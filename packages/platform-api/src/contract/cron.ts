import { z } from 'zod';

/**
 * Contracts for the `cron` domain — currently a single heartbeat endpoint
 * fired by an external cron runner. The handler scans workflow definitions
 * for due cron triggers and fires each one.
 */

export const HeartbeatInputSchema = z.object({}).strict();

const TriggeredEntrySchema = z.object({
  definitionName: z.string(),
  definitionVersion: z.number(),
  triggerName: z.string(),
  instanceId: z.string(),
});

const SkippedEntrySchema = z.object({
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
