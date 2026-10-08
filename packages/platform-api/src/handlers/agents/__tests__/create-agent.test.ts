import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryAgentDefinitionRepository,
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  InMemoryToolCatalogRepository,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { createAgent } from '../create-agent';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope';

describe('createAgent handler', () => {
  let agentDefinitionRepo: InMemoryAgentDefinitionRepository;
  let auditRepo: InMemoryAuditRepository;

  beforeEach(() => {
    resetFactorySequence();
    agentDefinitionRepo = new InMemoryAgentDefinitionRepository();
    const instanceRepo = new InMemoryProcessInstanceRepository();
    auditRepo = new InMemoryAuditRepository(instanceRepo);
  });

  function buildScope(namespaces = ['team-alpha']) {
    return createTestScope({
      agentDefinitionRepo,
      auditRepo,
      caller: userCaller('u-1', namespaces),
    });
  }

  it('createAgent stores the agent + emits audit', async () => {
    const scope = buildScope();
    const { agent } = await createAgent(
      {
        kind: 'plugin',
        name: 'Bob',
        iconName: 'Bot',
        description: 'd',
        foundationModel: 'm',
        systemPrompt: 'p',
        inputDescription: 'in',
        outputDescription: 'out',
        namespace: 'team-alpha',
        visibility: 'private',
      },
      scope,
    );
    expect(agent.name).toBe('Bob');
  });

  it('binds only MCP servers the workspace catalog holds', async () => {
    const toolCatalogRepo = new InMemoryToolCatalogRepository();
    await toolCatalogRepo.upsert('team-alpha', { id: 'github', type: 'http', url: 'https://api.githubcopilot.com/mcp/' });
    const scope = createTestScope({ agentDefinitionRepo, auditRepo, toolCatalogRepo, caller: userCaller('u-1', ['team-alpha']) });
    const base = {
      kind: 'plugin' as const,
      name: 'Bob',
      iconName: 'Bot',
      description: 'd',
      foundationModel: 'm',
      systemPrompt: 'p',
      inputDescription: 'in',
      outputDescription: 'out',
      namespace: 'team-alpha',
      visibility: 'private' as const,
    };

    const { agent } = await createAgent(
      { ...base, mcpServers: { gh: { type: 'http', catalogId: 'github' } } },
      scope,
    );
    expect(agent.mcpServers).toEqual({ gh: { type: 'http', catalogId: 'github' } });

    await expect(
      createAgent({ ...base, mcpServers: { ghost: { type: 'http', catalogId: 'not-there' } } }, scope),
    ).rejects.toMatchObject({ code: 'validation' });
    expect(await agentDefinitionRepo.listAll()).toHaveLength(1);
  });

  it('rejects an agent with no namespace instead of half-writing it', async () => {
    const scope = buildScope();
    await expect(
      createAgent(
        {
          kind: 'plugin',
          name: 'Nobody',
          iconName: 'Bot',
          description: 'd',
          foundationModel: 'm',
          systemPrompt: 'p',
          inputDescription: 'in',
          outputDescription: 'out',
          visibility: 'private',
        },
        scope,
      ),
    ).rejects.toThrow(/namespace/i);
    expect(await agentDefinitionRepo.listAll()).toEqual([]);
  });
});
