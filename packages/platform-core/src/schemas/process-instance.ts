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
  /**
   * Soft-delete marker. New runs are written with `false`; a tombstone-sweep
   * (see `ProcessInstanceRepository.setDeletedByDefinitionName`) flips it to
   * `true`. The `default(false)` means pre-migration docs with the field
   * missing parse as `deleted: false` on read, so downstream code reading
   * `instance.deleted` never sees `undefined` — and no one-time backfill of
   * Firestore is required for queries that filter on this field.
   */
  deleted: z.boolean().default(false),
  /**
   * User-initiated archive flag. Archived runs are hidden from the default
   * run list views but preserved in Firestore for audit trail purposes.
   * Toggle "Show archived" in the UI to include them. Only terminal/error
   * runs can be archived — active runs must be cancelled first.
   */
  archived: z.boolean().default(false),
  namespace: z.string().min(1).optional(),
  /**
   * Snapshot of outputs carried over from the last successfully completed
   * run of the same workflow name, per the WD's `inputForNextRun` declarations.
   * Empty object when the WD declares carry-over but no predecessor qualifies.
   * Undefined when the WD does not declare any.
   */
  previousRun: z.record(z.string(), z.unknown()).optional(),
  /** ID of the ProcessInstance whose outputs populated `previousRun`. */
  previousRunSourceId: z.string().optional(),
});

export type InstanceStatus = z.infer<typeof InstanceStatusSchema>;
export type ProcessInstance = z.infer<typeof ProcessInstanceSchema>;
