import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryAgentDefinitionRepository,
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
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
      skillFileNames: [],
      namespace: 'team-alpha',
      visibility: 'private',
    });
    const scope = buildScope();
    const { mcpServers } = await upsertAgentMcpBinding(
      {
        id: created.id,
        name: 'github',
        binding: { type: 'http', url: 'https://example.com' },
      },
      scope,
    );
    expect(Object.keys(mcpServers)).toContain('github');
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
      skillFileNames: [],
      namespace: undefined,
      visibility: 'public',
    });
    const scope = buildScope(['team-alpha']);
    const { mcpServers } = await upsertAgentMcpBinding(
      {
        id: created.id,
        name: 'github',
        binding: { type: 'http', url: 'https://example.com' },
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
      skillFileNames: [],
      namespace: undefined,
      visibility: 'public',
      mcpServers: { github: { type: 'http', url: 'https://example.com' } },
    });
    const scope = buildScope(['team-alpha']);
    const { mcpServers } = await deleteAgentMcpBinding(
      { id: created.id, name: 'github' },
      scope,
    );
    expect(Object.keys(mcpServers)).not.toContain('github');
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
      skillFileNames: [],
      namespace: 'team-alpha',
      visibility: 'private',
      mcpServers: { github: { type: 'http', url: 'https://example.com' } },
    });
    const scope = buildScope();
    const { mcpServers } = await deleteAgentMcpBinding(
      { id: created.id, name: 'github' },
      scope,
    );
    expect(Object.keys(mcpServers)).not.toContain('github');
  });
});
