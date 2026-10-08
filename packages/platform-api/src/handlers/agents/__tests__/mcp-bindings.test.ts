import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryAgentDefinitionRepository,
  InMemoryAuditRepository,
  InMemoryNamespaceRepository,
  InMemoryProcessInstanceRepository,
  InMemoryToolCatalogRepository,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { upsertAgentMcpBinding, deleteAgentMcpBinding } from '../mcp-bindings';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope';

describe('agent MCP binding handlers', () => {
  let agentDefinitionRepo: InMemoryAgentDefinitionRepository;
  let auditRepo: InMemoryAuditRepository;
  let namespaceRepo: InMemoryNamespaceRepository;
  let toolCatalogRepo: InMemoryToolCatalogRepository;

  beforeEach(async () => {
    toolCatalogRepo = new InMemoryToolCatalogRepository();
    await toolCatalogRepo.upsert('team-alpha', { id: 'example', type: 'http', url: 'https://example.com' });
    await toolCatalogRepo.upsert('team-alpha', { id: 'filesystem', type: 'stdio', command: 'mcp-fs' });
    resetFactorySequence();
    agentDefinitionRepo = new InMemoryAgentDefinitionRepository();
    const instanceRepo = new InMemoryProcessInstanceRepository();
    auditRepo = new InMemoryAuditRepository(instanceRepo);
    namespaceRepo = new InMemoryNamespaceRepository();
    // u-1's personal namespace — the FK-valid workspace a global-agent audit
    // event is attributed to.
    await namespaceRepo.createNamespaceWithOwner({
      namespace: {
        handle: 'u-1',
        type: 'personal',
        displayName: 'U One',
        linkedUserId: 'u-1',
        createdAt: new Date().toISOString(),
      },
      ownerMember: { uid: 'u-1', role: 'owner', joinedAt: new Date().toISOString() },
    });
  });

  function buildScope(namespaces = ['team-alpha']) {
    return createTestScope({
      agentDefinitionRepo,
      auditRepo,
      namespaceRepo,
      toolCatalogRepo,
      caller: userCaller('u-1', namespaces),
    });
  }

  it('upsertAgentMcpBinding adds binding and emits audit', async () => {
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
    const scope = buildScope();
    const { mcpServers } = await upsertAgentMcpBinding(
      {
        id: created.id,
        name: 'github',
        binding: { type: 'http', catalogId: 'example' },
      },
      scope,
    );
    expect(Object.keys(mcpServers)).toContain('github');
  });

  async function createTeamAgent() {
    return agentDefinitionRepo.create({
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
  }

  it('upsertAgentMcpBinding rejects a binding to a server missing from the catalog', async () => {
    const created = await createTeamAgent();
    await expect(
      upsertAgentMcpBinding(
        { id: created.id, name: 'ghost', binding: { type: 'http', catalogId: 'not-there' } },
        buildScope(),
      ),
    ).rejects.toThrow(/no MCP server "not-there"/);
    expect((await agentDefinitionRepo.getById(created.id))?.mcpServers).toBeUndefined();
  });

  it('upsertAgentMcpBinding rejects a binding whose type differs from the catalog entry', async () => {
    const created = await createTeamAgent();
    await expect(
      upsertAgentMcpBinding(
        { id: created.id, name: 'fs', binding: { type: 'http', catalogId: 'filesystem' } },
        buildScope(),
      ),
    ).rejects.toThrow(/is stdio, but the binding declares http/);
  });

  it('upsertAgentMcpBinding succeeds for a non-system caller on a namespace-less agent', async () => {
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
    const { mcpServers } = await upsertAgentMcpBinding(
      {
        id: created.id,
        name: 'github',
        binding: { type: 'http', catalogId: 'example' },
      },
      scope,
    );
    expect(Object.keys(mcpServers)).toContain('github');
  });

  it('deleteAgentMcpBinding succeeds for a non-system caller on a namespace-less agent', async () => {
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
      mcpServers: { github: { type: 'http', catalogId: 'example' } },
    });
    const scope = buildScope(['team-alpha']);
    const { mcpServers } = await deleteAgentMcpBinding(
      { id: created.id, name: 'github' },
      scope,
    );
    expect(Object.keys(mcpServers)).not.toContain('github');
  });

  it('upsertAgentMcpBinding rejects a global agent when the caller has no namespace', async () => {
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
    // apiKey caller has no personal namespace → no FK-valid workspace to
    // attribute the audit event to.
    const scope = createTestScope({ agentDefinitionRepo, auditRepo, namespaceRepo });
    await expect(
      upsertAgentMcpBinding(
        { id: created.id, name: 'github', binding: { type: 'http', catalogId: 'example' } },
        scope,
      ),
    ).rejects.toThrow(/no namespace/i);
  });

  it('deleteAgentMcpBinding removes binding', async () => {
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
      mcpServers: { github: { type: 'http', catalogId: 'example' } },
    });
    const scope = buildScope();
    const { mcpServers } = await deleteAgentMcpBinding(
      { id: created.id, name: 'github' },
      scope,
    );
    expect(Object.keys(mcpServers)).not.toContain('github');
  });
});
