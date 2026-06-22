import { z } from 'zod';
import { InstanceStatusSchema, ProcessInstanceSchema, RunNameEntrySchema } from '@mediforce/platform-core';

/**
 * Contract for `GET /api/runs/<runId>`.
 *
 * Source of truth for the wire shape this schema mirrors:
 *   `packages/platform-ui/src/app/api/runs/[runId]/route.ts`
 */

export const GetRunInputSchema = z.object({
  runId: z.string().min(1),
});

export const GetRunOutputSchema = z.object({
  runId: z.string().min(1),
  status: InstanceStatusSchema,
  currentStepId: z.string().nullable(),
  error: z.string().nullable(),
  finalOutput: z.unknown(),
  /** Workflow definition name the run was started from. Optional for
   *  backward compat with older servers — omit when absent. */
  definitionName: z.string().min(1).optional(),
  /** Namespace (= workspace handle) that owns the workflow definition.
   *  Lets clients build the human-facing URL without a second request.
   *  Nullable when the definition has been deleted; optional for older
   *  servers that don't include the field. */
  definitionNamespace: z.string().min(1).nullable().optional(),
  totalCostUsd: z.number().optional(),
  dryRun: z.boolean().optional(),
});

export type GetRunInput = z.infer<typeof GetRunInputSchema>;
export type GetRunOutput = z.infer<typeof GetRunOutputSchema>;

// Server picks latest version when definitionVersion omitted.
export const StartRunInputSchema = z.object({
  namespace: z.string().min(1).optional(),
  definitionName: z.string().min(1),
  definitionVersion: z.number().int().positive().optional(),
  triggerName: z.string().min(1).default('manual'),
  triggeredBy: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).optional(),
  dryRun: z.boolean().optional(),
});

export const StartRunOutputSchema = z.object({
  run: ProcessInstanceSchema,
});

export type StartRunInput = z.infer<typeof StartRunInputSchema>;
export type StartRunOutput = z.infer<typeof StartRunOutputSchema>;

/**
 * Contract for `GET /api/runs`.
 */
export const ListRunsInputSchema = z.object({
  workflow: z.string().min(1).optional(),
  status: z.enum(['created', 'running', 'paused', 'completed', 'failed']).optional(),
  /**
   * Workspace handle. Narrows the result to a single workspace; defense in
   * depth on top of the caller-namespace gate enforced by `scope.runs`.
   * Asking for a workspace the caller isn't in returns an empty list — list
   * reads are intersection semantics, not access checks.
   */
  namespace: z.string().min(1).optional(),
  // 10_000 is the parity workaround for the pre-paginated UI: Phase 4 PR3
  // moved `/handle/runs` off an unbounded Firestore read onto this contract;
  // a 100-row cap would have been a silent regression for workspaces with
  // more runs. Tracked in #588 alongside PR2's identical workaround — the
  // cap drops back to a sane page size once cursor pagination lands.
  limit: z.coerce.number().int().positive().max(10000).default(20),
  dryRun: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

/**
 * Read-path schema convergence per Phase 4 PRD §9: the list endpoint returns
 * the full `ProcessInstance` shape, the same one served by
 * `GET /api/processes/:instanceId`. This lets the UI hydrate detail/list cache
 * from a single wire shape — see [ADR-0006] §6 multi-cache-key template.
 *
 * Narrow projections (`{ runId, status, ... }`) belong to consumers
 * (CLI presenters, agent tooling), not the wire.
 */
export const ListRunsOutputSchema = z.object({
  runs: z.array(ProcessInstanceSchema),
});

export type ListRunsInput = z.infer<typeof ListRunsInputSchema>;
export type ListRunsOutput = z.infer<typeof ListRunsOutputSchema>;

/**
 * Contract for `GET /api/runs/names`.
 *
 * Projected `{ id, definitionName }` slice scoped to one workspace — backs the
 * UI label map (`useProcessNameMap`). Unlike `runs.list` (which is unscoped by
 * default), `namespace` is REQUIRED: the map is always per-workspace, and the
 * projection has no `limit`, so an unscoped call would be a whole-deployment
 * read. Asking for a workspace the caller isn't in returns an empty list
 * (intersection semantics, not an access check).
 */
export const ListRunNamesInputSchema = z.object({
  namespace: z.string().min(1),
});

export const ListRunNamesOutputSchema = z.object({
  runs: z.array(RunNameEntrySchema),
});

export type ListRunNamesInput = z.infer<typeof ListRunNamesInputSchema>;
export type ListRunNamesOutput = z.infer<typeof ListRunNamesOutputSchema>;

/**
 * Contract for `GET /api/runs/<runId>/files`.
 *
 * Output Files: artifacts the runtime committed under
 * `.mediforce/output/<stepId>/` on the run branch of the workflow's bare
 * repo. `path` is the repo-relative download key for
 * `GET /api/runs/<runId>/files/<path>` (binary route, not part of this
 * JSON contract).
 */
export const ListRunOutputFilesInputSchema = z.object({
  runId: z.string().min(1),
});

export const RunOutputFileEntrySchema = z.object({
  stepId: z.string().min(1),
  /** Path relative to `.mediforce/output/<stepId>/` (may contain slashes). */
  name: z.string().min(1),
  /** Repo-relative path `.mediforce/output/<stepId>/<name>` — the download key. */
  path: z.string().min(1),
  /** Blob size in bytes. */
  size: z.number().int().nonnegative(),
});

export const ListRunOutputFilesOutputSchema = z.object({
  files: z.array(RunOutputFileEntrySchema),
});

export type ListRunOutputFilesInput = z.infer<typeof ListRunOutputFilesInputSchema>;
export type RunOutputFileEntry = z.infer<typeof RunOutputFileEntrySchema>;
export type ListRunOutputFilesOutput = z.infer<typeof ListRunOutputFilesOutputSchema>;

/**
 * Client-side input for `GET /api/runs/<runId>/files/<path>` (binary
 * download). The response is raw bytes, so there is no output schema —
 * `mediforce.runs.downloadOutputFile` returns `{ fileName, contentType,
 * bytes }` assembled from headers + body.
 */
export const DownloadRunOutputFileInputSchema = z.object({
  runId: z.string().min(1),
  /** Repo-relative path from `RunOutputFileEntry.path` (incl. `.mediforce/output/` prefix). */
  path: z.string().min(1),
});

export type DownloadRunOutputFileInput = z.infer<typeof DownloadRunOutputFileInputSchema>;
