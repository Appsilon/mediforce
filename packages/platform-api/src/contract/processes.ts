import { z } from 'zod';
import {
  AgentEventSchema,
  AuditEventSchema,
  InstanceStatusSchema,
  ProcessInstanceSchema,
  StepExecutionSchema,
} from '@mediforce/platform-core';

/**
 * Contracts for the `processes` domain — three read endpoints powering the
 * process detail page:
 *   - GET /api/processes/:instanceId           → the instance itself
 *   - GET /api/processes/:instanceId/audit     → the audit trail
 *   - GET /api/processes/:instanceId/steps     → per-step input/output/status
 *
 * 404 semantics: missing instances (or the workflow definition behind a steps
 * lookup) surface as `NotFoundError` from the handler and map to HTTP 404 in
 * the route adapter. Namespace gating is enforced inside each handler and
 * maps to 403 via `ForbiddenError` — 404 always beats 403 for missing ids.
 */

// Mirrors `WorkflowStep.type` (`creation | review | decision | terminal`).
// Defined locally because the underlying enum isn't exported from
// platform-core as a standalone schema; the contract layer is where shape
// pinning belongs.
const StepEntryTypeSchema = z.enum(['creation', 'review', 'decision', 'terminal']);

// Mirrors `WorkflowStep.executor` plus a `'unknown'` fallback the handler
// emits when an instance's definition step lacks an executor (shouldn't
// happen for new workflows, but legacy data may).
export const StepExecutorTypeSchema = z.enum([
  'human',
  'agent',
  'script',
  'cowork',
  'action',
  'unknown',
]);
export type StepExecutorType = z.infer<typeof StepExecutorTypeSchema>;

export const GetProcessInputSchema = z.object({
  instanceId: z.string().min(1),
});

export const GetProcessOutputSchema = ProcessInstanceSchema;

export type GetProcessInput = z.infer<typeof GetProcessInputSchema>;
export type GetProcessOutput = z.infer<typeof GetProcessOutputSchema>;

// Response shape: `{ events: [...] }`. This is a breaking change vs `main`,
// which returned the bare array — wrapping the array keeps a future
// `nextCursor` field additive once pagination lands (#231).

export const ListAuditEventsInputSchema = z.object({
  instanceId: z.string().min(1),
});

export const ListAuditEventsOutputSchema = z.object({
  events: z.array(AuditEventSchema),
});

export type ListAuditEventsInput = z.infer<typeof ListAuditEventsInputSchema>;
export type ListAuditEventsOutput = z.infer<typeof ListAuditEventsOutputSchema>;

// Per-instance agent-event feed. Mirrors the audit shape: `{ events }`,
// 404 on missing or out-of-workspace parent. Optional `stepId` narrows to a
// single step; absent returns the entire instance's event log. Ordering is
// `sequence ASC` (Firestore timestamps alone aren't reliable for ordering —
// see `AgentEventSchema` doc on the `sequence` field).
//
// `afterSequence` is the incremental-poll cursor: when set, only events with
// `sequence > afterSequence` are returned. Absent → full log. Lets the live
// poller fetch deltas instead of re-reading the whole subcollection each tick.
export const ListAgentEventsInputSchema = z.object({
  instanceId: z.string().min(1),
  stepId: z.string().min(1).optional(),
  afterSequence: z.number().int().optional(),
});

export const ListAgentEventsOutputSchema = z.object({
  events: z.array(AgentEventSchema),
});

export type ListAgentEventsInput = z.infer<typeof ListAgentEventsInputSchema>;
export type ListAgentEventsOutput = z.infer<typeof ListAgentEventsOutputSchema>;

// Derived view: walks the workflow definition in order and joins each step's
// latest execution + the slice of `instance.variables` keyed by stepId.
// Human steps don't produce executions, so their input/output is
// reconstructed from the definition + variables.

export const StepEntryStatusSchema = z.enum(['completed', 'running', 'pending']);

export const StepEntrySchema = z.object({
  stepId: z.string(),
  name: z.string(),
  type: StepEntryTypeSchema,
  executorType: StepExecutorTypeSchema,
  status: StepEntryStatusSchema,
  input: z.record(z.string(), z.unknown()).nullable(),
  output: z.record(z.string(), z.unknown()).nullable(),
  executions: z.array(StepExecutionSchema),
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

// State transition: running | paused → failed. Entity echo per ADR-0005 §5.
// `reason` defaults to "Cancelled by user" in the handler; that literal is
// load-bearing — workflow-status.ts:82 gates on it to distinguish operator
// cancellations from agent failures.
//
// Naming: contract symbols use `Run` per ADR-0001 vocabulary (canonical term
// for the entity is `WorkflowRun`, short form `Run` everywhere on the API
// surface — `GetRunInputSchema`, `StartRunInputSchema`, etc.). The URL path
// `/api/processes/:instanceId/cancel` keeps the legacy `processes` segment
// until a coordinated URL rename phase; the adapter maps `params.instanceId`
// to the input field `runId`.

export const CancelRunInputSchema = z.object({
  runId: z.string().min(1),
  reason: z.string().min(1).optional(),
});

export const CancelRunOutputSchema = z.object({
  run: ProcessInstanceSchema,
});

export type CancelRunInput = z.infer<typeof CancelRunInputSchema>;
export type CancelRunOutput = z.infer<typeof CancelRunOutputSchema>;

// `failed` source state covers agent-escalated / agent-paused recovery.
export const ResumeRunInputSchema = z.object({
  runId: z.string().min(1),
});

export const ResumeRunOutputSchema = z.object({
  run: ProcessInstanceSchema,
});

export type ResumeRunInput = z.infer<typeof ResumeRunInputSchema>;
export type ResumeRunOutput = z.infer<typeof ResumeRunOutputSchema>;

export const ResumeWaitInputSchema = z.object({
  runId: z.string().min(1),
});

export const ResumeWaitOutputSchema = z.object({
  resumed: z.boolean(),
  resumeReason: z.string().optional(),
  resumeAt: z.string().optional(),
});

export type ResumeWaitInput = z.infer<typeof ResumeWaitInputSchema>;
export type ResumeWaitOutput = z.infer<typeof ResumeWaitOutputSchema>;

export const RetryStepInputSchema = z.object({
  runId: z.string().min(1),
  stepId: z.string().min(1),
});

export const RetryStepOutputSchema = z.object({
  run: ProcessInstanceSchema,
});

export type RetryStepInput = z.infer<typeof RetryStepInputSchema>;
export type RetryStepOutput = z.infer<typeof RetryStepOutputSchema>;

// Soft-archive flag on the run (`archived` field). Blocked while the run is
// still active (running/created/waiting-on-human). Entity echo per ADR-0005 §5.

export const ArchiveRunInputSchema = z.object({
  runId: z.string().min(1),
  archived: z.boolean(),
});

export const ArchiveRunOutputSchema = z.object({
  run: ProcessInstanceSchema,
});

export type ArchiveRunInput = z.infer<typeof ArchiveRunInputSchema>;
export type ArchiveRunOutput = z.infer<typeof ArchiveRunOutputSchema>;

// Bulk response shape per ADR-0005 §5: `{ results: [{ id, status, error? }] }`.
// Per-item failures don't abort the batch; each id reports independently. Both
// endpoints share the same input/output shape; the only difference is whether
// the per-item operation is cancel or archive.

const BULK_LIMIT = 100;

export const BulkRunInputSchema = z.object({
  runIds: z.array(z.string().min(1)).min(1).max(BULK_LIMIT),
});

export const BulkRunResultItemSchema = z.object({
  id: z.string(),
  status: z.enum(['ok', 'error']),
  error: z.string().optional(),
});

export const BulkRunOutputSchema = z.object({
  results: z.array(BulkRunResultItemSchema),
});

export type BulkRunInput = z.infer<typeof BulkRunInputSchema>;
export type BulkRunResultItem = z.infer<typeof BulkRunResultItemSchema>;
export type BulkRunOutput = z.infer<typeof BulkRunOutputSchema>;
