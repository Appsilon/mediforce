import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { AgentDefinition } from '@mediforce/platform-core';

// Phase 0 RED — pins the Claude Code journey:
//  Workspace creates two SkillRegistries (REST), creates an agent referencing
//  one skill from each, runtime assembles a per-run plugin dir, and the
//  spawn options carry that pluginDir. No `## Skills` blob in prompt.
//
// On main today, the registry route does not exist (POST → 404 / import
// throws), agent schema has no `skills` field, and the wiring to populate
// `agentPluginDir` does not exist. This file is expected to fail at module
// load time until Phase 1–2 land.

const fake = vi.hoisted(() => {
  const state = {
    namespaces: new Map<string, unknown>(),
    agents: new Map<string, AgentDefinition>(),
    skillRegistries: new Map<string, unknown>(),
  };
  const services = {
    namespaceRepo: {
      getNamespace: async (handle: string) => state.namespaces.get(handle) ?? null,
    },
    agentDefinitionRepo: {
      getById: async (id: string) => state.agents.get(id) ?? null,
      list: async () => Array.from(state.agents.values()),
      create: async (input: Record<string, unknown>) => {
        const id = (input.id as string | undefined) ?? `agent-${state.agents.size + 1}`;
        const now = new Date().toISOString();
        const agent = {
          id,
          createdAt: now,
          updatedAt: now,
          ...input,
        } as unknown as AgentDefinition;
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
      delete: async (id: string) => { state.skillRegistries.delete(id); },
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
  GET?: (req: NextRequest) => Promise<Response>;
  POST?: (req: NextRequest) => Promise<Response>;
  PATCH?: (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  DELETE?: (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
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

async function loadDynamic<T>(specifier: string): Promise<T> {
  return (await import(specifier)) as T;
}

describe('Agent Skills journey — Claude Code (Phase 0 RED, target Phase 1–2)', () => {
  beforeEach(() => {
    fake.state.namespaces.clear();
    fake.state.agents.clear();
    fake.state.skillRegistries.clear();
  });

  it('[JOURNEY] CRUD on /api/skill-registries, then agent.skills references both registries', async () => {
    const registriesRoute = await loadDynamic<RouteHandlerModule>(
      '@/app/api/skill-registries/route',
    );

    expect(typeof registriesRoute.POST).toBe('function');

    const createA = await registriesRoute.POST!(
      jsonRequest('POST', '/api/skill-registries', {
        name: 'SDTM skills',
        namespace: 'appsilon',
        repo: { url: 'file:///tmp/repo-a', commit: 'a'.repeat(40) },
        skillsDir: 'skills',
      }),
    );
    expect(createA.status).toBe(201);
    const bodyA = await createA.json() as { skillRegistry: { id: string } };
    const regAId = bodyA.skillRegistry.id;
    expect(typeof regAId).toBe('string');

    const createB = await registriesRoute.POST!(
      jsonRequest('POST', '/api/skill-registries', {
        name: 'Style',
        namespace: 'appsilon',
        repo: { url: 'file:///tmp/repo-b', commit: 'b'.repeat(40) },
        skillsDir: 'skills',
      }),
    );
    expect(createB.status).toBe(201);
    const bodyB = await createB.json() as { skillRegistry: { id: string } };
    const regBId = bodyB.skillRegistry.id;

    // List returns both.
    const listRes = await registriesRoute.GET!(jsonRequest('GET', '/api/skill-registries'));
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json() as { skillRegistries: Array<{ id: string }> };
    expect(listBody.skillRegistries.map((r) => r.id).sort()).toEqual([regAId, regBId].sort());

    // Create the agent referencing one skill from each registry.
    const agentsRoute = await loadDynamic<RouteHandlerModule>('@/app/api/agent-definitions/route');
    const agentRes = await agentsRoute.POST!(
      jsonRequest('POST', '/api/agent-definitions', {
        kind: 'plugin',
        runtimeId: 'claude-code-agent',
        name: 'Multi-skill CC agent',
        iconName: 'Bot',
        description: '',
        foundationModel: 'anthropic/claude-sonnet-4',
        systemPrompt: '',
        inputDescription: '',
        outputDescription: '',
        skills: [
          { registryId: regAId, name: 'sdtmig-reference' },
          { registryId: regBId, name: 'style-guide' },
        ],
      }),
    );
    expect(agentRes.status).toBe(201);
    const agentBody = await agentRes.json() as { agent: AgentDefinition & { skills: Array<{ registryId: string; name: string }> } };
    expect(agentBody.agent.skills).toHaveLength(2);
    expect(agentBody.agent.skills[0].registryId).toBe(regAId);

    // The Phase 2 wiring takes (agentId, repos) and returns the assembled
    // pluginDir + parsed skill descriptions. Today this module does not
    // exist; the dynamic import throws.
    const assembler = await loadDynamic<AssemblerModule>(
      '@/lib/resolve-agent-plugin-dir',
    );
    expect(typeof assembler.resolveAgentPluginDir).toBe('function');
  });

  it('[CONTRACT] AgentDefinition no longer accepts skillFileNames after Phase 4', async () => {
    const agentsRoute = await loadDynamic<RouteHandlerModule>('@/app/api/agent-definitions/route');
    const res = await agentsRoute.POST!(
      jsonRequest('POST', '/api/agent-definitions', {
        kind: 'plugin',
        runtimeId: 'claude-code-agent',
        name: 'Legacy skill blob agent',
        iconName: 'Bot',
        description: '',
        foundationModel: 'anthropic/claude-sonnet-4',
        systemPrompt: '',
        inputDescription: '',
        outputDescription: '',
        skillFileNames: ['workspaces/abc/skills/foo.md'],
      }),
    );
    // Today this returns 201 (field still accepted). After Phase 4 the
    // schema rejects unknown keys (or omits the field) — the request must
    // not silently round-trip skillFileNames.
    if (res.status === 201) {
      const body = await res.json() as { agent: Record<string, unknown> };
      expect(body.agent.skillFileNames).toBeUndefined();
    } else {
      expect(res.status).toBe(400);
    }
  });
});
