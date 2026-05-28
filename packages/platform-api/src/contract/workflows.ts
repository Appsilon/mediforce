import { z } from 'zod';
import {
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

export const WorkflowDefinitionGroupSchema = z.object({
  namespace: z.string().min(1),
  name: z.string().min(1),
  latestVersion: z.number().int().positive(),
  defaultVersion: z.number().int().positive().nullable(),
  definition: WorkflowDefinitionSchema.nullable(),
});

export const ListWorkflowsInputSchema = z.object({
  /** Optional namespace filter (caller must still be a member). */
  namespace: z.string().min(1).optional(),
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

export type RegisterWorkflowInput = z.infer<typeof RegisterWorkflowInputSchema>;
/**
 * Pre-parse shape accepted by `mediforce.workflows.register()`. Differs from
 * `RegisterWorkflowInput` in that schema-level defaults (e.g. `visibility`)
 * are optional — the client runs `.parse()` and fills them in.
 */
export type RegisterWorkflowBody = z.input<typeof RegisterWorkflowInputSchema>;
export type RegisterWorkflowOutput = z.infer<typeof RegisterWorkflowOutputSchema>;
export type WorkflowDefinitionGroupSummary = z.infer<typeof WorkflowDefinitionGroupSchema>;
export type ListWorkflowsInput = z.infer<typeof ListWorkflowsInputSchema>;
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

export const ImportWorkflowInputSchema = z.object({
  repo: z.string().min(1),
  path: z.string().min(1),
  ref: z.string().min(1).default('main'),
});

export const ImportWorkflowOutputSchema = z.object({
  success: z.literal(true),
  name: z.string(),
  version: z.number().int().positive(),
  source: z.object({ repo: z.string(), path: z.string() }),
});

export type ImportWorkflowInput = z.infer<typeof ImportWorkflowInputSchema>;
export type ImportWorkflowOutput = z.infer<typeof ImportWorkflowOutputSchema>;
