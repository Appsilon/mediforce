import { z } from 'zod';
import {
  WorkflowDefinitionBaseSchema,
  WorkflowDefinitionSchema,
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
  name: z.string().min(1),
  latestVersion: z.number().int().positive(),
  defaultVersion: z.number().int().positive().nullable(),
  definition: WorkflowDefinitionSchema.nullable(),
});

export const ListWorkflowsOutputSchema = z.object({
  definitions: z.array(WorkflowDefinitionGroupSchema),
});

export type RegisterWorkflowInput = z.infer<typeof RegisterWorkflowInputSchema>;
export type RegisterWorkflowOutput = z.infer<typeof RegisterWorkflowOutputSchema>;
export type WorkflowDefinitionGroupSummary = z.infer<typeof WorkflowDefinitionGroupSchema>;
export type ListWorkflowsOutput = z.infer<typeof ListWorkflowsOutputSchema>;

/**
 * Options for `mediforce.workflows.register()`. Namespace is a required
 * query parameter on the wire — modeled here as a separate options arg
 * (not part of the body input) to mirror the HTTP shape exactly.
 */
export interface RegisterWorkflowOptions {
  namespace: string;
}
