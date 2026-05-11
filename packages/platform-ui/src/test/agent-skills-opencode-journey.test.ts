import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { AgentDefinition } from '@mediforce/platform-core';

// Phase 0 RED — pins the OpenCode journey:
// Same Registry + agent setup as the Claude Code journey, but the assembler
// also returns parsed skill descriptions that the OpenCode prompt must
// expose under "## Available Skills" with /plugin/skills/<name>/ paths.

const fake = vi.hoisted(() => {
  const state = {
    agents: new Map<string, AgentDefinition>(),
    skillRegistries: new Map<string, unknown>(),
  };
  const services = {
    namespaceRepo: { getNamespace: async () => null },
    agentDefinitionRepo: {
      getById: async (id: string) => state.agents.get(id) ?? null,
      list: async () => Array.from(state.agents.values()),
      create: async (input: Record<string, unknown>) => {
        const id = (input.id as string | undefined) ?? `agent-${state.agents.size + 1}`;
        const now = new Date().toISOString();
        const agent = { id, createdAt: now, updatedAt: now, ...input } as unknown as AgentDefinition;
        state.agents.set(id, agent);
        return agent;
      },
      update: async (id: string, patch: Record<string, unknown>) => {
        const existing = state.agents.get(id);
        if (existing === undefined) throw new Error(`agent ${id} not found`);
        const updated = { ...(existing as object), ...patch, updatedAt: new Date().toISOString() } as AgentDefinition;
        state.agents.set(id, updated);
        return updated;
      },
      delete: async () => { /* unused */ },
    },
    skillRegistryRepo: {
      getById: async (id: string) => state.skillRegistries.get(id) ?? null,
      list: async () => Array.from(state.skillRegistries.values()),
      create: async (input: Record<string, unknown>) => {
        const id = (input.id as string | undefined) ?? `reg-${state.skillRegistries.size + 1}`;
        const now = new Date().toISOString();
        const record = { id, createdAt: now, updatedAt: now, ...input };
        state.skillRegistries.set(id, record);
        return record;
      },
      update: async (id: string, patch: Record<string, unknown>) => {
        const existing = state.skillRegistries.get(id);
        if (existing === undefined) throw new Error(`registry ${id} not found`);
        const updated = { ...(existing as object), ...patch, updatedAt: new Date().toISOString() };
        state.skillRegistries.set(id, updated);
        return updated;
      },
      delete: async (id: string) => { state.skillRegistries.delete(id); },
    },
  };
  return { state, services };
});

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => fake.services,
}));

vi.mock('@/lib/api-auth', () => ({
  resolveCallerIdentity: () => ({ kind: 'apiKey' }),
  requireNamespaceAccess: () => null,
  filterByNamespace: (_caller: unknown, items: unknown[]) => items,
}));

function jsonRequest(method: string, path: string, body?: unknown): NextRequest {
  const url = new URL(`http://localhost${path}`);
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  return new NextRequest(url.toString(), init);
}

interface RouteHandlerModule {
  POST?: (req: NextRequest) => Promise<Response>;
}

interface AssemblerModule {
  resolveAgentPluginDir: (
    agentId: string,
    deps: {
      agentDefinitionRepo: typeof fake.services.agentDefinitionRepo;
      skillRegistryRepo: typeof fake.services.skillRegistryRepo;
    },
  ) => Promise<{ pluginDir: string; skills: Array<{ name: string; description: string }> } | null>;
}

interface PromptIndexModule {
  buildAvailableSkillsBlock: (
    skills: Array<{ name: string; description: string }>,
  ) => string;
}

async function loadDynamic<T>(specifier: string): Promise<T> {
  return (await import(specifier)) as T;
}

describe('Agent Skills journey — OpenCode (Phase 0 RED, target Phase 1–2)', () => {
  beforeEach(() => {
    fake.state.agents.clear();
    fake.state.skillRegistries.clear();
  });

  it('[JOURNEY] OpenCode agent skills resolve to pluginDir + descriptions for prompt index', async () => {
    const registriesRoute = await loadDynamic<RouteHandlerModule>(
      '@/app/api/skill-registries/route',
    );
    const agentsRoute = await loadDynamic<RouteHandlerModule>(
      '@/app/api/agent-definitions/route',
    );

    const regA = await (await registriesRoute.POST!(
      jsonRequest('POST', '/api/skill-registries', {
        name: 'SDTM',
        namespace: 'appsilon',
        repo: { url: 'file:///tmp/sdtm', commit: 'a'.repeat(40) },
        skillsDir: 'skills',
      }),
    )).json() as { skillRegistry: { id: string } };
    const regB = await (await registriesRoute.POST!(
      jsonRequest('POST', '/api/skill-registries', {
        name: 'Style',
        namespace: 'appsilon',
        repo: { url: 'file:///tmp/style', commit: 'b'.repeat(40) },
        skillsDir: 'skills',
      }),
    )).json() as { skillRegistry: { id: string } };

    const agentRes = await agentsRoute.POST!(
      jsonRequest('POST', '/api/agent-definitions', {
        kind: 'plugin',
        runtimeId: 'opencode-agent',
        name: 'Multi-skill OpenCode agent',
        iconName: 'Bot',
        description: '',
        foundationModel: 'anthropic/claude-sonnet-4',
        systemPrompt: '',
        inputDescription: '',
        outputDescription: '',
        skills: [
          { registryId: regA.skillRegistry.id, name: 'sdtmig-reference' },
          { registryId: regB.skillRegistry.id, name: 'style-guide' },
        ],
      }),
    );
    expect(agentRes.status).toBe(201);

    const assembler = await loadDynamic<AssemblerModule>(
      '@/lib/resolve-agent-plugin-dir',
    );
    const indexer = await loadDynamic<PromptIndexModule>(
      '@mediforce/agent-runtime',
    );
    expect(typeof assembler.resolveAgentPluginDir).toBe('function');
    expect(typeof indexer.buildAvailableSkillsBlock).toBe('function');
  });
});
