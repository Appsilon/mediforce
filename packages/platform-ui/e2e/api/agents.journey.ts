import type { APIRequestContext } from '@playwright/test';
import { test, expect } from '../helpers/test-fixtures';
import {
  apiKeyHeaders,
  sessionCookieHeaders,
  setupMultiNamespaceCallers,
  type MultiNamespaceFixture,
} from '../helpers/multi-namespace';
import { agentStepWorkflow } from '../helpers/agent-step-runs';

/**
 * L3 API E2E for the two migrated agent endpoints:
 *   - GET /api/agents          → list, visibility-filtered per caller
 *   - GET /api/agents/[id]     → single, 404 anti-enum for private
 *
 * The seed has:
 *   - `claude-code-agent` (visibility: public, no namespace)
 *   - `mcp-test-agent`    (private — no explicit visibility, defaults; namespace=test)
 *   - `oauth-test-agent`  (private, namespace=test)
 *
 * The outsider user is not a member of `test`, so they should see only the
 * public agent in the list and 404 on the private ones.
 */

test.describe('GET /api/agents — API E2E', () => {
  let callers: MultiNamespaceFixture;

  test.beforeAll(async () => {
    callers = await setupMultiNamespaceCallers();
  });

  test('list: api-key caller sees every seeded agent', async ({ request }) => {
    const res = await request.get('/api/agents', {
      headers: apiKeyHeaders(),
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json() as { agents: Array<{ id: string }> };
    const ids = body.agents.map((agent) => agent.id);
    expect(ids).toEqual(expect.arrayContaining([
      'claude-code-agent',
      'mcp-test-agent',
      'oauth-test-agent',
    ]));
  });

  test('list: outsider user sees only public agents (not the `test`-private ones)', async ({ request }) => {
    const res = await request.get('/api/agents', {
      headers: sessionCookieHeaders(callers.outsider),
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json() as { agents: Array<{ id: string; visibility?: string }> };
    const ids = body.agents.map((agent) => agent.id);
    expect(ids).toContain('claude-code-agent');
    // Private agents belonging to namespace `test` must be filtered out.
    expect(ids).not.toContain('mcp-test-agent');
    expect(ids).not.toContain('oauth-test-agent');
    expect(body.agents.every((agent) => agent.visibility === 'public')).toBe(true);
  });

  test('list: `?namespace=` filters, it does not grant — outsider still sees no `test` agents', async ({ request }) => {
    // The step editor's agent dropdown passes the workspace it is editing in.
    // That parameter must never widen a caller past its own memberships: an
    // outsider naming `test` gets the same public-only list as with no filter.
    const res = await request.get('/api/agents?namespace=test', {
      headers: sessionCookieHeaders(callers.outsider),
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json() as { agents: Array<{ id: string; visibility?: string }> };
    const ids = body.agents.map((agent) => agent.id);
    expect(ids).not.toContain('mcp-test-agent');
    expect(ids).not.toContain('oauth-test-agent');
    expect(body.agents.every((agent) => agent.visibility === 'public')).toBe(true);
  });

  test('single: outsider user → 404 on a private agent (anti-enum)', async ({ request }) => {
    const res = await request.get('/api/agents/mcp-test-agent', {
      headers: sessionCookieHeaders(callers.outsider),
    });
    expect(res.status()).toBe(404);
  });

  test('single: outsider user → 200 on a public agent', async ({ request }) => {
    const res = await request.get('/api/agents/claude-code-agent', {
      headers: sessionCookieHeaders(callers.outsider),
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json() as { agent: { id: string; visibility?: string } };
    expect(body.agent.id).toBe('claude-code-agent');
    expect(body.agent.visibility).toBe('public');
  });
});

test.describe('POST /api/agents — API E2E', () => {
  test('create: a name, a model and a namespace are enough', async ({ request }) => {
    const res = await request.post('/api/agents', {
      headers: apiKeyHeaders(),
      data: {
        name: `L3 Minimal Agent ${Date.now()}`,
        iconName: 'Bot',
        description: '',
        foundationModel: 'anthropic/claude-sonnet-4',
        systemPrompt: '',
        inputDescription: '',
        outputDescription: '',
        namespace: 'test',
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    const body = await res.json() as { agent: { id: string; namespace?: string } };
    expect(body.agent.namespace).toBe('test');

    const readBack = await request.get(`/api/agents/${body.agent.id}`, {
      headers: apiKeyHeaders(),
    });
    expect(readBack.status(), await readBack.text()).toBe(200);
  });

  test('create: a namespace-less agent is rejected, not half-written', async ({ request }) => {
    // The audit trail is workspace-scoped, so an agent with no namespace used
    // to insert its row and then blow up appending the audit entry — a 500 on
    // top of an orphan agent nobody could see or delete. Reject it up front.
    const res = await request.post('/api/agents', {
      headers: apiKeyHeaders(),
      data: {
        name: `L3 Namespaceless Agent ${Date.now()}`,
        iconName: 'Bot',
        description: '',
        foundationModel: 'anthropic/claude-sonnet-4',
        systemPrompt: '',
        inputDescription: '',
        outputDescription: '',
      },
    });
    expect(res.status(), await res.text()).toBe(400);
  });
});

test.describe('Agent output schema — API E2E', () => {
  const verdictSchema = {
    type: 'object',
    required: ['classification', 'scriptFailedFlag'],
    properties: { classification: { type: 'string' }, scriptFailedFlag: { type: 'boolean' } },
  };

  async function readAgent(request: APIRequestContext, id: string) {
    const res = await request.get(`/api/agents/${id}`, { headers: apiKeyHeaders() });
    expect(res.status(), await res.text()).toBe(200);
    return (await res.json() as { agent: { outputSchema?: unknown } }).agent;
  }

  async function versionNumbers(request: APIRequestContext, id: string) {
    const res = await request.get(`/api/agents/${id}/versions`, { headers: apiKeyHeaders() });
    expect(res.status(), await res.text()).toBe(200);
    return (await res.json() as { versions: Array<{ version: number }> }).versions.map((version) => version.version);
  }

  test('is stored, kept by a patch that omits it, cleared by null, and versions the agent', async ({ request }) => {
    const created = await request.post('/api/agents', {
      headers: apiKeyHeaders(),
      data: {
        name: `L3 Output Schema Agent ${Date.now()}`,
        iconName: 'Bot',
        description: '',
        foundationModel: 'anthropic/claude-sonnet-4',
        systemPrompt: '',
        inputDescription: '',
        outputDescription: '',
        outputSchema: verdictSchema,
        namespace: 'test',
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const { agent } = await created.json() as { agent: { id: string } };
    expect((await readAgent(request, agent.id)).outputSchema).toEqual(verdictSchema);
    expect(await versionNumbers(request, agent.id)).toEqual([1]);

    const renamed = await request.put(`/api/agents/${agent.id}`, {
      headers: apiKeyHeaders(),
      data: { description: 'renamed' },
    });
    expect(renamed.status(), await renamed.text()).toBe(200);
    expect((await readAgent(request, agent.id)).outputSchema).toEqual(verdictSchema);
    expect(await versionNumbers(request, agent.id)).toEqual([1]);

    const cleared = await request.put(`/api/agents/${agent.id}`, {
      headers: apiKeyHeaders(),
      data: { outputSchema: null },
    });
    expect(cleared.status(), await cleared.text()).toBe(200);
    expect((await readAgent(request, agent.id)).outputSchema).toBeUndefined();
    expect(await versionNumbers(request, agent.id)).toEqual([2, 1]);
  });
});

test.describe('An agent\'s image — API E2E', () => {
  async function readImage(request: APIRequestContext, id: string) {
    const res = await request.get(`/api/agents/${id}`, { headers: apiKeyHeaders() });
    expect(res.status(), await res.text()).toBe(200);
    return (await res.json() as { agent: { image?: string } }).agent.image;
  }

  async function savedStepImage(request: APIRequestContext, workflowName: string, agentId: string) {
    const registered = await request.post('/api/workflow-definitions?namespace=test', {
      headers: apiKeyHeaders(),
      data: agentStepWorkflow(workflowName, { autonomyLevel: 'L4', agentId, plugin: 'claude-code-agent' }),
    });
    expect(registered.status(), await registered.text()).toBe(201);
    const { version } = await registered.json() as { version: number };
    const res = await request.get(`/api/workflow-definitions/${workflowName}?namespace=test&version=${version}`, { headers: apiKeyHeaders() });
    expect(res.status(), await res.text()).toBe(200);
    const { definition } = await res.json() as { definition: { steps: Array<{ id: string; agent?: { image?: string } }> } };
    return definition.steps.find((step) => step.id === 'grade-aes')?.agent?.image;
  }

  test('is stored, versions the agent, is given to a step that names none on save, and clears to the golden image', async ({ request }) => {
    const created = await request.post('/api/agents', {
      headers: apiKeyHeaders(),
      data: {
        name: `L3 Image Agent ${Date.now()}`,
        iconName: 'Bot',
        description: '',
        foundationModel: 'anthropic/claude-sonnet-4',
        systemPrompt: '',
        inputDescription: '',
        outputDescription: '',
        runtimeId: 'claude-code-agent',
        image: 'r-tools:2',
        namespace: 'test',
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const { agent } = await created.json() as { agent: { id: string } };
    expect(await readImage(request, agent.id)).toBe('r-tools:2');

    const workflowName = `e2e-agent-image-${agent.id.slice(0, 8)}`;
    expect(await savedStepImage(request, workflowName, agent.id)).toBe('r-tools:2');

    const cleared = await request.put(`/api/agents/${agent.id}`, { headers: apiKeyHeaders(), data: { image: null } });
    expect(cleared.status(), await cleared.text()).toBe(200);
    expect(await readImage(request, agent.id)).toBeUndefined();
    const versions = await request.get(`/api/agents/${agent.id}/versions`, { headers: apiKeyHeaders() });
    const listed = (await versions.json() as { versions: Array<{ version: number; config: { image?: string } }> }).versions;
    expect(listed.map((version) => [version.version, version.config.image])).toEqual([[2, undefined], [1, 'r-tools:2']]);
    expect(await savedStepImage(request, workflowName, agent.id)).toBe('mediforce-golden-image');
  });
});
