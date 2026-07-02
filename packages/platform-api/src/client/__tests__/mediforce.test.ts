import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Mediforce, ApiError, type ClientConfig } from '../index';
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
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse({ tasks: [] }));

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      // Empty input is the caller-scope axis (GitHub-like default) — fires.
      await mediforce.tasks.list({});
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Mutual-exclusion is the remaining refine: instanceId + role together
      // is rejected before the request is fired.
      await expect(
        // @ts-expect-error — both axes set is type-forbidden under the discriminated union; refine is the runtime backstop
        mediforce.tasks.list({ instanceId: 'inst-a', role: 'reviewer' }),
      ).rejects.toThrow(/mutually exclusive/i);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
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

  // ---- Per-method contracts (table-driven) ----
  //
  // For methods whose contract reduces to (build URL → parse 200 → ApiError on 4xx),
  // a single table-driven helper covers happy-path URL/parse + ApiError on 404.
  // Methods with non-trivial input encoding (query strings, repeated params) keep
  // their verbose tests below.

  type MethodContract = {
    name: string;
    call: (client: Mediforce) => Promise<unknown>;
    expectedUrl: string;
    fixture: unknown;
    parsedField: (result: unknown) => unknown;
    parsedExpected: unknown;
  };

  const methodContracts: MethodContract[] = [
    {
      name: 'processes.get',
      call: (c) => c.processes.get({ instanceId: 'inst-a' }),
      expectedUrl: `${TEST_BASE_URL}/api/processes/inst-a`,
      fixture: buildProcessInstance({ id: 'inst-a' }),
      parsedField: (r) => (r as { id: string }).id,
      parsedExpected: 'inst-a',
    },
    {
      name: 'processes.listAuditEvents',
      call: (c) => c.processes.listAuditEvents({ instanceId: 'inst-a' }),
      expectedUrl: `${TEST_BASE_URL}/api/processes/inst-a/audit`,
      fixture: { events: [buildAuditEvent({ processInstanceId: 'inst-a' })] },
      parsedField: (r) => (r as { events: unknown[] }).events.length,
      parsedExpected: 1,
    },
    {
      name: 'processes.getSteps',
      call: (c) => c.processes.getSteps({ instanceId: 'inst-a' }),
      expectedUrl: `${TEST_BASE_URL}/api/processes/inst-a/steps`,
      fixture: {
        instanceId: 'inst-a',
        definitionName: 'supply-chain-review',
        definitionVersion: '1.0',
        instanceStatus: 'running',
        currentStepId: 'step-intake',
        steps: [],
      },
      parsedField: (r) => (r as { instanceId: string }).instanceId,
      parsedExpected: 'inst-a',
    },
    {
      name: 'workflows.list',
      call: (c) => c.workflows.list(),
      expectedUrl: `${TEST_BASE_URL}/api/workflow-definitions`,
      fixture: {
        definitions: [
          {
            namespace: 'team-alpha',
            name: 'supply-chain-review',
            latestVersion: 1,
            defaultVersion: 1,
            definition: buildWorkflowDefinition(),
            runSummary: { total: 0, active: 0, latest: [] },
          },
        ],
      },
      parsedField: (r) => (r as { definitions: unknown[] }).definitions.length,
      parsedExpected: 1,
    },
    {
      name: 'agents.list',
      call: (c) => c.agents.list(),
      expectedUrl: `${TEST_BASE_URL}/api/agents`,
      fixture: { agents: [buildAgentDefinition({ id: 'a-1' })] },
      parsedField: (r) => (r as { agents: { id: string }[] }).agents[0].id,
      parsedExpected: 'a-1',
    },
    {
      name: 'agents.get',
      call: (c) => c.agents.get({ id: 'a-1' }),
      expectedUrl: `${TEST_BASE_URL}/api/agents/a-1`,
      fixture: { agent: buildAgentDefinition({ id: 'a-1' }) },
      parsedField: (r) => (r as { agent: { id: string } }).agent.id,
      parsedExpected: 'a-1',
    },
    {
      name: 'cowork.get',
      call: (c) => c.cowork.get({ sessionId: 'sess-1' }),
      expectedUrl: `${TEST_BASE_URL}/api/cowork/sess-1`,
      fixture: buildCoworkSession({ id: 'sess-1' }),
      parsedField: (r) => (r as { id: string }).id,
      parsedExpected: 'sess-1',
    },
    {
      name: 'cowork.getByInstance',
      call: (c) => c.cowork.getByInstance({ instanceId: 'inst-a' }),
      expectedUrl: `${TEST_BASE_URL}/api/cowork/by-instance/inst-a`,
      fixture: buildCoworkSession({ processInstanceId: 'inst-a' }),
      parsedField: (r) => (r as { processInstanceId: string }).processInstanceId,
      parsedExpected: 'inst-a',
    },
    {
      name: 'plugins.list',
      call: (c) => c.plugins.list(),
      expectedUrl: `${TEST_BASE_URL}/api/plugins`,
      fixture: { plugins: [{ name: 'claude-code-agent' }, { name: 'opencode-agent' }] },
      parsedField: (r) => (r as { plugins: unknown[] }).plugins.length,
      parsedExpected: 2,
    },
    {
      name: 'tasks.get',
      call: (c) => c.tasks.get({ taskId: 'task-1' }),
      expectedUrl: `${TEST_BASE_URL}/api/tasks/task-1`,
      fixture: buildHumanTask({ id: 'task-1' }),
      parsedField: (r) => (r as { id: string }).id,
      parsedExpected: 'task-1',
    },
  ];

  describe.each(methodContracts)('$name', (contract) => {
    it('builds URL + parses 200 response', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse(contract.fixture));

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      const result = await contract.call(mediforce);

      expect(contract.parsedField(result)).toEqual(contract.parsedExpected);
      expect(fetchSpy.mock.calls[0]?.[0]).toBe(contract.expectedUrl);
    });

    it('throws ApiError on 404 with parsed body', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse({ error: 'Not found' }, 404),
      );

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      const err = await contract.call(mediforce).catch((e) => e);

      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(404);
    });
  });

  // ---- Methods with non-trivial input encoding (kept verbose) ----

  describe('tasks.get (path encoding)', () => {
    it('URL-encodes the taskId path segment', async () => {
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
  });

  describe('workflows.get (version + namespace query)', () => {
    it('calls GET /api/workflow-definitions/:name and parses the envelope', async () => {
      const definition = buildWorkflowDefinition({ name: 'flow-a' });
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse({ definition }));

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      const result = await mediforce.workflows.get({ name: 'flow-a' });

      expect(result.definition.name).toBe('flow-a');
      expect(fetchSpy.mock.calls[0]?.[0]).toBe(
        `${TEST_BASE_URL}/api/workflow-definitions/flow-a`,
      );
    });

    it('serialises version and namespace into the query string', async () => {
      const definition = buildWorkflowDefinition({ name: 'flow-a', version: 2 });
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse({ definition }));

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      await mediforce.workflows.get({
        name: 'flow-a',
        version: 2,
        namespace: 'team-alpha',
      });

      expect(fetchSpy.mock.calls[0]?.[0]).toBe(
        `${TEST_BASE_URL}/api/workflow-definitions/flow-a?version=2&namespace=team-alpha`,
      );
    });

    it('URL-encodes the name', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse({ error: 'x' }, 404));

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      await mediforce.workflows
        .get({ name: 'flow/a' })
        .catch(() => undefined);

      expect(fetchSpy.mock.calls[0]?.[0]).toBe(
        `${TEST_BASE_URL}/api/workflow-definitions/flow%2Fa`,
      );
    });

    it('throws ApiError on 404', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse({ error: 'Workflow not found' }, 404),
      );

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      const err = await mediforce.workflows
        .get({ name: 'missing' })
        .catch((e) => e);

      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(404);
    });
  });

  describe('workflows.list (namespace query)', () => {
    it('serialises namespace into the query string when provided', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse({ definitions: [] }));

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      await mediforce.workflows.list({ namespace: 'team-alpha' });

      expect(fetchSpy.mock.calls[0]?.[0]).toBe(
        `${TEST_BASE_URL}/api/workflow-definitions?namespace=team-alpha`,
      );
    });
  });

  describe('cowork.getByInstance (input refine)', () => {
    it('rejects an empty instanceId before firing any request', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      await expect(
        mediforce.cowork.getByInstance({ instanceId: '' }),
      ).rejects.toThrow();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('tasks.claim', () => {
    it('POSTs to /api/tasks/:taskId/claim and parses the entity envelope', async () => {
      const task = buildHumanTask({
        id: 'task-1',
        status: 'claimed',
        assignedUserId: 'u-1',
      });
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse({ task }));

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      const result = await mediforce.tasks.claim({ taskId: 'task-1' });

      expect(result.task.id).toBe('task-1');
      expect(result.task.status).toBe('claimed');
      expect(fetchSpy.mock.calls[0]?.[0]).toBe(`${TEST_BASE_URL}/api/tasks/task-1/claim`);
      expect(fetchSpy.mock.calls[0]?.[1]?.method).toBe('POST');
    });

    it('URL-encodes the taskId path segment', async () => {
      const task = buildHumanTask({ id: 'task 1/2', status: 'claimed', assignedUserId: 'u-1' });
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse({ task }));

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      await mediforce.tasks.claim({ taskId: 'task 1/2' });

      expect(fetchSpy.mock.calls[0]?.[0]).toBe(
        `${TEST_BASE_URL}/api/tasks/task%201%2F2/claim`,
      );
    });

    it('rejects an empty taskId before firing any request', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      await expect(mediforce.tasks.claim({ taskId: '' })).rejects.toThrow();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('throws ApiError with envelope code/message/details on a typed 409', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse(
          {
            error: {
              code: 'precondition_failed',
              message: 'Cannot claim a claimed task',
              details: { taskId: 'task-1', currentStatus: 'claimed' },
            },
          },
          409,
        ),
      );

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      const err = (await mediforce.tasks
        .claim({ taskId: 'task-1' })
        .catch((e) => e)) as ApiError;

      expect(err).toBeInstanceOf(ApiError);
      expect(err.status).toBe(409);
      expect(err.message).toBe('Cannot claim a claimed task');
      expect(err.code).toBe('precondition_failed');
      expect(err.details).toEqual({ taskId: 'task-1', currentStatus: 'claimed' });
    });
  });

  describe('runs.cancel', () => {
    it('POSTs to /api/processes/:instanceId/cancel and parses the entity envelope', async () => {
      const run = buildProcessInstance({ id: 'inst-a', status: 'failed', error: 'Cancelled by user' });
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse({ run }));

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      const result = await mediforce.runs.cancel({ runId: 'inst-a' });

      expect(result.run.id).toBe('inst-a');
      expect(result.run.status).toBe('failed');
      expect(fetchSpy.mock.calls[0]?.[0]).toBe(`${TEST_BASE_URL}/api/processes/inst-a/cancel`);
      expect(fetchSpy.mock.calls[0]?.[1]?.method).toBe('POST');
    });

    it('forwards the reason in the request body when provided', async () => {
      const run = buildProcessInstance({ id: 'inst-a', status: 'failed', error: 'Audit cleanup' });
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse({ run }));

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      await mediforce.runs.cancel({ runId: 'inst-a', reason: 'Audit cleanup' });

      expect(fetchSpy.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ reason: 'Audit cleanup' }));
    });

    it('rejects an empty runId before firing any request', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      await expect(mediforce.runs.cancel({ runId: '' })).rejects.toThrow();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('runs.start', () => {
    it('POSTs the validated body as JSON to /api/processes', async () => {
      const run = buildProcessInstance({ id: 'inst-a', status: 'running' });
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse({ run }));

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      const result = await mediforce.runs.start({
        definitionName: 'def-1',
        triggeredBy: 'user-1',
      });

      expect(result.run.id).toBe('inst-a');
      expect(fetchSpy.mock.calls[0]?.[0]).toBe(`${TEST_BASE_URL}/api/processes`);
      const init = fetchSpy.mock.calls[0]?.[1];
      expect(init?.method).toBe('POST');
      // Body-bearing mutations serialize the payload and tag it as JSON.
      expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
      const body = init?.body !== undefined ? JSON.parse(String(init.body)) : {};
      expect(body.definitionName).toBe('def-1');
      expect(body.triggeredBy).toBe('user-1');
    });
  });

  describe('cron.heartbeat', () => {
    it('POSTs to /api/cron/heartbeat with no body or content-type', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse({ triggered: [], skipped: [] }));

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      const result = await mediforce.cron.heartbeat();

      expect(result.triggered).toEqual([]);
      expect(fetchSpy.mock.calls[0]?.[0]).toBe(`${TEST_BASE_URL}/api/cron/heartbeat`);
      const init = fetchSpy.mock.calls[0]?.[1];
      // No-body mutations must not attach a Content-Type header or a body —
      // the `sendJson` helper skips both when `body` is `undefined`.
      expect(init?.method).toBe('POST');
      expect(init?.body).toBeUndefined();
      expect(new Headers(init?.headers).get('content-type')).toBeNull();
    });
  });

  describe('error envelope back-compat (legacy `{ error: string }`)', () => {
    it('extracts the message from the legacy string envelope', async () => {
      // Some Phase 1 routes still throw plain HandlerError with a custom
      // shape, and the legacy 5xx surface (`{ error: <string> }`) hasn't
      // been migrated. The client must tolerate both shapes during the
      // transition.
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse({ error: 'Legacy failure mode' }, 500),
      );

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      const err = (await mediforce.tasks
        .list({ instanceId: 'inst-a' })
        .catch((e) => e)) as ApiError;

      expect(err).toBeInstanceOf(ApiError);
      expect(err.status).toBe(500);
      expect(err.message).toBe('Legacy failure mode');
      expect(err.code).toBeUndefined();
    });
  });
});

// Type-level assertion — ClientConfig accepts only the documented options.
const _configShape: ClientConfig = {
  baseUrl: 'https://mediforce.example.com',
  apiKey: 'x',
};
void _configShape;
