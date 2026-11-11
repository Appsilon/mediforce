import { z } from 'zod';
import { AgentAssistantProposalSchema } from '@mediforce/platform-core';
import { StepValidationSchema } from './evaluation';

/**
 * Contract for `POST /api/agent-assistant` — one turn with the namespace's
 * Agent Assistant: find, extend or design an Agent for the catalog.
 */
export const AskAgentAssistantInputSchema = z.object({
  namespace: z.string().min(1),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(20_000),
  })).min(1).max(100),
  model: z.string().min(1).optional(),
});

/** Real evidence behind a match or change proposal — never the model's own claim. */
export const AgentProposalEvidenceSchema = z.object({
  qualification: StepValidationSchema.shape.status.nullable(),
  /** `workflowName (step stepId)` for every live step that already calls this agent. */
  usedIn: z.array(z.string()),
});

export const AgentAssistantProposalViewSchema = AgentAssistantProposalSchema.and(z.object({
  evidence: AgentProposalEvidenceSchema.optional(),
}));

export const AskAgentAssistantOutputSchema = z.object({
  reply: z.string(),
  proposals: z.array(AgentAssistantProposalViewSchema),
});

/** One step of a turn in progress, streamed while the assistant works. */
export const AgentAssistantProgressSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('thinking'), round: z.number().int().positive() }),
  z.object({
    type: z.literal('tool'),
    round: z.number().int().positive(),
    callId: z.string(),
    tool: z.string(),
    status: z.enum(['running', 'done', 'failed']),
    error: z.string().optional(),
    /** The call's own arguments — lets the UI tell which agent a step is reading. */
    arguments: z.unknown().optional(),
  }),
]);

export type AskAgentAssistantInput = z.infer<typeof AskAgentAssistantInputSchema>;
export type AskAgentAssistantOutput = z.infer<typeof AskAgentAssistantOutputSchema>;
export type AgentAssistantProgress = z.infer<typeof AgentAssistantProgressSchema>;
export type AgentProposalEvidence = z.infer<typeof AgentProposalEvidenceSchema>;
