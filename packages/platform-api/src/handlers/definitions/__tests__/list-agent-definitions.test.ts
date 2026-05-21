import { describe, expect, it, beforeEach } from 'vitest';
import { InMemoryAgentDefinitionRepository } from '@mediforce/platform-core/testing';
import { listAgentDefinitions } from '../list-agent-definitions.js';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope.js';

function makeInput(overrides: Partial<Parameters<InMemoryAgentDefinitionRepository['create']>[0]> = {}) {
  return {
    kind: 'plugin' as const,
    runtimeId: 'claude-code-agent',
    name: 'Test Agent',
    iconName: 'robot',
    description: 'An agent for testing',
    foundationModel: 'gpt-4',
    systemPrompt: 'You are a test agent',
    inputDescription: 'text',
    outputDescription: 'json',
    skillFileNames: [],
    visibility: 'private' as const,
    ...overrides,
  };
}

describe('listAgentDefinitions handler', () => {
  let agentDefinitionRepo: InMemoryAgentDefinitionRepository;

  beforeEach(() => {
    agentDefinitionRepo = new InMemoryAgentDefinitionRepository();
  });

  it('returns { agents: [] } when nothing is registered', async () => {
    const scope = createTestScope({ agentDefinitionRepo });
    const result = await listAgentDefinitions({}, scope);
    expect(result.agents).toEqual([]);
  });

  it('returns every agent for api-key callers regardless of visibility', async () => {
    await agentDefinitionRepo.create(makeInput({ name: 'A', namespace: 'team-alpha', visibility: 'private' }));
    await agentDefinitionRepo.create(makeInput({ name: 'B', namespace: 'team-beta', visibility: 'private' }));
    await agentDefinitionRepo.create(makeInput({ name: 'C', visibility: 'public' }));

    const scope = createTestScope({ agentDefinitionRepo });
    const result = await listAgentDefinitions({}, scope);

    expect(result.agents.map((a) => a.name).sort()).toEqual(['A', 'B', 'C']);
  });

  it('user callers see public agents and private agents in their namespaces', async () => {
    await agentDefinitionRepo.create(makeInput({ name: 'alpha-private', namespace: 'team-alpha', visibility: 'private' }));
    await agentDefinitionRepo.create(makeInput({ name: 'beta-private', namespace: 'team-beta', visibility: 'private' }));
    await agentDefinitionRepo.create(makeInput({ name: 'public-no-ns', visibility: 'public' }));
    await agentDefinitionRepo.create(makeInput({ name: 'public-with-ns', namespace: 'team-beta', visibility: 'public' }));

    const scope = createTestScope({
      agentDefinitionRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });

    const result = await listAgentDefinitions({}, scope);

    expect(result.agents.map((a) => a.name).sort()).toEqual([
      'alpha-private',
      'public-no-ns',
      'public-with-ns',
    ]);
  });

  it('drops private agents without a namespace for user callers', async () => {
    await agentDefinitionRepo.create(makeInput({ name: 'orphan-private', visibility: 'private' }));

    const scope = createTestScope({
      agentDefinitionRepo,
      caller: userCaller('u-2', ['team-anything']),
    });

    const result = await listAgentDefinitions({}, scope);

    expect(result.agents).toEqual([]);
  });
});
