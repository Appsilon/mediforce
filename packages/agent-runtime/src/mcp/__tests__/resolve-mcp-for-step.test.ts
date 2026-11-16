import { describe, it, expect, beforeEach } from 'vitest';
import {
  CatalogEntryNotFoundError,
  WorkflowStepSchema,
  type WorkflowStep,
} from '@mediforce/platform-core';
import {
  InMemoryAgentDefinitionRepository,
  InMemoryToolCatalogRepository,
} from '@mediforce/platform-core/testing';
import {
  AgentDefinitionNotFoundError,
  resolveMcpForStep,
} from '../resolve-mcp-for-step';

function makeStep(overrides: Partial<WorkflowStep> = {}): WorkflowStep {
  return WorkflowStepSchema.parse({
    id: 'explore',
    name: 'Explore',
    type: 'creation',
    executor: 'agent',
    ...overrides,
  });
}

const NS = 'appsilon';

describe('resolveMcpForStep', () => {
  let agentRepo: InMemoryAgentDefinitionRepository;
  let catalogRepo: InMemoryToolCatalogRepository;

  beforeEach(() => {
    agentRepo = new InMemoryAgentDefinitionRepository();
    catalogRepo = new InMemoryToolCatalogRepository();
  });

  it('returns null when step has no agentId (no MCP resolution runs)', async () => {
    const step = makeStep();
    const result = await resolveMcpForStep(step, {
      agentDefinitionRepo: agentRepo,
      toolCatalogRepo: catalogRepo,
      namespace: NS,
    });
    expect(result).toBeNull();
  });

  it('throws AgentDefinitionNotFoundError when agentId is rotten', async () => {
    const step = makeStep({ agentId: 'missing-agent' });
    await expect(
      resolveMcpForStep(step, {
        agentDefinitionRepo: agentRepo,
        toolCatalogRepo: catalogRepo,
        namespace: NS,
      }),
    ).rejects.toThrow(AgentDefinitionNotFoundError);
  });

  it('returns empty servers when agent has no mcpServers', async () => {
    await agentRepo.upsert('bare-agent', {
      kind: 'plugin',
      runtimeId: 'claude-code-agent',
      name: 'Bare',
      iconName: 'Bot',
      description: '',
      foundationModel: 'sonnet',
      systemPrompt: '',
      inputDescription: '',
      outputDescription: '',
      visibility: 'private',
    });
    const step = makeStep({ agentId: 'bare-agent' });

    const result = await resolveMcpForStep(step, {
      agentDefinitionRepo: agentRepo,
      toolCatalogRepo: catalogRepo,
      namespace: NS,
    });
    expect(result).toEqual({ servers: {} });
  });

  it('resolves stdio bindings via the catalog', async () => {
    await catalogRepo.upsert(NS, {
      id: 'tealflow-mcp',
      type: 'stdio',
      command: 'tealflow-mcp',
      args: ['--stdio'],
      description: 'Tealflow MCP',
    });
    await agentRepo.upsert('tealflow-chat', {
      kind: 'cowork',
      runtimeId: 'chat',
      name: 'Tealflow Cowork Chat',
      iconName: 'MessageCircle',
      description: '',
      foundationModel: 'sonnet',
      systemPrompt: '',
      inputDescription: '',
      outputDescription: '',
      mcpServers: {
        tealflow: { type: 'stdio', catalogId: 'tealflow-mcp' },
      },
      visibility: 'private',
    });
    const step = makeStep({ agentId: 'tealflow-chat', executor: 'cowork' });

    const result = await resolveMcpForStep(step, {
      agentDefinitionRepo: agentRepo,
      toolCatalogRepo: catalogRepo,
      namespace: NS,
    });

    expect(result!.servers.tealflow).toMatchObject({
      type: 'stdio',
      command: 'tealflow-mcp',
      args: ['--stdio'],
    });
  });

  it('surfaces CatalogEntryNotFoundError when binding references missing catalogId', async () => {
    await agentRepo.upsert('tealflow-chat', {
      kind: 'cowork',
      runtimeId: 'chat',
      name: 'Tealflow Cowork Chat',
      iconName: 'MessageCircle',
      description: '',
      foundationModel: 'sonnet',
      systemPrompt: '',
      inputDescription: '',
      outputDescription: '',
      mcpServers: {
        tealflow: { type: 'stdio', catalogId: 'never-seeded' },
      },
      visibility: 'private',
    });
    const step = makeStep({ agentId: 'tealflow-chat', executor: 'cowork' });

    await expect(
      resolveMcpForStep(step, {
        agentDefinitionRepo: agentRepo,
        toolCatalogRepo: catalogRepo,
        namespace: NS,
      }),
    ).rejects.toThrow(CatalogEntryNotFoundError);
  });

  it('applies step-level denyTools and disable restrictions', async () => {
    await catalogRepo.upsert(NS, { id: 'github-mcp', type: 'stdio', command: 'github-mcp' });
    await catalogRepo.upsert(NS, { id: 'cdisc-mcp', type: 'stdio', command: 'cdisc-mcp' });
    await agentRepo.upsert('analyst', {
      kind: 'plugin',
      runtimeId: 'claude-code-agent',
      name: 'Analyst',
      iconName: 'Bot',
      description: '',
      foundationModel: 'sonnet',
      systemPrompt: '',
      inputDescription: '',
      outputDescription: '',
      mcpServers: {
        github: {
          type: 'stdio',
          catalogId: 'github-mcp',
          allowedTools: ['search_code', 'get_file_contents', 'delete_repo'],
        },
        cdisc: { type: 'stdio', catalogId: 'cdisc-mcp' },
      },
      visibility: 'private',
    });
    const step = makeStep({
      agentId: 'analyst',
      mcpRestrictions: {
        github: { denyTools: ['delete_repo'] },
        cdisc: { disable: true },
      },
    });

    const result = await resolveMcpForStep(step, {
      agentDefinitionRepo: agentRepo,
      toolCatalogRepo: catalogRepo,
      namespace: NS,
    });

    expect(result!.servers.cdisc).toBeUndefined();
    expect(result!.servers.github).toBeDefined();
    expect((result!.servers.github as { allowedTools?: string[] }).allowedTools)
      .toEqual(['search_code', 'get_file_contents']);
  });

  it('resolves http bindings through the catalog', async () => {
    await catalogRepo.upsert(NS, { id: 'webmcp', type: 'http', url: 'https://mcp.example.com/v1' });
    await agentRepo.upsert('remote-agent', {
      kind: 'plugin',
      runtimeId: 'claude-code-agent',
      name: 'Remote',
      iconName: 'Bot',
      description: '',
      foundationModel: 'sonnet',
      systemPrompt: '',
      inputDescription: '',
      outputDescription: '',
      mcpServers: {
        webmcp: { type: 'http', catalogId: 'webmcp' },
      },
      visibility: 'private',
    });
    const step = makeStep({ agentId: 'remote-agent' });

    const result = await resolveMcpForStep(step, {
      agentDefinitionRepo: agentRepo,
      toolCatalogRepo: catalogRepo,
      namespace: NS,
    });
    expect(result!.servers.webmcp).toMatchObject({
      type: 'http',
      url: 'https://mcp.example.com/v1',
    });
  });

  it("reads a public agent's catalog from its owning workspace, not the workflow's", async () => {
    await catalogRepo.upsert('owner-ws', { id: 'webmcp', type: 'http', url: 'https://owner.example.com/mcp' });
    await catalogRepo.upsert(NS, { id: 'webmcp', type: 'http', url: 'https://unrelated.example.com/mcp' });
    await agentRepo.upsert('shared-agent', {
      kind: 'plugin',
      runtimeId: 'claude-code-agent',
      name: 'Shared',
      iconName: 'Bot',
      description: '',
      foundationModel: 'sonnet',
      systemPrompt: '',
      inputDescription: '',
      outputDescription: '',
      mcpServers: {
        webmcp: { type: 'http', catalogId: 'webmcp' },
      },
      namespace: 'owner-ws',
      visibility: 'public',
    });
    const step = makeStep({ agentId: 'shared-agent' });

    const result = await resolveMcpForStep(step, {
      agentDefinitionRepo: agentRepo,
      toolCatalogRepo: catalogRepo,
      namespace: NS,
    });
    expect(result!.servers.webmcp).toMatchObject({
      type: 'http',
      url: 'https://owner.example.com/mcp',
    });
  });

  it("[DATA] a pinned version resolves the agent's MCP bindings as they were then, not live (ADR-0029 epic #1673)", async () => {
    await catalogRepo.upsert(NS, { id: 'old-mcp', type: 'stdio', command: 'old-mcp' });
    await catalogRepo.upsert(NS, { id: 'new-mcp', type: 'stdio', command: 'new-mcp' });
    await agentRepo.upsert('drift-agent', {
      kind: 'plugin',
      runtimeId: 'claude-code-agent',
      name: 'Drift',
      iconName: 'Bot',
      description: '',
      foundationModel: 'sonnet',
      systemPrompt: '',
      inputDescription: '',
      outputDescription: '',
      mcpServers: { newServer: { type: 'stdio', catalogId: 'new-mcp' } },
      visibility: 'private',
    });
    await agentRepo.appendVersion({
      agentId: 'drift-agent',
      version: 1,
      hash: 'a'.repeat(64),
      config: {
        kind: 'plugin',
        runtimeId: 'claude-code-agent',
        foundationModel: 'sonnet',
        systemPrompt: '',
        mcpServers: { oldServer: { type: 'stdio', catalogId: 'old-mcp' } },
        skills: [],
      },
      createdBy: 'author-1',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const step = makeStep({ agentId: 'drift-agent' });

    const result = await resolveMcpForStep(step, {
      agentDefinitionRepo: agentRepo,
      toolCatalogRepo: catalogRepo,
      namespace: NS,
    }, 1);

    expect(Object.keys(result!.servers)).toEqual(['oldServer']);
  });
});
