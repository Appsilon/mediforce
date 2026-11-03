import { describe, it, expect } from 'vitest';
import { buildWorkflowDefinition } from '../../testing/index';
import { AgentDefinitionSchema } from '../../schemas/agent-definition';
import { applyAgentVariant, applyRunVariant, applyStepVariant, isEmptyVariant, withAgentVariant } from '../variant';

const definition = buildWorkflowDefinition({
  name: 'ae-grading',
  namespace: 'pharma-a',
  steps: [
    {
      id: 'grade-aes', name: 'Grade AEs', type: 'creation', executor: 'agent', agentId: 'ae-grader',
      agent: { model: 'anthropic/claude-sonnet-4', prompt: 'Grade each AE.', timeoutMinutes: 10 },
    },
    { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
  ],
  transitions: [{ from: 'grade-aes', to: 'done' }],
});
const step = definition.steps[0]!;
const agent = AgentDefinitionSchema.parse({
  id: 'ae-grader', name: 'AE grader', iconName: 'bot', description: '', inputDescription: '', outputDescription: '',
  foundationModel: 'anthropic/claude-sonnet-4', systemPrompt: 'You grade AEs.',
  createdAt: '2026-11-03T00:00:00.000Z', updatedAt: '2026-11-03T00:00:00.000Z',
});

describe('isEmptyVariant', () => {
  it('is true for no patch and for a patch that sets nothing', () => {
    expect(isEmptyVariant(null)).toBe(true);
    expect(isEmptyVariant({})).toBe(true);
    expect(isEmptyVariant({ model: 'openai/gpt-5' })).toBe(false);
  });
});

describe('applyStepVariant', () => {
  it('returns the step untouched for an empty patch', () => {
    const applied = applyStepVariant(definition, step, {});
    expect(applied.step).toBe(step);
    expect(applied.definition).toBe(definition);
  });

  it('replaces model and prompt, keeps the rest of the agent config and the other steps', () => {
    const { step: patched, definition: patchedDefinition } = applyStepVariant(definition, step, {
      model: 'openai/gpt-5', prompt: 'Grade every AE by CTCAE v5.',
    });
    expect(patched.agent).toEqual({ model: 'openai/gpt-5', prompt: 'Grade every AE by CTCAE v5.', timeoutMinutes: 10 });
    expect(patchedDefinition.steps[0]).toBe(patched);
    expect(patchedDefinition.steps[1]).toBe(definition.steps[1]);
    expect(step.agent?.model).toBe('anthropic/claude-sonnet-4');
  });
});

describe('applyAgentVariant', () => {
  it('replaces the foundation model and the system prompt', () => {
    const patched = applyAgentVariant(agent, { model: 'openai/gpt-5', prompt: 'You grade AEs by CTCAE v5.' });
    expect(patched.foundationModel).toBe('openai/gpt-5');
    expect(patched.systemPrompt).toBe('You grade AEs by CTCAE v5.');
    expect(agent.systemPrompt).toBe('You grade AEs.');
  });
});

describe('withAgentVariant', () => {
  const repo = { getById: async (id: string) => (id === agent.id ? agent : null) };

  it('reads the evaluated Agent patched and leaves every other lookup alone', async () => {
    const patchedRepo = withAgentVariant(repo, agent.id, { prompt: 'You grade AEs by CTCAE v5.' });
    expect((await patchedRepo.getById(agent.id))?.systemPrompt).toBe('You grade AEs by CTCAE v5.');
    expect(await patchedRepo.getById('other')).toBeNull();
  });

  it('is the repository itself for an empty patch', () => {
    expect(withAgentVariant(repo, agent.id, null)).toBe(repo);
  });
});

describe('applyRunVariant', () => {
  const agents = { getById: async (id: string) => (id === agent.id ? agent : null) };
  const patch = { model: 'openai/gpt-5', prompt: 'Grade every AE by CTCAE v5.' };

  it('patches the step of a Step\'s run and reads its Agent as it is', async () => {
    const applied = applyRunVariant('step', { definition, step, agents }, patch);
    expect(applied.step.agent).toMatchObject(patch);
    expect(applied.definition.steps[0]).toBe(applied.step);
    expect(applied.agents).toBe(agents);
  });

  it('leaves an Agent\'s single step alone and patches the Agent it names', async () => {
    const applied = applyRunVariant('agent', { definition, step, agents }, patch);
    expect(applied.step).toBe(step);
    expect(applied.definition).toBe(definition);
    expect(await applied.agents.getById(agent.id)).toMatchObject({ foundationModel: 'openai/gpt-5', systemPrompt: 'Grade every AE by CTCAE v5.' });
  });

  it('is everything as it is without a Variant', () => {
    const base = { definition, step, agents };
    expect(applyRunVariant('agent', base, null)).toEqual(base);
    expect(applyRunVariant('step', base, null)).toEqual(base);
  });
});
