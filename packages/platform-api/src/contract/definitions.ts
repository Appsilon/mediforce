import { z } from 'zod';
import {
  AgentDefinitionSchema,
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
