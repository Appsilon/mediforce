import type { AgentDefinitionRepository } from '@mediforce/platform-core';

export interface ResolveResult {
  prompt: string | undefined;
}

/**
 * Resolve the agent identity prompt from an AgentDefinition:
 * returns the `systemPrompt` wrapped in an `## Agent Identity` block to be
 * injected after the workflow preamble. Returns undefined when the agent has
 * no systemPrompt. Skill bindings are no longer pasted into the prompt — the
 * runtime resolves `agent.skills` into a plugin tree (see Phase 2).
 */
export async function resolveAgentIdentityPrompt(
  agentId: string,
  agentDefinitionRepo: AgentDefinitionRepository,
): Promise<string | undefined> {
  const { prompt } = await resolveAgentIdentity(agentId, agentDefinitionRepo);
  return prompt;
}

export async function resolveAgentIdentity(
  agentId: string,
  agentDefinitionRepo: AgentDefinitionRepository,
): Promise<ResolveResult> {
  const agent = await agentDefinitionRepo.getById(agentId);
  if (!agent) return { prompt: undefined };

  if (agent.systemPrompt) {
    return { prompt: `## Agent Identity\n\n${agent.systemPrompt}` };
  }
  return { prompt: undefined };
}
