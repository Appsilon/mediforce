import { z } from 'zod';
import {
  AuditEventSchema,
  InstanceStatusSchema,
  ProcessInstanceSchema,
  StepExecutionSchema,
  StepTypeSchema,
} from '@mediforce/platform-core';

// Mirrors `stepConfigs.executorType` (`human | agent | script`) plus the
// `'unknown'` fallback the handler emits when no `stepConfig` matches.
// Kept local to the contract module — the contract layer is the boundary
// where shape evolution belongs.
export const StepExecutorTypeSchema = z.enum([
  'human',
  'agent',
  'script',
  'unknown',
]);
export type StepExecutorType = z.infer<typeof StepExecutorTypeSchema>;

/**
 * Contracts for the `processes` domain.
 *
 * These read endpoints feed the process detail page: the process instance
 * itself, the audit trail, and the per-step input/output/status derived
 * from the instance + its step-execution subcollection + its definition.
 *
 * 404 semantics: missing instances (or definitions, for the steps endpoint)
 * surface as `NotFoundError` from the handler and are mapped to HTTP 404 by
 * the route adapter.
 */

// ---- GET /api/processes/:instanceId -----------------------------------------

export const GetProcessInputSchema = z.object({
  instanceId: z.string().min(1),
});

export const GetProcessOutputSchema = ProcessInstanceSchema;

export type GetProcessInput = z.infer<typeof GetProcessInputSchema>;
export type GetProcessOutput = z.infer<typeof GetProcessOutputSchema>;

// ---- GET /api/processes/:instanceId/audit -----------------------------------
//
// Pagination is tracked in #231 (`HumanTaskRepository` + others need a
// cursor-capable list method). Until that lands this endpoint mirrors the
// current behaviour — return every event for the instance in one shot.
// The output wraps the array in `{ events }` so a later change to add a
// `nextCursor` field stays additive.

export const ListAuditEventsInputSchema = z.object({
  instanceId: z.string().min(1),
});

export const ListAuditEventsOutputSchema = z.object({
  events: z.array(AuditEventSchema),
});

export type ListAuditEventsInput = z.infer<typeof ListAuditEventsInputSchema>;
export type ListAuditEventsOutput = z.infer<typeof ListAuditEventsOutputSchema>;

// ---- GET /api/processes/:instanceId/steps -----------------------------------
//
// Derived view: walks the process/workflow definition in order and joins
// in each step's latest execution + the slice of `instance.variables`
// keyed by stepId. Human steps do not produce executions, so their
// input/output is reconstructed from the definition + variables.

export const StepEntryStatusSchema = z.enum(['completed', 'running', 'pending']);

export const StepEntrySchema = z.object({
  stepId: z.string(),
  name: z.string(),
  type: StepTypeSchema,
  executorType: StepExecutorTypeSchema,
  status: StepEntryStatusSchema,
  input: z.record(z.string(), z.unknown()).nullable(),
  output: z.record(z.string(), z.unknown()).nullable(),
  execution: StepExecutionSchema.nullable(),
});

export const GetProcessStepsInputSchema = z.object({
  instanceId: z.string().min(1),
});

export const GetProcessStepsOutputSchema = z.object({
  instanceId: z.string(),
  definitionName: z.string(),
  definitionVersion: z.string(),
  instanceStatus: InstanceStatusSchema,
  currentStepId: z.string().nullable(),
  steps: z.array(StepEntrySchema),
});

export type StepEntryStatus = z.infer<typeof StepEntryStatusSchema>;
export type StepEntry = z.infer<typeof StepEntrySchema>;
export type GetProcessStepsInput = z.infer<typeof GetProcessStepsInputSchema>;
export type GetProcessStepsOutput = z.infer<typeof GetProcessStepsOutputSchema>;
