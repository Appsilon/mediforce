import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryAgentDefinitionRepository,
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  InMemoryToolCatalogRepository,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { updateAgent } from '../update-agent';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope';
import { NotFoundError } from '../../../errors';

describe('updateAgent handler', () => {
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

  it('rejects new bindings to MCP servers the workspace catalog does not hold', async () => {
    const toolCatalogRepo = new InMemoryToolCatalogRepository();
    await toolCatalogRepo.upsert('team-alpha', { id: 'github', type: 'http', url: 'https://api.githubcopilot.com/mcp/' });
    const created = await agentDefinitionRepo.create({
      kind: 'plugin',
      name: 'Bob',
      iconName: 'Bot',
      description: 'd',
      foundationModel: 'm',
      systemPrompt: 'p',
      inputDescription: 'i',
      outputDescription: 'o',
      namespace: 'team-alpha',
      visibility: 'private',
    });
    const scope = createTestScope({ agentDefinitionRepo, auditRepo, toolCatalogRepo, caller: userCaller('u-1', ['team-alpha']) });

    await updateAgent({ id: created.id, body: { mcpServers: { gh: { type: 'http', catalogId: 'github' } } } }, scope);
    await expect(
      updateAgent({ id: created.id, body: { mcpServers: { gh: { type: 'stdio', catalogId: 'github' } } } }, scope),
    ).rejects.toMatchObject({ code: 'validation' });

    expect((await agentDefinitionRepo.getById(created.id))?.mcpServers).toEqual({
      gh: { type: 'http', catalogId: 'github' },
    });
  });

  it('updateAgent gates via wrapper (404 for foreign workspace)', async () => {
    const created = await agentDefinitionRepo.create({
      kind: 'plugin',
      name: 'Foreign',
      iconName: 'Bot',
      description: 'd',
      foundationModel: 'm',
      systemPrompt: 'p',
      inputDescription: 'i',
      outputDescription: 'o',
      namespace: 'team-beta',
      visibility: 'private',
    });
    const scope = buildScope(['team-alpha']);
    const err = await updateAgent(
      { id: created.id, body: { description: 'changed' } },
      scope,
    ).catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundError);
  });

  it('updateAgent throws NotFoundError for a non-system member on a namespace-less public agent', async () => {
    const created = await agentDefinitionRepo.create({
      kind: 'plugin',
      name: 'Claude Code',
      iconName: 'Bot',
      description: 'd',
      foundationModel: 'm',
      systemPrompt: 'p',
      inputDescription: 'i',
      outputDescription: 'o',
      namespace: undefined,
      visibility: 'public',
    });
    const scope = buildScope(['team-alpha']);
    const err = await updateAgent(
      { id: created.id, body: { description: 'changed' } },
      scope,
    ).catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundError);
  });
});
