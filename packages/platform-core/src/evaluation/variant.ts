import type { AgentDefinitionRepository } from '../repositories/agent-definition-repository';
import type { AgentDefinition } from '../schemas/agent-definition';
import type { EvalVariantPatch } from '../schemas/eval-run';
import type { WorkflowDefinition, WorkflowStep } from '../schemas/workflow-definition';

type AgentLookup = Pick<AgentDefinitionRepository, 'getById'>;

/** Whether a Variant changes nothing, so its run is a run of the subject as it is. */
export function isEmptyVariant(patch: EvalVariantPatch | null): boolean {
  return patch === null || Object.values(patch).every((value) => value === undefined);
}

/**
 * A Step as one Variant of it runs (ADR-0024 D2): `model` and `prompt` replace
 * the step's own. The returned definition carries the patched step, so
 * everything that reads the step from it sees the Variant.
 */
export function applyStepVariant(
  definition: WorkflowDefinition,
  step: WorkflowStep,
  patch: EvalVariantPatch,
): { definition: WorkflowDefinition; step: WorkflowStep } {
  if (isEmptyVariant(patch)) return { definition, step };
  const patched: WorkflowStep = {
    ...step,
    agent: {
      ...step.agent,
      ...(patch.model === undefined ? {} : { model: patch.model }),
      ...(patch.prompt === undefined ? {} : { prompt: patch.prompt }),
    },
  };
  return {
    step: patched,
    definition: { ...definition, steps: definition.steps.map((candidate) => (candidate.id === step.id ? patched : candidate)) },
  };
}

/** An Agent as one Variant of it runs (ADR-0024 D2): `model` and `prompt` replace its foundation model and system prompt. */
export function applyAgentVariant(agent: AgentDefinition, patch: EvalVariantPatch): AgentDefinition {
  return {
    ...agent,
    ...(patch.model === undefined ? {} : { foundationModel: patch.model }),
    ...(patch.prompt === undefined ? {} : { systemPrompt: patch.prompt }),
  };
}

/**
 * What an Eval Run's trials run (ADR-0024 D2, D3): a Step's Variant patches the
 * step; an Agent's patches the Agent its single step names, read through the
 * returned lookup. Without a Variant, everything as it is.
 */
export function applyRunVariant(
  subjectKind: 'step' | 'agent',
  base: { definition: WorkflowDefinition; step: WorkflowStep; agents: AgentLookup },
  patch: EvalVariantPatch | null,
): { definition: WorkflowDefinition; step: WorkflowStep; agents: AgentLookup } {
  if (patch === null || isEmptyVariant(patch)) return base;
  if (subjectKind === 'step') return { ...applyStepVariant(base.definition, base.step, patch), agents: base.agents };
  if (base.step.agentId === undefined) return base;
  return { ...base, agents: withAgentVariant(base.agents, base.step.agentId, patch) };
}

/**
 * An Agent lookup that reads the evaluated Agent as its Variant has it, so the
 * Fingerprint, the estimate and the trial's run all see the same Agent. Only
 * an eval trial builds one; a saved Workflow cannot reach it.
 */
export function withAgentVariant(lookup: AgentLookup, agentId: string, patch: EvalVariantPatch | null): AgentLookup {
  if (patch === null || isEmptyVariant(patch)) return lookup;
  return {
    getById: async (id) => {
      const agent = await lookup.getById(id);
      return id === agentId && agent !== null ? applyAgentVariant(agent, patch) : agent;
    },
  };
}
