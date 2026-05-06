import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryAgentOAuthTokenRepository,
  InMemoryConnectionRepository,
  InMemoryToolCatalogRepository,
  type AgentDefinition,
  type AgentDefinitionRepository,
  type AgentMcpBindingMap,
  type CreateAgentDefinitionInput,
  type UpdateAgentDefinitionInput,
} from '@mediforce/platform-core';
import { migrateNamespaceConnections } from '../migrations/unify-tool-catalog-connections.js';

const NS = 'acme';

class InMemoryAgentDefinitionRepository implements AgentDefinitionRepository {
  private readonly store = new Map<string, AgentDefinition>();

  async list(): Promise<AgentDefinition[]> {
    return [...this.store.values()].map((a) => structuredClone(a));
  }
  async getById(id: string): Promise<AgentDefinition | null> {
    const a = this.store.get(id);
    return a ? structuredClone(a) : null;
  }
  async create(input: CreateAgentDefinitionInput): Promise<AgentDefinition> {
    const now = new Date().toISOString();
    const def: AgentDefinition = {
      ...(input as AgentDefinition),
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(def.id, def);
    return structuredClone(def);
  }
  async update(id: string, patch: UpdateAgentDefinitionInput): Promise<AgentDefinition> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`agent ${id} not found`);
    const updated: AgentDefinition = {
      ...existing,
      ...(patch as Partial<AgentDefinition>),
      id,
      updatedAt: new Date().toISOString(),
    };
    this.store.set(id, updated);
    return structuredClone(updated);
  }
  async upsert(id: string, input: CreateAgentDefinitionInput): Promise<AgentDefinition> {
    const def: AgentDefinition = {
      ...(input as AgentDefinition),
      id,
      createdAt: this.store.get(id)?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.store.set(id, def);
    return structuredClone(def);
  }
  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }
}

function makeAgent(id: string, mcpServers: AgentMcpBindingMap): AgentDefinition {
  return {
    id,
    kind: 'plugin',
    name: id,
    iconName: 'bot',
    description: '',
    foundationModel: 'sonnet',
    systemPrompt: '',
    inputDescription: '',
    outputDescription: '',
    skillFileNames: [],
    mcpServers,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('migrateNamespaceConnections', () => {
  let agentRepo: InMemoryAgentDefinitionRepository;
  let catalogRepo: InMemoryToolCatalogRepository;
  let tokenRepo: InMemoryAgentOAuthTokenRepository;
  let connRepo: InMemoryConnectionRepository;

  beforeEach(() => {
    agentRepo = new InMemoryAgentDefinitionRepository();
    catalogRepo = new InMemoryToolCatalogRepository();
    tokenRepo = new InMemoryAgentOAuthTokenRepository();
    connRepo = new InMemoryConnectionRepository();
  });

  function deps() {
    return {
      agentDefinitionRepo: agentRepo,
      toolCatalogRepo: catalogRepo,
      agentOAuthTokenRepo: tokenRepo,
      connectionRepo: connRepo,
    };
  }

  it('lifts an http+oauth binding into a Connection + ToolCatalogEntry and rewrites the binding', async () => {
    await agentRepo.create(
      makeAgent('agent-1', {
        github: {
          type: 'http',
          url: 'https://api.githubcopilot.com/mcp/',
          auth: { type: 'oauth', provider: 'github', headerName: 'Authorization', headerValueTemplate: 'Bearer {token}' },
        },
      }),
    );
    await tokenRepo.put(NS, 'agent-1', 'github', {
      provider: 'github',
      accessToken: 'gho_existing',
      refreshToken: 'ghr_existing',
      expiresAt: 1_900_000_000_000,
      scope: 'repo',
      providerUserId: '12345',
      accountLogin: 'octocat',
      connectedAt: 1_700_000_000_000,
      connectedBy: 'uid-1',
    });

    const report = await migrateNamespaceConnections(NS, deps());

    expect(report.createdConnections).toBe(1);
    expect(report.createdCatalogEntries).toBe(1);
    expect(report.rewrittenBindings).toBe(1);
    expect(report.migratedTokens).toBe(1);
    expect(report.skipped).toEqual([]);

    const conn = await connRepo.getById(NS, 'github');
    expect(conn).not.toBeNull();
    if (conn?.auth.type === 'oauth') {
      expect(conn.auth.providerId).toBe('github');
      expect(conn.auth.accessToken).toBe('gho_existing');
      expect(conn.auth.refreshToken).toBe('ghr_existing');
    }

    const entry = await catalogRepo.getById(NS, 'github-mcp');
    expect(entry?.mcp).toEqual({ type: 'http', url: 'https://api.githubcopilot.com/mcp/' });
    expect(entry?.connectionId).toBe('github');

    const updatedAgent = await agentRepo.getById('agent-1');
    const updatedBinding = updatedAgent?.mcpServers?.github;
    expect(updatedBinding?.type).toBe('catalog');
    if (updatedBinding?.type === 'catalog') {
      expect(updatedBinding.catalogId).toBe('github-mcp');
    }
  });

  it('lifts an http+headers binding into a headers-typed Connection', async () => {
    await agentRepo.create(
      makeAgent('agent-2', {
        jira: {
          type: 'http',
          url: 'https://example.atlassian.net/mcp/',
          auth: { type: 'headers', headers: { 'X-Api-Key': '{{SECRET:jira_key}}' } },
        },
      }),
    );

    const report = await migrateNamespaceConnections(NS, deps());
    expect(report.createdConnections).toBe(1);
    const conn = await connRepo.getById(NS, 'jira');
    expect(conn?.auth.type).toBe('headers');
  });

  it('is idempotent — second run reports zeros', async () => {
    await agentRepo.create(
      makeAgent('agent-1', {
        github: {
          type: 'http',
          url: 'https://api.x/',
          auth: { type: 'oauth', provider: 'github', headerName: 'Authorization', headerValueTemplate: 'Bearer {token}' },
        },
      }),
    );

    await migrateNamespaceConnections(NS, deps());
    const second = await migrateNamespaceConnections(NS, deps());
    expect(second.createdConnections).toBe(0);
    expect(second.createdCatalogEntries).toBe(0);
    expect(second.rewrittenBindings).toBe(0);
    expect(second.migratedTokens).toBe(0);
  });

  it('preserves allowedTools on the catalog-ref binding', async () => {
    await agentRepo.create(
      makeAgent('agent-1', {
        github: {
          type: 'http',
          url: 'https://api.x/',
          allowedTools: ['search', 'view'],
          auth: { type: 'oauth', provider: 'github', headerName: 'Authorization', headerValueTemplate: 'Bearer {token}' },
        },
      }),
    );
    await migrateNamespaceConnections(NS, deps());
    const updated = await agentRepo.getById('agent-1');
    if (updated?.mcpServers?.github?.type === 'catalog') {
      expect(updated.mcpServers.github.allowedTools).toEqual(['search', 'view']);
    }
  });

  it('skips bindings without a recognizable auth shape', async () => {
    // http binding without auth — unusual but legal in the schema (auth is
    // optional). We can't synthesize a Connection without provider info, so
    // log it in the skipped list and leave the binding untouched.
    await agentRepo.create(
      makeAgent('agent-1', {
        public: { type: 'http', url: 'https://public.api/' },
      }),
    );
    const report = await migrateNamespaceConnections(NS, deps());
    expect(report.skipped).toHaveLength(1);
    expect(report.skipped[0]?.reason).toMatch(/no recognized auth/);
    expect(report.createdConnections).toBe(0);
  });

  it('leaves stdio bindings untouched (out of scope for this lift)', async () => {
    await agentRepo.create(
      makeAgent('agent-1', { gh: { type: 'stdio', catalogId: 'github-mcp-stdio' } }),
    );
    const report = await migrateNamespaceConnections(NS, deps());
    expect(report.createdConnections).toBe(0);
    expect(report.rewrittenBindings).toBe(0);
  });
});
