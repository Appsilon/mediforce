import { describe, it, expect, vi } from 'vitest';
import type { AgentDefinition, AgentDefinitionRepository } from '@mediforce/platform-core';

import type { WorkflowDefinition, WorkflowStep } from '@mediforce/platform-core';

import { applyAgentModel, resolveAgentDefaults, resolveDefinitionModels } from '../resolve-agent-defaults';

function makeAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: 'agent-1',
    name: 'Test Agent',
    iconName: 'Bot',
    description: 'test',
    foundationModel: 'anthropic/claude-sonnet-4',
    systemPrompt: '',
    inputDescription: '',
    outputDescription: '',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeRepo(agent: AgentDefinition | null): AgentDefinitionRepository {
  return {
    getById: vi.fn().mockResolvedValue(agent),
    create: vi.fn(),
    upsert: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
}

describe('resolveAgentDefaults', () => {
  it('returns no identity prompt when agent not found', async () => {
    const repo = makeRepo(null);
    const result = await resolveAgentDefaults('missing', repo);
    expect(result.identityPrompt).toBeUndefined();
  });

  it('returns no identity prompt when agent has no systemPrompt', async () => {
    const repo = makeRepo(makeAgent({ systemPrompt: '' }));
    const result = await resolveAgentDefaults('agent-1', repo);
    expect(result.identityPrompt).toBeUndefined();
  });

  it('returns the systemPrompt under an Agent Identity heading', async () => {
    const repo = makeRepo(makeAgent({ systemPrompt: 'You are a CDISC expert.' }));
    const result = await resolveAgentDefaults('agent-1', repo);
    expect(result.identityPrompt).toContain('## Agent Identity');
    expect(result.identityPrompt).toContain('You are a CDISC expert.');
  });

  it('never emits a Skills heading', async () => {
    const repo = makeRepo(makeAgent({ systemPrompt: 'You author CDISC rules.' }));
    const result = await resolveAgentDefaults('agent-1', repo);
    expect(result.identityPrompt).not.toContain('## Skills');
  });

  it('returns the agent foundationModel as the model', async () => {
    const repo = makeRepo(makeAgent({ foundationModel: 'anthropic/claude-opus-4' }));
    const result = await resolveAgentDefaults('agent-1', repo);
    expect(result.model).toBe('anthropic/claude-opus-4');
  });

  it('returns the model even when the agent has no systemPrompt', async () => {
    const repo = makeRepo(makeAgent({ systemPrompt: '', foundationModel: 'openai/gpt-5' }));
    const result = await resolveAgentDefaults('agent-1', repo);
    expect(result.identityPrompt).toBeUndefined();
    expect(result.model).toBe('openai/gpt-5');
  });

  it('returns no model when the agent is not found', async () => {
    const repo = makeRepo(null);
    const result = await resolveAgentDefaults('missing', repo);
    expect(result.model).toBeUndefined();
  });

  it('returns no model when the agent foundationModel is blank', async () => {
    const repo = makeRepo(makeAgent({ foundationModel: '' }));
    const result = await resolveAgentDefaults('agent-1', repo);
    expect(result.model).toBeUndefined();
  });
});

describe('applyAgentModel', () => {
  const agentStep: WorkflowStep = { id: 's1', name: 'S1', type: 'creation', executor: 'agent', agentId: 'a1' };

  it('fills in the agent model when the step names none', () => {
    expect(applyAgentModel(agentStep, 'openai/gpt-5').agent?.model).toBe('openai/gpt-5');
  });

  it('leaves a step that names its own model alone', () => {
    const step = { ...agentStep, agent: { model: 'anthropic/claude-opus-4-5' } };
    expect(applyAgentModel(step, 'openai/gpt-5').agent?.model).toBe('anthropic/claude-opus-4-5');
  });

  it('treats a blank step model as unset', () => {
    expect(applyAgentModel({ ...agentStep, agent: { model: '' } }, 'openai/gpt-5').agent?.model).toBe('openai/gpt-5');
  });

  it('never gives a script step an agent config', () => {
    const scriptStep: WorkflowStep = { ...agentStep, executor: 'script' };
    expect(applyAgentModel(scriptStep, 'openai/gpt-5').agent).toBeUndefined();
  });

  it('returns the step untouched when there is no agent model', () => {
    expect(applyAgentModel(agentStep, undefined)).toBe(agentStep);
  });
});

describe('resolveDefinitionModels', () => {
  function makeDefinition(steps: WorkflowStep[]): WorkflowDefinition {
    return { name: 'wf', version: 1, namespace: 'ns', steps, transitions: [] } as unknown as WorkflowDefinition;
  }

  it('fills in the model a step will actually run on', async () => {
    const repo = makeRepo(makeAgent({ foundationModel: 'anthropic/claude-opus-4-5' }));
    const definition = makeDefinition([
      { id: 's1', name: 'S1', type: 'creation', executor: 'agent', agentId: 'agent-1' },
    ]);

    const resolved = await resolveDefinitionModels(definition, repo);

    expect(resolved.steps[0].agent?.model).toBe('anthropic/claude-opus-4-5');
  });

  it('leaves the definition untouched when no step inherits', async () => {
    const repo = makeRepo(makeAgent());
    const definition = makeDefinition([
      { id: 's1', name: 'S1', type: 'creation', executor: 'agent', agent: { model: 'openai/gpt-5' } },
    ]);

    const resolved = await resolveDefinitionModels(definition, repo);

    expect(resolved).toBe(definition);
    expect(repo.getById).not.toHaveBeenCalled();
  });

  it('fetches each agent once even when several steps share it', async () => {
    const repo = makeRepo(makeAgent({ foundationModel: 'openai/gpt-5' }));
    const definition = makeDefinition([
      { id: 's1', name: 'S1', type: 'creation', executor: 'agent', agentId: 'agent-1' },
      { id: 's2', name: 'S2', type: 'creation', executor: 'agent', agentId: 'agent-1' },
    ]);

    const resolved = await resolveDefinitionModels(definition, repo);

    expect(repo.getById).toHaveBeenCalledTimes(1);
    expect(resolved.steps.map((step) => step.agent?.model)).toEqual(['openai/gpt-5', 'openai/gpt-5']);
  });

  it('leaves the step alone when the agent reference is rotten', async () => {
    const repo = makeRepo(null);
    const definition = makeDefinition([
      { id: 's1', name: 'S1', type: 'creation', executor: 'agent', agentId: 'missing' },
    ]);

    const resolved = await resolveDefinitionModels(definition, repo);

    expect(resolved.steps[0].agent?.model).toBeUndefined();
  });
});
