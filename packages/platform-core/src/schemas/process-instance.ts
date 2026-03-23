import { z } from 'zod';

export const InstanceStatusSchema = z.enum([
  'created',
  'running',
  'paused',
  'completed',
  'failed',
]);

export const ProcessInstanceSchema = z.object({
  id: z.string().min(1),
  definitionName: z.string().min(1),
  definitionVersion: z.string().min(1),
  // Legacy: kept for backward compat with pre-migration instances
  configName: z.string().min(1).optional(),
  configVersion: z.string().min(1).optional(),
  status: InstanceStatusSchema,
  currentStepId: z.string().nullable(),
  variables: z.record(z.string(), z.unknown()),
  triggerType: z.enum(['manual', 'webhook', 'cron']),
  triggerPayload: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  createdBy: z.string().min(1),
  pauseReason: z.string().nullable(),
  error: z.string().nullable(),
  assignedRoles: z.array(z.string()).default([]),
  deleted: z.boolean().optional(),
});

export type InstanceStatus = z.infer<typeof InstanceStatusSchema>;
export type ProcessInstance = z.infer<typeof ProcessInstanceSchema>;
