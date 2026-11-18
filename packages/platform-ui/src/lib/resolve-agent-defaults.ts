import type { AgentDefinitionRepository, AgentOutputSchema } from '@mediforce/platform-core';

/** What a step inherits from the AgentDefinition its `agentId` points at. */
export interface AgentDefaults {
  /** The agent's systemPrompt, injected into the prompt after the workflow preamble. */
  identityPrompt?: string;
  /** The agent's foundationModel, used when the step sets no `agent.model`. */
  model?: string;
  /** The agent's outputSchema, used when the step sets no `agent.outputSchema`. */
  outputSchema?: AgentOutputSchema;
}

/**
 * Resolve the defaults a workflow step inherits from its AgentDefinition.
 *
 * `pinnedVersion` set (ADR-0029 epic #1673) reads that version's recorded
 * config snapshot instead of the Agent's live document, so a later edit to
 * the Agent never changes what an already-saved step runs — only picking the
 * Agent again, or a manual re-pin, moves it. Falls back to the live document
 * when the pin names a version with no snapshot (an Agent edited before
 * versioning existed) or when the step pins nothing (legacy step).
 *
 * Every field is absent when the agent is missing, and each is absent when
 * the agent leaves it blank. The step always wins over what is returned here.
 */
export async function resolveAgentDefaults(
  agentId: string,
  agentDefinitionRepo: Pick<AgentDefinitionRepository, 'getById'> & Partial<Pick<AgentDefinitionRepository, 'getVersion'>>,
  pinnedVersion?: number | null,
): Promise<AgentDefaults> {
  if (pinnedVersion != null && agentDefinitionRepo.getVersion !== undefined) {
    const version = await agentDefinitionRepo.getVersion(agentId, pinnedVersion);
    if (version !== null) {
      const { config } = version;
      return {
        ...(config.systemPrompt ? { identityPrompt: `## Agent Identity\n\n${config.systemPrompt}` } : {}),
        ...(config.foundationModel ? { model: config.foundationModel } : {}),
        ...(config.outputSchema === undefined ? {} : { outputSchema: config.outputSchema }),
      };
    }
  }
  const agent = await agentDefinitionRepo.getById(agentId);
  if (!agent) return {};
  return {
    ...(agent.systemPrompt ? { identityPrompt: `## Agent Identity\n\n${agent.systemPrompt}` } : {}),
    ...(agent.foundationModel ? { model: agent.foundationModel } : {}),
    ...(agent.outputSchema === undefined ? {} : { outputSchema: agent.outputSchema }),
  };
}
