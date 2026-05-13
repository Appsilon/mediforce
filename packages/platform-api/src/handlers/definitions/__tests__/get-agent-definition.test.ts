import { describe, expect, it, beforeEach } from 'vitest';
import { InMemoryAgentDefinitionRepository } from '@mediforce/platform-core/testing';
import { getAgentDefinition } from '../get-agent-definition.js';
import { NotFoundError } from '../../../errors.js';
import type { CallerIdentity } from '../../../auth.js';

const apiKey: CallerIdentity = { kind: 'apiKey' };

const baseInput = {
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
};

describe('getAgentDefinition handler', () => {
  let agentDefinitionRepo: InMemoryAgentDefinitionRepository;

  beforeEach(() => {
    agentDefinitionRepo = new InMemoryAgentDefinitionRepository();
  });

  it('returns the agent for api-key callers', async () => {
    await agentDefinitionRepo.upsert('agent-42', {
      ...baseInput,
      namespace: 'team-alpha',
      visibility: 'private',
    });

    const result = await getAgentDefinition({ id: 'agent-42' }, { agentDefinitionRepo }, apiKey);

    expect(result.agent.id).toBe('agent-42');
  });

  it('throws NotFoundError when the id is unknown', async () => {
    await expect(
      getAgentDefinition({ id: 'missing' }, { agentDefinitionRepo }, apiKey),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws NotFoundError before checking visibility for missing ids', async () => {
    const stranger: CallerIdentity = {
      kind: 'user',
      uid: 'u-x',
      namespaces: new Set(),
    };

    await expect(
      getAgentDefinition({ id: 'definitely-missing' }, { agentDefinitionRepo }, stranger),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('public agents are readable by any user caller', async () => {
    await agentDefinitionRepo.upsert('public-agent', {
      ...baseInput,
      namespace: 'team-alpha',
      visibility: 'public',
    });

    const stranger: CallerIdentity = {
      kind: 'user',
      uid: 'u-1',
      namespaces: new Set(['team-other']),
    };

    const result = await getAgentDefinition(
      { id: 'public-agent' },
      { agentDefinitionRepo },
      stranger,
    );

    expect(result.agent.id).toBe('public-agent');
  });

  it('private agents are readable by users in the agent’s namespace', async () => {
    await agentDefinitionRepo.upsert('private-agent', {
      ...baseInput,
      namespace: 'team-alpha',
      visibility: 'private',
    });

    const userInAlpha: CallerIdentity = {
      kind: 'user',
      uid: 'u-1',
      namespaces: new Set(['team-alpha']),
    };

    const result = await getAgentDefinition(
      { id: 'private-agent' },
      { agentDefinitionRepo },
      userInAlpha,
    );

    expect(result.agent.id).toBe('private-agent');
  });

  it('returns NotFoundError when a user reads a private agent outside their namespace', async () => {
    // Anti-enumeration: a forbidden private agent looks identical on the wire
    // to a missing one. Matches the pre-migration `canRead` behaviour from
    // `app/api/agent-definitions/[id]/route.ts`.
    await agentDefinitionRepo.upsert('private-agent', {
      ...baseInput,
      namespace: 'team-alpha',
      visibility: 'private',
    });

    const stranger: CallerIdentity = {
      kind: 'user',
      uid: 'u-2',
      namespaces: new Set(['team-beta']),
    };

    await expect(
      getAgentDefinition({ id: 'private-agent' }, { agentDefinitionRepo }, stranger),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('returns NotFoundError when a private agent has no namespace at all', async () => {
    await agentDefinitionRepo.upsert('orphan-private', {
      ...baseInput,
      visibility: 'private',
    });

    const someUser: CallerIdentity = {
      kind: 'user',
      uid: 'u-3',
      namespaces: new Set(['team-alpha']),
    };

    await expect(
      getAgentDefinition({ id: 'orphan-private' }, { agentDefinitionRepo }, someUser),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
