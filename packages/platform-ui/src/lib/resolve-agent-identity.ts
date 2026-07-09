import type { AgentDefinitionRepository } from '@mediforce/platform-core';

/**
 * Resolve the agent identity prompt from an AgentDefinition: the agent's
 * systemPrompt, injected into the agent's prompt after the workflow preamble.
 *
 * Returns undefined when the agent is missing or has no systemPrompt.
 */
export async function resolveAgentIdentity(
  agentId: string,
  agentDefinitionRepo: AgentDefinitionRepository,
): Promise<string | undefined> {
  const agent = await agentDefinitionRepo.getById(agentId);
  if (!agent?.systemPrompt) return undefined;
  return `## Agent Identity\n\n${agent.systemPrompt}`;
}
