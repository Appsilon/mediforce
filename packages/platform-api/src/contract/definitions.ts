import { z } from 'zod';
import {
  AgentDefinitionSchema,
  CreateAgentDefinitionInputSchema,
  WorkflowDefinitionSchema,
} from '@mediforce/platform-core';

/**
 * Contracts for the `definitions` domain — workflow definitions and agent
 * definitions. These endpoints drive the Workflow Designer / Agent Catalog
 * screens and are also the source of truth agents read when mapping a
 * `step.agentId` to an actual agent definition.
 */

// ---- GET /api/workflow-definitions ------------------------------------------
//
// Returns each workflow grouped by name with its list of versions plus the
// "latest" version denormalised for easy loading into the designer.
// The pre-migration route returned a projection (`{ name, latestVersion,
// defaultVersion, definition }`) rather than the raw groups — we keep that
// shape so the UI migration can be a drop-in.

export const WorkflowDefinitionSummarySchema = z.object({
  name: z.string(),
  latestVersion: z.number(),
  defaultVersion: z.number().nullable(),
  definition: WorkflowDefinitionSchema.nullable(),
});

export const ListWorkflowDefinitionsInputSchema = z.object({});

export const ListWorkflowDefinitionsOutputSchema = z.object({
  definitions: z.array(WorkflowDefinitionSummarySchema),
});

export type WorkflowDefinitionSummary = z.infer<typeof WorkflowDefinitionSummarySchema>;
export type ListWorkflowDefinitionsInput = z.infer<typeof ListWorkflowDefinitionsInputSchema>;
export type ListWorkflowDefinitionsOutput = z.infer<typeof ListWorkflowDefinitionsOutputSchema>;

// ---- GET /api/agent-definitions ---------------------------------------------

export const ListAgentDefinitionsInputSchema = z.object({});

export const ListAgentDefinitionsOutputSchema = z.object({
  agents: z.array(AgentDefinitionSchema),
});

export type ListAgentDefinitionsInput = z.infer<typeof ListAgentDefinitionsInputSchema>;
export type ListAgentDefinitionsOutput = z.infer<typeof ListAgentDefinitionsOutputSchema>;

// ---- GET /api/agent-definitions/:id -----------------------------------------

export const GetAgentDefinitionInputSchema = z.object({
  id: z.string().min(1),
});

export const GetAgentDefinitionOutputSchema = z.object({
  agent: AgentDefinitionSchema,
});

export type GetAgentDefinitionInput = z.infer<typeof GetAgentDefinitionInputSchema>;
export type GetAgentDefinitionOutput = z.infer<typeof GetAgentDefinitionOutputSchema>;

// ---- PUT /api/definitions (legacy YAML process definition) ------------------
//
// Receives a YAML body. Handler parses + validates via `parseProcessDefinition`
// before persistence. Non-parseable YAML becomes `ValidationError` (400);
// the version-already-exists case becomes `ConflictError` (409).
// Also auto-seeds an "all-human" config if one doesn't exist for this version.

export const UpsertLegacyDefinitionInputSchema = z.object({
  yaml: z.string().min(1, 'YAML body is required'),
});

export const UpsertLegacyDefinitionOutputSchema = z.object({
  success: z.literal(true),
  name: z.string(),
  version: z.string(),
});

export type UpsertLegacyDefinitionInput = z.infer<typeof UpsertLegacyDefinitionInputSchema>;
export type UpsertLegacyDefinitionOutput = z.infer<typeof UpsertLegacyDefinitionOutputSchema>;

// ---- POST /api/workflow-definitions ----------------------------------------
//
// Registers a new version of a WorkflowDefinition. `version` + `createdAt`
// are assigned server-side. `namespace` is required and comes from a query
// param on the route (the handler treats it as part of the input).

const WorkflowDefinitionDraftSchema = WorkflowDefinitionSchema.omit({
  version: true,
  createdAt: true,
});

export const CreateWorkflowDefinitionInputSchema = z.object({
  namespace: z.string().min(1),
  draft: WorkflowDefinitionDraftSchema,
});

export const CreateWorkflowDefinitionOutputSchema = z.object({
  success: z.literal(true),
  name: z.string(),
  version: z.number(),
});

export type CreateWorkflowDefinitionInput = z.infer<typeof CreateWorkflowDefinitionInputSchema>;
export type CreateWorkflowDefinitionOutput = z.infer<typeof CreateWorkflowDefinitionOutputSchema>;

// ---- POST /api/agent-definitions -------------------------------------------

export const CreateAgentDefinitionInputContractSchema = CreateAgentDefinitionInputSchema;

export const CreateAgentDefinitionOutputSchema = z.object({
  agent: AgentDefinitionSchema,
});

export type CreateAgentDefinitionOutput = z.infer<typeof CreateAgentDefinitionOutputSchema>;
