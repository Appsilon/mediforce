import type { AgentDefinitionRepository } from '@mediforce/platform-core';

/** What a step inherits from the AgentDefinition its `agentId` points at. */
export interface AgentDefaults {
  /** The agent's systemPrompt, injected into the prompt after the workflow preamble. */
  identityPrompt?: string;
  /** The agent's foundationModel, used when the step sets no `agent.model`. */
  model?: string;
}

/**
 * Resolve the defaults a workflow step inherits from its AgentDefinition.
 *
 * Both fields are absent when the agent is missing, and each is absent when
 * the agent leaves it blank. The step always wins over what is returned here.
 */
export async function resolveAgentDefaults(
  agentId: string,
  agentDefinitionRepo: AgentDefinitionRepository,
): Promise<AgentDefaults> {
  const agent = await agentDefinitionRepo.getById(agentId);
  if (!agent) return {};
  return {
    ...(agent.systemPrompt ? { identityPrompt: `## Agent Identity\n\n${agent.systemPrompt}` } : {}),
    ...(agent.foundationModel ? { model: agent.foundationModel } : {}),
  };
}
