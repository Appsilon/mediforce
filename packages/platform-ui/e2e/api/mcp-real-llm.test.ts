import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type {
  AgentDefinition,
  Namespace,
  WorkflowStep,
} from '@mediforce/platform-core';
import {
  resolveMcpForStep,
  flattenResolvedMcpToLegacy,
} from '@mediforce/agent-runtime';
import { McpClientManager } from '@mediforce/mcp-client';

// ---- Gating ---------------------------------------------------------
//
// Tier 2 tests spawn real MCP subprocesses and call a real LLM provider
// (OpenRouter). They're slow, cost a fraction of a cent per run, and
// depend on external availability — deliberately off the default CI
// suite. Two conditions must hold to run:
//   1. Vitest must load this file via vitest.config.e2e-api.ts (the
//      default config excludes e2e/**).
//   2. OPENROUTER_API_KEY must be set.
// If (2) is missing, the suite skips with a clear diagnostic instead of
// failing, so `pnpm test:mcp-real` without a key is a no-op.

const openrouterApiKey = process.env.OPENROUTER_API_KEY;
const realLlmModel = process.env.TIER2_MODEL ?? 'anthropic/claude-haiku-4.5';
const hasKey = openrouterApiKey !== undefined && openrouterApiKey.length > 0;

// ---- Shared state + fake platform services (mirrors Tier 1) --------

const fake = vi.hoisted(() => {
  const state = {
    namespaces: new Map<string, unknown>(),
    catalog: new Map<string, Map<string, unknown>>(),
    agents: new Map<string, unknown>(),
  };

  const nsCatalog = (ns: string): Map<string, unknown> => {
    let bucket = state.catalog.get(ns);
    if (bucket === undefined) {
      bucket = new Map();
      state.catalog.set(ns, bucket);
    }
    return bucket;
  };

  const services = {
    namespaceRepo: {
      getNamespace: async (handle: string) =>
        state.namespaces.get(handle) ?? null,
    },
    toolCatalogRepo: {
      list: async (ns: string) => Array.from(nsCatalog(ns).values()),
      getById: async (ns: string, id: string) =>
        nsCatalog(ns).get(id) ?? null,
      upsert: async (ns: string, entry: unknown) => {
        const typed = entry as { id: string };
        nsCatalog(ns).set(typed.id, entry);
        return entry;
      },
      delete: async (ns: string, id: string) => {
        nsCatalog(ns).delete(id);
      },
    },
    agentDefinitionRepo: {
      getById: async (id: string) => state.agents.get(id) ?? null,
      update: async (id: string, patch: Record<string, unknown>) => {
        const existing = state.agents.get(id);
        if (existing === undefined) {
          throw new Error(`agent ${id} not found`);
        }
        const updated = {
          ...(existing as object),
          ...patch,
          updatedAt: new Date().toISOString(),
        };
        state.agents.set(id, updated);
        return updated;
      },
    },
  };

  return { state, services };
});

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => fake.services,
}));

import * as catalogRoute from '@/app/api/admin/tool-catalog/route';
import * as mcpServerByNameRoute from '@/app/api/agent-definitions/[id]/mcp-servers/[name]/route';

// ---- Fixtures -------------------------------------------------------

const APPSILON: Namespace = {
  handle: 'appsilon',
  type: 'organization',
  displayName: 'Appsilon',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const COWORK_AGENT: AgentDefinition = {
  id: 'echo-tester-agent',
  kind: 'cowork',
  runtimeId: 'chat',
  name: 'Echo Tester',
  iconName: 'Bot',
  description: '',
  foundationModel: realLlmModel,
  systemPrompt: '',
  inputDescription: '',
  outputDescription: '',
  skillFileNames: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const thisDir = dirname(fileURLToPath(import.meta.url));
const ECHO_MCP_PATH = resolve(thisDir, 'servers/echo-mcp.ts');
const TSX_BIN = resolve(thisDir, '../../../../node_modules/.bin/tsx');

function seedBaseline(): void {
  fake.state.namespaces.clear();
  fake.state.catalog.clear();
  fake.state.agents.clear();
  fake.state.namespaces.set(APPSILON.handle, APPSILON);
  fake.state.agents.set(COWORK_AGENT.id, { ...COWORK_AGENT });
}

function jsonRequest(method: string, path: string, body?: unknown): NextRequest {
  const url = new URL(`http://localhost${path}`);
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  return new NextRequest(url.toString(), init);
}

function makeStep(overrides: Partial<WorkflowStep> = {}): WorkflowStep {
  return {
    id: 'step-1',
    name: 'Step 1',
    type: 'creation',
    executor: 'agent',
    agentId: COWORK_AGENT.id,
    ...overrides,
  } as WorkflowStep;
}

// ---- Tests ----------------------------------------------------------
//
// Split into two suites so the cheap sanity (no-LLM) always runs under
// `pnpm test:mcp-real`, catching regressions in the stdio transport,
// echo-mcp script, or McpClientManager wiring without needing an LLM
// API key. The LLM suite layers on top and is skipped without a key.

describe('MCP stdio roundtrip — Tier 2 sanity (no LLM required)', () => {
  let manager: McpClientManager | null = null;

  beforeAll(() => {
    seedBaseline();
  });

  afterAll(async () => {
    if (manager !== null) {
      await manager.disconnect();
      manager = null;
    }
  });

  it('[SANITY] admin-curated echo MCP is reachable end-to-end: resolver → McpClientManager → tool call → result', async () => {
    // Seed catalog + binding via the real REST handlers — same ground
    // truth as the LLM-less Tier 1 tests, just with a different command.
    const createRes = await catalogRoute.POST(
      jsonRequest('POST', '/api/admin/tool-catalog?namespace=appsilon', {
        id: 'echo-mcp',
        command: TSX_BIN,
        args: [ECHO_MCP_PATH],
      }),
    );
    expect(createRes.status).toBe(201);

    const bindRes = await mcpServerByNameRoute.PUT(
      jsonRequest(
        'PUT',
        `/api/agent-definitions/${COWORK_AGENT.id}/mcp-servers/echo`,
        { type: 'stdio', catalogId: 'echo-mcp' },
      ),
      { params: Promise.resolve({ id: COWORK_AGENT.id, name: 'echo' }) },
    );
    expect(bindRes.status).toBe(200);

    const resolved = await resolveMcpForStep(makeStep(), {
      agentDefinitionRepo: fake.services.agentDefinitionRepo,
      toolCatalogRepo: fake.services.toolCatalogRepo,
      namespace: 'appsilon',
    });
    const mcpServers = flattenResolvedMcpToLegacy(resolved);

    manager = new McpClientManager(mcpServers);
    const tools = await manager.connect();
    const echoTool = tools.find((t) => t.function.name === 'echo__echo');
    expect(echoTool).toBeDefined();

    const result = await manager.callTool('echo__echo', { msg: 'hello' });
    expect(result.isError).toBe(false);
    expect(result.content).toBe('Echoed: hello');
  });
});

describe.skipIf(!hasKey)('MCP real-LLM roundtrip — Tier 2 (manual, gated by OPENROUTER_API_KEY)', () => {
  let manager: McpClientManager | null = null;

  beforeAll(() => {
    seedBaseline();
  });

  afterAll(async () => {
    if (manager !== null) {
      await manager.disconnect();
      manager = null;
    }
  });

  it('[REAL LLM] admin-curated echo MCP reaches the model through our resolver, a tool_call is issued, and the result round-trips back', async () => {
    // 1. Admin curates the echo-mcp entry. We point `command` at the tsx
    //    binary and pass the script as the first arg rather than using
    //    the `#!/usr/bin/env tsx` shebang, because the resolver strips
    //    any PATH lookups at the McpServerConfig layer — we want to be
    //    explicit about which binary runs.
    const createRes = await catalogRoute.POST(
      jsonRequest('POST', '/api/admin/tool-catalog?namespace=appsilon', {
        id: 'echo-mcp',
        command: TSX_BIN,
        args: [ECHO_MCP_PATH],
      }),
    );
    expect(createRes.status).toBe(201);

    // 2. Bind it to the cowork agent.
    const bindRes = await mcpServerByNameRoute.PUT(
      jsonRequest(
        'PUT',
        `/api/agent-definitions/${COWORK_AGENT.id}/mcp-servers/echo`,
        { type: 'stdio', catalogId: 'echo-mcp' },
      ),
      { params: Promise.resolve({ id: COWORK_AGENT.id, name: 'echo' }) },
    );
    expect(bindRes.status).toBe(200);

    // 3. Resolver composes catalog + binding into the spawn config.
    const resolved = await resolveMcpForStep(makeStep(), {
      agentDefinitionRepo: fake.services.agentDefinitionRepo,
      toolCatalogRepo: fake.services.toolCatalogRepo,
      namespace: 'appsilon',
    });
    const mcpServers = flattenResolvedMcpToLegacy(resolved);
    expect(mcpServers).toHaveLength(1);
    expect(mcpServers[0].command).toBe(TSX_BIN);

    // 4. McpClientManager spawns the server and discovers its tools.
    manager = new McpClientManager(mcpServers);
    const tools = await manager.connect();
    const echoTool = tools.find((t) => t.function.name === 'echo__echo');
    expect(echoTool).toBeDefined();

    // 5. Real OpenRouter call — prompt designed to deterministically
    //    produce a tool_call. `tool_choice: 'required'` forces the model
    //    to pick a tool, `temperature: 0` removes the remaining wiggle.
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openrouterApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: realLlmModel,
        messages: [
          {
            role: 'user',
            content:
              "You have a tool called echo__echo. Call it exactly once with msg='test123'. Output no other text.",
          },
        ],
        tools,
        tool_choice: 'required',
        temperature: 0,
        max_tokens: 200,
      }),
    });
    expect(response.ok).toBe(true);

    const data = (await response.json()) as {
      choices: Array<{
        message: {
          content: string | null;
          tool_calls?: Array<{
            id: string;
            type: string;
            function: { name: string; arguments: string };
          }>;
        };
      }>;
    };
    const toolCalls = data.choices[0].message.tool_calls;
    expect(toolCalls).toBeDefined();
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls![0].function.name).toBe('echo__echo');

    const args = JSON.parse(toolCalls![0].function.arguments) as { msg: string };
    expect(args.msg).toBe('test123');

    // 6. Roundtrip — call the MCP tool through our manager and assert
    //    the server replied. This is the piece that catches "MCP stdio
    //    transport changed" regressions.
    const toolResult = await manager.callTool('echo__echo', args);
    expect(toolResult.isError).toBe(false);
    expect(toolResult.content).toContain('Echoed: test123');
  });
});
