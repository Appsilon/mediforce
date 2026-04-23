import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Mediforce, ApiError, type ClientConfig } from '../index.js';
import {
  buildCoworkSession,
  buildHumanTask,
  buildProcessConfig,
} from '@mediforce/platform-core/testing';
import type { PluginCapabilityMetadata } from '@mediforce/platform-core';

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
    it('calls GET /api/tasks/:taskId and returns the parsed task', async () => {
      const task = buildHumanTask({ id: 'task-42' });
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse(task));

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      const result = await mediforce.tasks.get({ taskId: 'task-42' });

      expect(result.id).toBe('task-42');
      expect(fetchSpy.mock.calls[0]?.[0]).toBe(
        `${TEST_BASE_URL}/api/tasks/task-42`,
      );
    });

    it('URL-encodes the taskId path segment', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse(buildHumanTask({ id: 'a/b c' })));

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      await mediforce.tasks.get({ taskId: 'a/b c' });

      expect(fetchSpy.mock.calls[0]?.[0]).toBe(
        `${TEST_BASE_URL}/api/tasks/a%2Fb%20c`,
      );
    });

    it('throws ApiError on 404 with the server message', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse({ error: 'Task missing-1 not found' }, 404),
      );

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      const err = await mediforce.tasks
        .get({ taskId: 'missing-1' })
        .catch((e) => e);

      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(404);
      expect((err as ApiError).message).toMatch(/missing-1/);
    });

    it('rejects an empty taskId before firing any request', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      await expect(mediforce.tasks.get({ taskId: '' })).rejects.toThrow();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('rejects responses that do not match the output schema', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse({ id: 'task-42' }),
      );

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      await expect(mediforce.tasks.get({ taskId: 'task-42' })).rejects.toThrow();
    });
  });

  describe('cowork.get', () => {
    it('calls GET /api/cowork/:sessionId and returns the parsed session', async () => {
      const session = buildCoworkSession({ id: 'sess-42' });
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse(session));

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      const result = await mediforce.cowork.get({ sessionId: 'sess-42' });

      expect(result.id).toBe('sess-42');
      expect(fetchSpy.mock.calls[0]?.[0]).toBe(
        `${TEST_BASE_URL}/api/cowork/sess-42`,
      );
    });

    it('URL-encodes the sessionId path segment', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse(buildCoworkSession({ id: 'a/b' })));

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      await mediforce.cowork.get({ sessionId: 'a/b' });

      expect(fetchSpy.mock.calls[0]?.[0]).toBe(
        `${TEST_BASE_URL}/api/cowork/a%2Fb`,
      );
    });

    it('throws ApiError on 404 with the server message', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse({ error: 'Cowork session missing not found' }, 404),
      );

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      const err = await mediforce.cowork
        .get({ sessionId: 'missing' })
        .catch((e) => e);

      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(404);
    });

    it('rejects an empty sessionId before firing any request', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      await expect(mediforce.cowork.get({ sessionId: '' })).rejects.toThrow();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('cowork.getByInstance', () => {
    it('calls GET /api/cowork/by-instance/:instanceId and returns the parsed session', async () => {
      const session = buildCoworkSession({ processInstanceId: 'inst-a', status: 'active' });
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

    it('throws ApiError on 404 with the server message', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse({ error: "No active cowork session found for instance 'inst-a'" }, 404),
      );

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      const err = await mediforce.cowork
        .getByInstance({ instanceId: 'inst-a' })
        .catch((e) => e);

      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(404);
    });
  });

  describe('configs.list', () => {
    it('serialises processName into the query string', async () => {
      const config = buildProcessConfig({ processName: 'supply-chain-review' });
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse({ configs: [config] }));

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      const result = await mediforce.configs.list({ processName: 'supply-chain-review' });

      expect(result.configs).toHaveLength(1);
      expect(fetchSpy.mock.calls[0]?.[0]).toBe(
        `${TEST_BASE_URL}/api/configs?processName=supply-chain-review`,
      );
    });

    it('rejects an empty processName before firing any request', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      await expect(mediforce.configs.list({ processName: '' })).rejects.toThrow();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('parses the response envelope', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ configs: [] }));

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      const result = await mediforce.configs.list({ processName: 'p-empty' });

      expect(result.configs).toEqual([]);
    });
  });

  describe('plugins.list', () => {
    const metadata: PluginCapabilityMetadata = {
      name: 'claude-code-agent',
      description: 'Runs Claude Code against a workspace',
      inputDescription: 'Repository path + task prompt',
      outputDescription: 'Artifact diff + audit log',
      roles: ['executor'],
    };

    it('calls GET /api/plugins and parses the envelope', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse({
          plugins: [
            { name: 'claude-code-agent', metadata },
            { name: 'opencode-agent' },
          ],
        }),
      );

      const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
      const result = await mediforce.plugins.list();

      expect(result.plugins).toHaveLength(2);
      expect(result.plugins[0].name).toBe('claude-code-agent');
      expect(result.plugins[0].metadata).toEqual(metadata);
      expect(fetchSpy.mock.calls[0]?.[0]).toBe(`${TEST_BASE_URL}/api/plugins`);
    });

    it('rejects responses that do not match the output schema', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse({ plugins: [{ metadata }] }), // missing `name`
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
