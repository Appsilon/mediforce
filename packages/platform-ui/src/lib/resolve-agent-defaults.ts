import type {
  AgentDefinitionRepository,
  WorkflowDefinition,
  WorkflowStep,
} from '@mediforce/platform-core';

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

/**
 * Apply the agent's model to a step that names no model of its own.
 *
 * The single definition of the fallback: the step's own `agent.model` wins, a
 * blank one counts as unset, and only agent steps inherit — a script step may
 * name an `agentId` for its MCP bindings without ever running a model.
 */
export function applyAgentModel(step: WorkflowStep, agentModel: string | undefined): WorkflowStep {
  const inherits = step.executor === 'agent' && agentModel !== undefined && !step.agent?.model;
  return inherits ? { ...step, agent: { ...step.agent, model: agentModel } } : step;
}

/**
 * The definition as it will actually run: every agent step that inherits its
 * model from its AgentDefinition has that model filled in.
 *
 * Pre-flight model gates read `step.agent.model`, so without this an inherited
 * model reaches the provider without passing the checks a named one must pass.
 */
export async function resolveDefinitionModels(
  definition: WorkflowDefinition,
  agentDefinitionRepo: AgentDefinitionRepository,
): Promise<WorkflowDefinition> {
  const agentIds = [...new Set(
    definition.steps
      .filter((step) => step.executor === 'agent' && step.agentId !== undefined && !step.agent?.model)
      .map((step) => step.agentId as string),
  )];
  if (agentIds.length === 0) return definition;

  const models = new Map<string, string | undefined>(
    await Promise.all(agentIds.map(async (agentId): Promise<[string, string | undefined]> => {
      // A rotten agentId is resolveMcpForStep's error to raise, not ours.
      const agent = await agentDefinitionRepo.getById(agentId).catch(() => null);
      return [agentId, agent?.foundationModel || undefined];
    })),
  );

  return {
    ...definition,
    steps: definition.steps.map((step) =>
      step.agentId === undefined ? step : applyAgentModel(step, models.get(step.agentId)),
    ),
  };
}
