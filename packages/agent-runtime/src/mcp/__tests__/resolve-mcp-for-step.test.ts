import { describe, it, expect, beforeEach } from 'vitest';
import {
  AgentDefinitionSchema,
  CatalogEntryNotFoundError,
  WorkflowStepSchema,
  type AgentDefinition,
  type AgentDefinitionRepository,
  type CreateAgentDefinitionInput,
  type UpdateAgentDefinitionInput,
  type WorkflowStep,
} from '@mediforce/platform-core';
import { InMemoryToolCatalogRepository } from '@mediforce/platform-core/testing';
import {
  AgentDefinitionNotFoundError,
  resolveMcpForStep,
} from '../resolve-mcp-for-step.js';

class InMemoryAgentDefinitionRepository implements AgentDefinitionRepository {
  private readonly byId = new Map<string, AgentDefinition>();

  async create(_input: CreateAgentDefinitionInput): Promise<AgentDefinition> {
    throw new Error('create() not needed for this test double');
  }

  async upsert(id: string, input: CreateAgentDefinitionInput): Promise<AgentDefinition> {
    const now = new Date().toISOString();
    const existing = this.byId.get(id);
    const parsed = AgentDefinitionSchema.parse({
      ...input,
      id,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    this.byId.set(id, parsed);
    return parsed;
  }

  async getById(id: string): Promise<AgentDefinition | null> {
    return this.byId.get(id) ?? null;
  }

  async list(): Promise<AgentDefinition[]> {
    return [...this.byId.values()];
  }

  async update(_id: string, _input: UpdateAgentDefinitionInput): Promise<AgentDefinition> {
    throw new Error('update() not needed for this test double');
  }

  async delete(id: string): Promise<void> {
    this.byId.delete(id);
  }
}

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
      skillFileNames: [],
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
      skillFileNames: [],
      mcpServers: {
        tealflow: { type: 'stdio', catalogId: 'tealflow-mcp' },
      },
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
      skillFileNames: [],
      mcpServers: {
        tealflow: { type: 'stdio', catalogId: 'never-seeded' },
      },
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
    await catalogRepo.upsert(NS, { id: 'github-mcp', command: 'github-mcp' });
    await catalogRepo.upsert(NS, { id: 'cdisc-mcp', command: 'cdisc-mcp' });
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
      skillFileNames: [],
      mcpServers: {
        github: {
          type: 'stdio',
          catalogId: 'github-mcp',
          allowedTools: ['search_code', 'get_file_contents', 'delete_repo'],
        },
        cdisc: { type: 'stdio', catalogId: 'cdisc-mcp' },
      },
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

  it('passes http bindings through without touching the catalog', async () => {
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
      skillFileNames: [],
      mcpServers: {
        webmcp: { type: 'http', url: 'https://mcp.example.com/v1' },
      },
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
});
