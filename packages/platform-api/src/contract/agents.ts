import { z } from 'zod';
import {
  AgentDefinitionSchema,
  AgentMcpBindingMapSchema,
  AgentMcpBindingSchema,
  CreateAgentDefinitionInputSchema,
  PublicAgentOAuthTokenSchema,
  UpdateAgentDefinitionInputSchema,
} from '@mediforce/platform-core';

/** Reserved for future filters (e.g. visibility, namespace). */
export const ListAgentsInputSchema = z.object({});

export const ListAgentsOutputSchema = z.object({
  agents: z.array(AgentDefinitionSchema),
});

export const GetAgentInputSchema = z.object({
  id: z.string().min(1),
});

export const GetAgentOutputSchema = z.object({
  agent: AgentDefinitionSchema,
});

export const DeleteAgentInputSchema = z.object({
  id: z.string().min(1),
});

export const DeleteAgentOutputSchema = z.object({
  success: z.literal(true),
});

export const UpdateAgentInputSchema = z.object({
  id: z.string().min(1),
});

export const UpdateAgentBodySchema = UpdateAgentDefinitionInputSchema;

export const UpdateAgentOutputSchema = z.object({
  agent: AgentDefinitionSchema,
});

export type ListAgentsInput = z.infer<typeof ListAgentsInputSchema>;
export type ListAgentsOutput = z.infer<typeof ListAgentsOutputSchema>;
export type GetAgentInput = z.infer<typeof GetAgentInputSchema>;
export type GetAgentOutput = z.infer<typeof GetAgentOutputSchema>;
export type DeleteAgentInput = z.infer<typeof DeleteAgentInputSchema>;
export type DeleteAgentOutput = z.infer<typeof DeleteAgentOutputSchema>;
export type UpdateAgentInput = z.infer<typeof UpdateAgentInputSchema>;
export type UpdateAgentBody = z.infer<typeof UpdateAgentBodySchema>;
export type UpdateAgentOutput = z.infer<typeof UpdateAgentOutputSchema>;

// ---- POST /api/agents -------------------------------------------------------
export const CreateAgentInputSchema = CreateAgentDefinitionInputSchema;
export const CreateAgentOutputSchema = z.object({ agent: AgentDefinitionSchema });
export type CreateAgentInput = z.infer<typeof CreateAgentInputSchema>;
export type CreateAgentOutput = z.infer<typeof CreateAgentOutputSchema>;

// ---- PUT /api/agents/:id/mcp-servers/:name ----------------------------------
export const UpsertAgentMcpBindingInputSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  binding: AgentMcpBindingSchema,
});
export const UpsertAgentMcpBindingOutputSchema = z.object({
  mcpServers: AgentMcpBindingMapSchema,
});
export type UpsertAgentMcpBindingInput = z.infer<typeof UpsertAgentMcpBindingInputSchema>;
export type UpsertAgentMcpBindingOutput = z.infer<typeof UpsertAgentMcpBindingOutputSchema>;

// ---- DELETE /api/agents/:id/mcp-servers/:name -------------------------------
export const DeleteAgentMcpBindingInputSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});
export const DeleteAgentMcpBindingOutputSchema = z.object({
  mcpServers: AgentMcpBindingMapSchema,
});
export type DeleteAgentMcpBindingInput = z.infer<typeof DeleteAgentMcpBindingInputSchema>;
export type DeleteAgentMcpBindingOutput = z.infer<typeof DeleteAgentMcpBindingOutputSchema>;

// ---- GET /api/agents/:id/mcp-servers ----------------------------------------
export const ListAgentMcpBindingsInputSchema = z.object({ id: z.string().min(1) });
export const ListAgentMcpBindingsOutputSchema = z.object({
  mcpServers: AgentMcpBindingMapSchema,
});
export type ListAgentMcpBindingsInput = z.infer<typeof ListAgentMcpBindingsInputSchema>;
export type ListAgentMcpBindingsOutput = z.infer<typeof ListAgentMcpBindingsOutputSchema>;

// ---- GET /api/agents/:id/oauth?namespace=… ----------------------------------
// Returns sanitized tokens (no access/refresh tokens) for the agent UI.
export const ListAgentOAuthTokensInputSchema = z.object({
  id: z.string().min(1),
  namespace: z.string().min(1),
});
export const PublicAgentOAuthTokenWithServerSchema = PublicAgentOAuthTokenSchema.extend({
  serverName: z.string(),
});
export const ListAgentOAuthTokensOutputSchema = z.object({
  tokens: z.array(PublicAgentOAuthTokenWithServerSchema),
});
export type ListAgentOAuthTokensInput = z.infer<typeof ListAgentOAuthTokensInputSchema>;
export type ListAgentOAuthTokensOutput = z.infer<typeof ListAgentOAuthTokensOutputSchema>;

// ---- GET /api/agents/:id/oauth/:provider?namespace=…&serverName=… ----------
// Returns the public slice for a single binding. `provider` segment exists for
// URL parity; identification is by (namespace, agentId, serverName).
export const GetAgentOAuthTokenInputSchema = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  namespace: z.string().min(1),
  serverName: z.string().min(1),
});
export const GetAgentOAuthTokenOutputSchema = z.object({
  token: PublicAgentOAuthTokenWithServerSchema,
});
export type GetAgentOAuthTokenInput = z.infer<typeof GetAgentOAuthTokenInputSchema>;
export type GetAgentOAuthTokenOutput = z.infer<typeof GetAgentOAuthTokenOutputSchema>;

// ---- DELETE /api/agents/:id/oauth/:provider?namespace=…&serverName=… -------
// `revokeAtProvider=true` additionally POSTs to provider.revokeUrl; failure
// is non-blocking (local delete always proceeds).
export const DeleteAgentOAuthTokenInputSchema = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  namespace: z.string().min(1),
  serverName: z.string().min(1),
  revokeAtProvider: z.boolean().optional(),
});
export const DeleteAgentOAuthTokenOutputSchema = z.object({
  success: z.literal(true),
});
export type DeleteAgentOAuthTokenInput = z.infer<typeof DeleteAgentOAuthTokenInputSchema>;
export type DeleteAgentOAuthTokenOutput = z.infer<typeof DeleteAgentOAuthTokenOutputSchema>;
