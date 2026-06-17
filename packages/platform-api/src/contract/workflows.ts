import { z } from 'zod';
import {
  ProcessInstanceSchema,
  WorkflowDefinitionBaseSchema,
  WorkflowDefinitionSchema,
  WorkflowVisibilitySchema,
} from '@mediforce/platform-core';

/**
 * Contract for `POST /api/workflow-definitions?namespace=<ns>` and
 * `GET /api/workflow-definitions`.
 *
 * Register flow: client sends a workflow definition body without `version`,
 * `createdAt`, or `namespace` (those are set server-side: `version` is
 * auto-incremented, `createdAt` is stamped, `namespace` is taken from the
 * required `namespace` query parameter and overrides any value in the body).
 *
 * The List output mirrors the shape returned by GET /api/workflow-definitions
 * in `packages/platform-ui/src/app/api/workflow-definitions/route.ts`: one
 * entry per workflow name, with `latestVersion`, `defaultVersion`, and the
 * latest version's full definition (or null if the latest version has been
 * pruned).
 */

export const RegisterWorkflowInputSchema = WorkflowDefinitionBaseSchema.omit({
  version: true,
  createdAt: true,
  namespace: true,
});

export const RegisterWorkflowOutputSchema = z.object({
  success: z.literal(true),
  name: z.string().min(1),
  version: z.number().int().positive(),
});

/**
 * Per-workflow run aggregate attached to each card on the workspace home page.
 * Computed server-side via count aggregations + a bounded `latest` query so the
 * page never ships the whole run collection to the client (the pre-cutover
 * `onSnapshot` loaded everything; the naive parity poll re-read up to 10k runs
 * every 5s). `active` = runs in {running, created, paused}; `total` and
 * `latest` honour `includeCompletedRuns` on the request. Archived runs are
 * always excluded — the home cards never show them.
 */
export const WorkflowRunSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
  /** Up to 3 newest-first runs for the card preview. */
  latest: z.array(ProcessInstanceSchema).max(3),
  /**
   * Non-terminal step IDs keyed by definition version (as string), covering
   * every version present in `latest`. Used by the card preview to render
   * progress dots against the run's actual definition, not the latest one.
   * Defaults to {} for backwards-compatibility with clients that pre-date this field.
   */
  stepsByVersion: z.record(z.string(), z.array(z.string())).default({}),
});

export const WorkflowDefinitionGroupSchema = z.object({
  namespace: z.string().min(1),
  name: z.string().min(1),
  latestVersion: z.number().int().positive(),
  defaultVersion: z.number().int().positive().nullable(),
  definition: WorkflowDefinitionSchema.nullable(),
  runSummary: WorkflowRunSummarySchema,
});

export const ListWorkflowsInputSchema = z.object({
  /** Optional namespace filter (caller must still be a member). */
  namespace: z.string().min(1).optional(),
  /**
   * When false, each `runSummary.total` and `runSummary.latest` exclude
   * terminal (completed / failed) runs — mirrors the home page's
   * "show completed" toggle (default on). `active` is unaffected.
   */
  includeCompletedRuns: z.boolean().default(true),
});

export const ListWorkflowsOutputSchema = z.object({
  definitions: z.array(WorkflowDefinitionGroupSchema),
});

export const GetWorkflowInputSchema = z.object({
  name: z.string().min(1),
  namespace: z.string().min(1).optional(),
  version: z.number().int().positive().optional(),
});

export const GetWorkflowOutputSchema = z.object({
  definition: WorkflowDefinitionSchema,
});

/**
 * Per-version metadata summary returned by `GET /api/workflow-definitions/:name/versions`.
 * Deliberately omits the full step / transition / trigger arrays — the version
 * picker only needs counts to render badges and labels. To fetch the full
 * definition for a specific version, call `mediforce.workflows.get({ name, namespace, version })`.
 *
 * `createdAt` is optional because legacy workflow documents may have been
 * persisted before the field was added; the schema mirrors the underlying
 * `WorkflowDefinitionBaseSchema.createdAt` shape.
 */
export const WorkflowVersionSummarySchema = z.object({
  version: z.number().int().positive(),
  archived: z.boolean(),
  title: z.string().optional(),
  description: z.string().optional(),
  stepCount: z.number().int().nonnegative(),
  triggerCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime().optional(),
});

export const ListWorkflowVersionsInputSchema = z.object({
  name: z.string().min(1),
  namespace: z.string().min(1),
});

/**
 * Output of `workflows.versions(name, namespace)`. Returns every version's
 * metadata (no upper bound — workflows accumulate versions over time but
 * never enough to need pagination here) plus the namespace's pinned default
 * version. If a future workspace hits a pathological version count, an
 * additive `limit` parameter can be introduced without breaking this contract.
 */
export const ListWorkflowVersionsOutputSchema = z.object({
  versions: z.array(WorkflowVersionSummarySchema),
  defaultVersion: z.number().int().positive().nullable(),
});

export type WorkflowVersionSummary = z.infer<typeof WorkflowVersionSummarySchema>;
export type ListWorkflowVersionsInput = z.infer<typeof ListWorkflowVersionsInputSchema>;
export type ListWorkflowVersionsOutput = z.infer<typeof ListWorkflowVersionsOutputSchema>;

export type RegisterWorkflowInput = z.infer<typeof RegisterWorkflowInputSchema>;
/**
 * Pre-parse shape accepted by `mediforce.workflows.register()`. Differs from
 * `RegisterWorkflowInput` in that schema-level defaults (e.g. `visibility`)
 * are optional — the client runs `.parse()` and fills them in.
 */
export type RegisterWorkflowBody = z.input<typeof RegisterWorkflowInputSchema>;
export type RegisterWorkflowOutput = z.infer<typeof RegisterWorkflowOutputSchema>;
export type WorkflowRunSummary = z.infer<typeof WorkflowRunSummarySchema>;
export type WorkflowDefinitionGroupSummary = z.infer<typeof WorkflowDefinitionGroupSchema>;
export type ListWorkflowsInput = z.infer<typeof ListWorkflowsInputSchema>;
/**
 * Pre-parse shape accepted by `mediforce.workflows.list()`. `includeCompletedRuns`
 * is optional here (the schema default fills it in on `.parse()`), so callers
 * that don't toggle "show completed" can omit it — mirrors `RegisterWorkflowBody`.
 */
export type ListWorkflowsRequest = z.input<typeof ListWorkflowsInputSchema>;
export type ListWorkflowsOutput = z.infer<typeof ListWorkflowsOutputSchema>;
export type GetWorkflowInput = z.infer<typeof GetWorkflowInputSchema>;
export type GetWorkflowOutput = z.infer<typeof GetWorkflowOutputSchema>;

export const ArchiveVersionInputSchema = z.object({
  name: z.string().min(1),
  version: z.number().int().positive(),
  archived: z.boolean(),
});

export const ArchiveVersionOutputSchema = z.object({
  success: z.literal(true),
  name: z.string(),
  version: z.number(),
  archived: z.boolean(),
});

export type ArchiveVersionInput = z.infer<typeof ArchiveVersionInputSchema>;
export type ArchiveVersionOutput = z.infer<typeof ArchiveVersionOutputSchema>;

export const ArchiveAllInputSchema = z.object({
  name: z.string().min(1),
  archived: z.boolean(),
});

export const ArchiveAllOutputSchema = z.object({
  success: z.literal(true),
  name: z.string(),
  archived: z.boolean(),
});

export type ArchiveAllInput = z.infer<typeof ArchiveAllInputSchema>;
export type ArchiveAllOutput = z.infer<typeof ArchiveAllOutputSchema>;

export const SetVisibilityInputSchema = z.object({
  name: z.string().min(1),
  visibility: WorkflowVisibilitySchema,
});

export const SetVisibilityOutputSchema = z.object({
  success: z.literal(true),
  name: z.string(),
  visibility: WorkflowVisibilitySchema,
});

export type SetVisibilityInput = z.infer<typeof SetVisibilityInputSchema>;
export type SetVisibilityOutput = z.infer<typeof SetVisibilityOutputSchema>;

export const CopyWorkflowInputSchema = z.object({
  name: z.string().min(1),
  version: z.number().int().positive().optional(),
  targetName: z.string().min(1).optional(),
});

export const CopyWorkflowOutputSchema = z.object({
  success: z.literal(true),
  name: z.string().min(1),
  version: z.number().int().positive(),
  copiedFrom: z.object({
    namespace: z.string().min(1),
    name: z.string().min(1),
    version: z.number().int().positive(),
  }),
});

export type CopyWorkflowInput = z.infer<typeof CopyWorkflowInputSchema>;
export type CopyWorkflowOutput = z.infer<typeof CopyWorkflowOutputSchema>;

export interface CopyWorkflowOptions {
  targetNamespace: string;
}

/**
 * Options for `mediforce.workflows.register()`. Namespace is a required
 * query parameter on the wire — modeled here as a separate options arg
 * (not part of the body input) to mirror the HTTP shape exactly.
 */
export interface RegisterWorkflowOptions {
  namespace: string;
}

export const SetDefaultVersionInputSchema = z.object({
  name: z.string().min(1),
  namespace: z.string().min(1),
  version: z.number().int().positive(),
});

export const SetDefaultVersionOutputSchema = z.object({
  success: z.literal(true),
  name: z.string(),
  namespace: z.string(),
  version: z.number().int().positive(),
});

export type SetDefaultVersionInput = z.infer<typeof SetDefaultVersionInputSchema>;
export type SetDefaultVersionOutput = z.infer<typeof SetDefaultVersionOutputSchema>;

// `expectedRunCount` is a stale-confirmation guard: the dialog displays a
// pre-fetched count; this re-checks server-side and rejects if it changed.
export const DeleteWorkflowInputSchema = z.object({
  name: z.string().min(1),
  namespace: z.string().min(1),
  expectedRunCount: z.number().int().nonnegative(),
});

export const DeleteWorkflowOutputSchema = z.object({
  success: z.literal(true),
  deletedRuns: z.number().int().nonnegative(),
});

export type DeleteWorkflowInput = z.infer<typeof DeleteWorkflowInputSchema>;
export type DeleteWorkflowOutput = z.infer<typeof DeleteWorkflowOutputSchema>;

export const GetWorkflowRunCountInputSchema = z.object({
  name: z.string().min(1),
  namespace: z.string().min(1),
});

export const GetWorkflowRunCountOutputSchema = z.object({
  count: z.number().int().nonnegative(),
});

export type GetWorkflowRunCountInput = z.infer<typeof GetWorkflowRunCountInputSchema>;
export type GetWorkflowRunCountOutput = z.infer<typeof GetWorkflowRunCountOutputSchema>;

// Move all versions of a workflow from one workspace to another. Transfer
// requires membership on BOTH source and target namespaces; the write goes
// through the repository (not raw Firestore) so namespace scoping and audit
// are enforced.
export const TransferWorkflowInputSchema = z.object({
  name: z.string().min(1),
  sourceNamespace: z.string().min(1),
  targetNamespace: z.string().min(1),
});

export const TransferWorkflowOutputSchema = z.object({
  success: z.literal(true),
  name: z.string(),
  sourceNamespace: z.string(),
  targetNamespace: z.string(),
});

export type TransferWorkflowInput = z.infer<typeof TransferWorkflowInputSchema>;
export type TransferWorkflowOutput = z.infer<typeof TransferWorkflowOutputSchema>;
