import { z } from 'zod';

export const InstanceStatusSchema = z.enum([
  'created',
  'running',
  'paused',
  'completed',
  'failed',
]);

/**
 * UI-facing status bucket derived from `{status, pauseReason, error}` — see
 * `packages/platform-ui/src/lib/workflow-status.ts`'s `getWorkflowStatus`
 * for the JS derivation. Declared here (not in platform-ui) so the Postgres
 * repository's `displayStatus` filter/aggregation can share the same
 * literal set instead of hand-rolling a parallel string union — the SQL
 * `CASE` expression in `process-instance-repository.ts` must stay in sync
 * with `getWorkflowStatus`'s branching by hand; there is no way to share
 * the branching logic itself across JS and SQL, only the vocabulary.
 */
export const WorkflowDisplayStatusSchema = z.enum([
  'in_progress',
  'waiting_for_human',
  'error',
  'cancelled',
  'completed',
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
  /** The firing's **validated** input — conforms to the definition's
   *  `triggerInput` contract whichever trigger fired it (ADR-0012). */
  triggerPayload: z.record(z.string(), z.unknown()),
  /** Transport metadata of the firing (webhook `headers`/`query`/`method`/`path`,
   *  cron `firedAt`/`schedule`). Carries no declared input. Optional: manual
   *  starts have no transport, and runs created before ADR-0012 have no column
   *  value — both parse as `undefined` rather than needing a backfill. */
  triggerContext: z.record(z.string(), z.unknown()).optional(),
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
  totalCostUsd: z.number().optional(),
  parentInstanceId: z.string().min(1).optional(),
  parentDefinitionName: z.string().min(1).optional(),
  dryRun: z.boolean().default(false),
});

export type InstanceStatus = z.infer<typeof InstanceStatusSchema>;
export type WorkflowDisplayStatus = z.infer<typeof WorkflowDisplayStatusSchema>;
export type ProcessInstance = z.infer<typeof ProcessInstanceSchema>;

/**
 * Projected `{ id, definitionName }` view of a run. Backs the workspace
 * `id → definitionName` label map (`useProcessNameMap`), which only ever reads
 * those two fields — the full `ProcessInstance` wire shape was 24 s/request in
 * dev for a 10k-run workspace (issue #588).
 *
 * Both fields are REQUIRED: a row missing `definitionName` is corruption, not a
 * default. No `.catch()` — parsing fails loud rather than papering over a bad
 * row (repo "no silent fallbacks" rule).
 */
export const RunNameEntrySchema = ProcessInstanceSchema.pick({
  id: true,
  definitionName: true,
});

export type RunNameEntry = z.infer<typeof RunNameEntrySchema>;

/**
 * Projected view of the Workflow Definition version a run is pinned to, plus
 * the run's own `createdAt`. Everything the process-role gate needs to decide
 * who may act on a run's human tasks — and nothing else, so resolving the gate
 * for a whole inbox never pulls the `variables` / `triggerPayload` /
 * `previousRun` jsonb blobs the full run shape carries.
 *
 * `createdAt` is not decoration: a pinned version that resolves but postdates
 * the run is a replacement registered under the same name, which the gate
 * refuses (see `_role-gate.ts`).
 *
 * `namespace` stays optional exactly as it is on the run — pre-namespace rows
 * carry none, and the gate treats that as unreadable rather than defaulting.
 */
export const RunDefinitionPinSchema = ProcessInstanceSchema.pick({
  id: true,
  namespace: true,
  definitionName: true,
  definitionVersion: true,
  createdAt: true,
});

export type RunDefinitionPin = z.infer<typeof RunDefinitionPinSchema>;
