import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Mediforce, ApiError, type ClientConfig } from '../index.js';
import {
  buildHumanTask,
  buildProcessInstance,
  buildAuditEvent,
  buildCoworkSession,
  buildWorkflowDefinition,
} from '@mediforce/platform-core/testing';
import type { AgentDefinition } from '@mediforce/platform-core';

function buildAgentDefinition(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: 'agent-1',
    kind: 'plugin',
    runtimeId: 'claude-code-agent',
    name: 'Test Agent',
    iconName: 'robot',
    description: 'An agent for testing',
    foundationModel: 'gpt-4',
    systemPrompt: 'You are a test agent',
    inputDescription: 'text',
    outputDescription: 'json',
    skillFileNames: [],
    visibility: 'private',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Tests reach S2S endpoints through `apiKey` — which now requires a
// non-empty baseUrl. A localhost target keeps the construction valid
// without asserting anything meaningful about the URL itself; the
// `apiKey auth` block has the real baseUrl assertion.
const TEST_BASE_URL = 'http://localhost';

describe('Mediforce', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor validation (exactly one of apiKey, bearerToken, fetch)', () => {
    it('throws when empty config is passed (no auth, no custom fetch)', () => {
      expect(
        // @ts-expect-error — no-arg is type-forbidden; runtime guard covers JS callers
        () => new Mediforce(),
      ).toThrow(/exactly one of/i);
    });

    it('throws when two auth sources are provided', () => {
      expect(
        () =>
          // @ts-expect-error — combined auth sources are type-forbidden; runtime guard still catches it
          new Mediforce({ apiKey: 'k', bearerToken: async () => 'tok' }),
      ).toThrow(/exactly one of/i);
    });

    it('throws when apiKey is combined with a custom fetch', () => {
      expect(
        // @ts-expect-error — combined auth sources are type-forbidden; runtime guard still catches it
        () => new Mediforce({ apiKey: 'k', fetch: vi.fn() }),
      ).toThrow(/exactly one of/i);
    });

    it('accepts apiKey with a non-empty baseUrl', () => {
      expect(
        () => new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL }),
      ).not.toThrow();
    });

    it('accepts bearerToken alone', () => {
      expect(() => new Mediforce({ bearerToken: async () => 'tok' })).not.toThrow();
    });

    it('accepts custom fetch alone (tests, retry wrappers, closure-baked auth)', () => {
      expect(() => new Mediforce({ fetch: vi.fn() })).not.toThrow();
    });
  });

  describe('apiKey baseUrl requirement', () => {
    it('throws when apiKey is provided without baseUrl', () => {
      expect(
        // @ts-expect-error — apiKey requires baseUrl at the type level; runtime guard is the backstop
        () => new Mediforce({ apiKey: 'k' }),
      ).toThrow(/apiKey.*baseUrl/i);
    });

    it('throws when apiKey is provided with an empty baseUrl', () => {
      expect(
        () => new Mediforce({ apiKey: 'k', baseUrl: '' }),
      ).toThrow(/apiKey.*baseUrl/i);
    });
  });

  describe('apiKey auth', () => {
    it('attaches X-Api-Key to every request', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse({ tasks: [] }));

      const mediforce = new Mediforce({ apiKey: 'secret', baseUrl: TEST_BASE_URL });
      await mediforce.tasks.list({ instanceId: 'inst-a' });

      const init = fetchSpy.mock.calls[0]?.[1];
      expect(new Headers(init?.headers).get('X-Api-Key')).toBe('secret');
    });

    it('prepends baseUrl to the request path', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse({ tasks: [] }));

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: 'https://mediforce.example.com' });
      await mediforce.tasks.list({ instanceId: 'inst-a' });

      expect(fetchSpy.mock.calls[0]?.[0]).toBe(
        'https://mediforce.example.com/api/tasks?instanceId=inst-a',
      );
    });
  });

  describe('bearerToken auth', () => {
    it('attaches Authorization: Bearer when the token is a string', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse({ tasks: [] }));

      const mediforce = new Mediforce({ bearerToken: async () => 'firebase-id-token' });
      await mediforce.tasks.list({ instanceId: 'inst-a' });

      const init = fetchSpy.mock.calls[0]?.[1];
      expect(new Headers(init?.headers).get('Authorization')).toBe(
        'Bearer firebase-id-token',
      );
    });

    it('omits the header when the token is null (user not signed in)', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse({ tasks: [] }));

      const mediforce = new Mediforce({ bearerToken: async () => null });
      await mediforce.tasks.list({ instanceId: 'inst-a' });

      const init = fetchSpy.mock.calls[0]?.[1];
      expect(new Headers(init?.headers).has('Authorization')).toBe(false);
    });

    it('calls bearerToken on every request (so rotation works)', async () => {
      // Response bodies can only be consumed once — build a fresh one per call.
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async () => jsonResponse({ tasks: [] }));

      const bearerToken = vi
        .fn<() => Promise<string | null>>()
        .mockResolvedValueOnce('token-1')
        .mockResolvedValueOnce('token-2');

      const mediforce = new Mediforce({ bearerToken });
      await mediforce.tasks.list({ instanceId: 'inst-a' });
      await mediforce.tasks.list({ instanceId: 'inst-a' });

      expect(bearerToken).toHaveBeenCalledTimes(2);
      expect(new Headers(fetchSpy.mock.calls[0]?.[1]?.headers).get('Authorization')).toBe(
        'Bearer token-1',
      );
      expect(new Headers(fetchSpy.mock.calls[1]?.[1]?.headers).get('Authorization')).toBe(
        'Bearer token-2',
      );
    });
  });

  describe('fetch injection (loopback / retries / tracing)', () => {
    it('uses the injected fetch instead of globalThis.fetch', async () => {
      const fakeFetch = vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ tasks: [buildHumanTask()] }));
      const globalSpy = vi.spyOn(globalThis, 'fetch');

      const mediforce = new Mediforce({ fetch: fakeFetch });
      const result = await mediforce.tasks.list({ instanceId: 'inst-a' });

      expect(fakeFetch).toHaveBeenCalledTimes(1);
      expect(globalSpy).not.toHaveBeenCalled();
      expect(result.tasks).toHaveLength(1);
    });

    it('does not attach Mediforce auth headers when the caller supplies fetch', async () => {
      // Under the "exactly one" rule, the caller who supplies `fetch` is
      // responsible for auth (baked into the closure or explicitly none).
      const fakeFetch = vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ tasks: [] }));

      const mediforce = new Mediforce({ fetch: fakeFetch });
      await mediforce.tasks.list({ instanceId: 'inst-a' });

      const init = fakeFetch.mock.calls[0]?.[1];
      expect(new Headers(init?.headers).has('X-Api-Key')).toBe(false);
      expect(new Headers(init?.headers).has('Authorization')).toBe(false);
    });
  });

  describe('input validation', () => {
    it('rejects contract violations before firing any request', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      // Both TS (discriminated union for ListTasksInput) and the Zod refine
      // reject an empty input — the call is type-forbidden, and the refine is
      // the runtime backstop for JS callers / bad casts.
      await expect(
        // @ts-expect-error — empty input is type-forbidden under the discriminated union; refine is the runtime backstop
        mediforce.tasks.list({}),
      ).rejects.toThrow(/exactly one of/i);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('output validation', () => {
    it('rejects responses that do not match the output schema', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse({ tasks: [{ id: 'broken' }] }),
      );

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      await expect(mediforce.tasks.list({ instanceId: 'inst-a' })).rejects.toThrow();
    });

    it('accepts a well-formed response', async () => {
      const task = buildHumanTask({ id: 't-out-1' });
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse({ tasks: [task] }),
      );

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      const result = await mediforce.tasks.list({ instanceId: 'inst-a' });

      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].id).toBe('t-out-1');
    });
  });

  describe('ApiError', () => {
    it('throws ApiError with the server-reported message on non-2xx', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse({ error: 'Exactly one of `instanceId` or `role`' }, 400),
      );

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      const error = await mediforce.tasks
        .list({ instanceId: 'inst-a' })
        .catch((err) => err);

      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(400);
      expect((error as ApiError).message).toMatch(/exactly one of/i);
    });

    it('throws ApiError even when the server returns no JSON body', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500 }));

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      const error = await mediforce.tasks
        .list({ instanceId: 'inst-a' })
        .catch((err) => err);

      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(500);
    });
  });

  describe('tasks.get', () => {
    it('calls GET /api/tasks/:taskId with the path-encoded id', async () => {
      const task = buildHumanTask({ id: 'task 1/2' });
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse(task));

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      const result = await mediforce.tasks.get({ taskId: 'task 1/2' });

      expect(result.id).toBe('task 1/2');
      expect(fetchSpy.mock.calls[0]?.[0]).toBe(
        `${TEST_BASE_URL}/api/tasks/task%201%2F2`,
      );
    });

    it('throws ApiError on 404', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse({ error: 'Task missing not found' }, 404),
      );

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      const err = await mediforce.tasks
        .get({ taskId: 'missing' })
        .catch((e) => e);

      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(404);
    });

    it('rejects responses that do not match the output schema', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ id: 'x' }));

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      await expect(mediforce.tasks.get({ taskId: 'task-1' })).rejects.toThrow();
    });
  });

  describe('processes.get', () => {
    it('calls GET /api/processes/:instanceId and parses the instance', async () => {
      const instance = buildProcessInstance({ id: 'inst-a' });
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse(instance));

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      const result = await mediforce.processes.get({ instanceId: 'inst-a' });

      expect(result.id).toBe('inst-a');
      expect(fetchSpy.mock.calls[0]?.[0]).toBe(
        `${TEST_BASE_URL}/api/processes/inst-a`,
      );
    });

    it('URL-encodes the instanceId', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse({ error: 'x' }, 404));

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      await mediforce.processes.get({ instanceId: 'a/b' }).catch(() => undefined);

      expect(fetchSpy.mock.calls[0]?.[0]).toBe(
        `${TEST_BASE_URL}/api/processes/a%2Fb`,
      );
    });

    it('throws ApiError on 404', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse({ error: 'Instance not found' }, 404),
      );

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      const err = await mediforce.processes
        .get({ instanceId: 'missing' })
        .catch((e) => e);

      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(404);
    });
  });

  describe('processes.listAuditEvents', () => {
    it('calls GET /api/processes/:instanceId/audit and parses the envelope', async () => {
      const event = buildAuditEvent({ processInstanceId: 'inst-a' });
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse({ events: [event] }));

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      const result = await mediforce.processes.listAuditEvents({ instanceId: 'inst-a' });

      expect(result.events).toHaveLength(1);
      expect(fetchSpy.mock.calls[0]?.[0]).toBe(
        `${TEST_BASE_URL}/api/processes/inst-a/audit`,
      );
    });

    it('throws ApiError on 404', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse({ error: 'Instance not found' }, 404),
      );

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      const err = await mediforce.processes
        .listAuditEvents({ instanceId: 'missing' })
        .catch((e) => e);

      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(404);
    });

    it('rejects responses that do not match the output schema', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse([]));

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      await expect(
        mediforce.processes.listAuditEvents({ instanceId: 'inst-a' }),
      ).rejects.toThrow();
    });
  });

  describe('processes.getSteps', () => {
    it('calls GET /api/processes/:instanceId/steps and parses the response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse({
          instanceId: 'inst-a',
          definitionName: 'supply-chain-review',
          definitionVersion: '1.0',
          instanceStatus: 'running',
          currentStepId: 'step-intake',
          steps: [],
        }),
      );

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      const result = await mediforce.processes.getSteps({ instanceId: 'inst-a' });

      expect(result.instanceId).toBe('inst-a');
      expect(result.steps).toEqual([]);
      expect(fetchSpy.mock.calls[0]?.[0]).toBe(
        `${TEST_BASE_URL}/api/processes/inst-a/steps`,
      );
    });

    it('throws ApiError on 404', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse({ error: 'Instance not found' }, 404),
      );

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      const err = await mediforce.processes
        .getSteps({ instanceId: 'missing' })
        .catch((e) => e);

      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(404);
    });

    it('rejects responses missing required fields', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse({ steps: [] }),
      );

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      await expect(
        mediforce.processes.getSteps({ instanceId: 'inst-a' }),
      ).rejects.toThrow();
    });
  });

  describe('workflowDefinitions.list', () => {
    it('calls GET /api/workflow-definitions and parses the envelope', async () => {
      const definition = buildWorkflowDefinition();
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse({
          definitions: [
            {
              namespace: 'team-alpha',
              name: 'supply-chain-review',
              latestVersion: 1,
              defaultVersion: 1,
              definition,
            },
          ],
        }),
      );

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      const result = await mediforce.workflowDefinitions.list();

      expect(result.definitions).toHaveLength(1);
      expect(fetchSpy.mock.calls[0]?.[0]).toBe(
        `${TEST_BASE_URL}/api/workflow-definitions`,
      );
    });

    it('serialises namespace into the query string when provided', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse({ definitions: [] }));

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      await mediforce.workflowDefinitions.list({ namespace: 'team-alpha' });

      expect(fetchSpy.mock.calls[0]?.[0]).toBe(
        `${TEST_BASE_URL}/api/workflow-definitions?namespace=team-alpha`,
      );
    });

    it('rejects responses that do not match the output schema', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse([]));

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      await expect(mediforce.workflowDefinitions.list()).rejects.toThrow();
    });
  });

  describe('agentDefinitions.list', () => {
    it('calls GET /api/agent-definitions and parses the envelope', async () => {
      const agent = buildAgentDefinition({ id: 'a-1' });
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse({ agents: [agent] }));

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      const result = await mediforce.agentDefinitions.list();

      expect(result.agents).toHaveLength(1);
      expect(result.agents[0].id).toBe('a-1');
      expect(fetchSpy.mock.calls[0]?.[0]).toBe(
        `${TEST_BASE_URL}/api/agent-definitions`,
      );
    });

    it('throws ApiError on non-2xx', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse({ error: 'forbidden' }, 403),
      );

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      const err = await mediforce.agentDefinitions.list().catch((e) => e);

      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(403);
    });

    it('rejects responses that do not match the output schema', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse([]));

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      await expect(mediforce.agentDefinitions.list()).rejects.toThrow();
    });
  });

  describe('agentDefinitions.get', () => {
    it('calls GET /api/agent-definitions/:id and parses the envelope', async () => {
      const agent = buildAgentDefinition({ id: 'a-1' });
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse({ agent }));

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      const result = await mediforce.agentDefinitions.get({ id: 'a-1' });

      expect(result.agent.id).toBe('a-1');
      expect(fetchSpy.mock.calls[0]?.[0]).toBe(
        `${TEST_BASE_URL}/api/agent-definitions/a-1`,
      );
    });

    it('URL-encodes the id', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse({ error: 'x' }, 404));

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      await mediforce.agentDefinitions.get({ id: 'a/b' }).catch(() => undefined);

      expect(fetchSpy.mock.calls[0]?.[0]).toBe(
        `${TEST_BASE_URL}/api/agent-definitions/a%2Fb`,
      );
    });

    it('throws ApiError on 404', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse({ error: 'Agent not found' }, 404),
      );

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      const err = await mediforce.agentDefinitions
        .get({ id: 'missing' })
        .catch((e) => e);

      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(404);
    });
  });

  describe('cowork.get', () => {
    it('calls GET /api/cowork/:sessionId and parses the session', async () => {
      const session = buildCoworkSession({ id: 'sess-1' });
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse(session));

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      const result = await mediforce.cowork.get({ sessionId: 'sess-1' });

      expect(result.id).toBe('sess-1');
      expect(fetchSpy.mock.calls[0]?.[0]).toBe(
        `${TEST_BASE_URL}/api/cowork/sess-1`,
      );
    });

    it('URL-encodes the sessionId', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse({ error: 'x' }, 404));

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      await mediforce.cowork.get({ sessionId: 'a/b' }).catch(() => undefined);

      expect(fetchSpy.mock.calls[0]?.[0]).toBe(
        `${TEST_BASE_URL}/api/cowork/a%2Fb`,
      );
    });

    it('throws ApiError on 404', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse({ error: 'Session not found' }, 404),
      );

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      const err = await mediforce.cowork
        .get({ sessionId: 'missing' })
        .catch((e) => e);

      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(404);
    });
  });

  describe('cowork.getByInstance', () => {
    it('calls GET /api/cowork/by-instance/:instanceId and parses the session', async () => {
      const session = buildCoworkSession({ processInstanceId: 'inst-a' });
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse(session));

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      const result = await mediforce.cowork.getByInstance({ instanceId: 'inst-a' });

      expect(result.processInstanceId).toBe('inst-a');
      expect(fetchSpy.mock.calls[0]?.[0]).toBe(
        `${TEST_BASE_URL}/api/cowork/by-instance/inst-a`,
      );
    });

    it('throws ApiError on 404', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse({ error: 'No active cowork session' }, 404),
      );

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      const err = await mediforce.cowork
        .getByInstance({ instanceId: 'inst-a' })
        .catch((e) => e);

      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(404);
    });

    it('rejects an empty instanceId before firing any request', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      await expect(
        mediforce.cowork.getByInstance({ instanceId: '' }),
      ).rejects.toThrow();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('plugins.list', () => {
    it('calls GET /api/plugins and parses the envelope', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse({
          plugins: [
            { name: 'claude-code-agent' },
            { name: 'opencode-agent' },
          ],
        }),
      );

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      const result = await mediforce.plugins.list();

      expect(result.plugins).toHaveLength(2);
      expect(result.plugins[0].name).toBe('claude-code-agent');
      expect(fetchSpy.mock.calls[0]?.[0]).toBe(`${TEST_BASE_URL}/api/plugins`);
    });

    it('throws ApiError on non-2xx', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse({ error: 'forbidden' }, 403),
      );

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      const err = await mediforce.plugins.list().catch((e) => e);

      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(403);
    });

    it('rejects responses that do not match the output schema', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse({ plugins: [{}] }), // missing `name`
      );

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      await expect(mediforce.plugins.list()).rejects.toThrow();
    });
  });
});

// Type-level assertion — ClientConfig accepts only the documented options.
const _configShape: ClientConfig = {
  baseUrl: 'https://mediforce.example.com',
  apiKey: 'x',
};
void _configShape;
