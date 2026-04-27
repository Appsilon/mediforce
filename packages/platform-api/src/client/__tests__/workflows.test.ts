import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Mediforce, ApiError } from '../index.js';
import { buildWorkflowDefinition } from '@mediforce/platform-core/testing';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const TEST_BASE_URL = 'http://localhost';

describe('mediforce.workflows.register', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('POSTs JSON body to /api/workflow-definitions with namespace query', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ success: true, name: 'wf', version: 1 }, 201));

    const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
    const wd = buildWorkflowDefinition({ name: 'wf' });
    const { version: _v, namespace: _n, createdAt: _c, ...body } = wd;
    void _v;
    void _n;
    void _c;

    const result = await mediforce.workflows.register(body, { namespace: 'Appsilon' });

    expect(result).toEqual({ success: true, name: 'wf', version: 1 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('http://localhost/api/workflow-definitions?namespace=Appsilon');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
    expect(new Headers(init?.headers).get('X-Api-Key')).toBe('k');
    expect(init?.body).toBe(JSON.stringify(body));
  });

  it('rejects when namespace is empty', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
    const wd = buildWorkflowDefinition();
    const { version: _v, namespace: _n, createdAt: _c, ...body } = wd;
    void _v;
    void _n;
    void _c;

    await expect(
      mediforce.workflows.register(body, { namespace: '' }),
    ).rejects.toThrow(/namespace.*required/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects malformed input before calling fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });

    await expect(
      mediforce.workflows.register(
        // Missing required fields like steps/transitions/triggers.
        { name: 'wf' } as never,
        { namespace: 'Appsilon' },
      ),
    ).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('throws ApiError on non-2xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'Validation failed' }, 400),
    );

    const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
    const wd = buildWorkflowDefinition();
    const { version: _v, namespace: _n, createdAt: _c, ...body } = wd;
    void _v;
    void _n;
    void _c;

    const error = await mediforce.workflows
      .register(body, { namespace: 'Appsilon' })
      .catch((err) => err);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
  });
});

describe('mediforce.workflows.list', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('GETs /api/workflow-definitions and returns the parsed list', async () => {
    const wd = buildWorkflowDefinition({ name: 'wf', version: 2 });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        definitions: [
          {
            name: wd.name,
            latestVersion: 2,
            defaultVersion: 1,
            definition: wd,
          },
        ],
      }),
    );

    const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
    const result = await mediforce.workflows.list();

    expect(result.definitions).toHaveLength(1);
    expect(result.definitions[0]?.name).toBe('wf');
    expect(result.definitions[0]?.latestVersion).toBe(2);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      'http://localhost/api/workflow-definitions',
    );
  });

  it('rejects when the server returns a malformed payload', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ definitions: [{ name: 'wf' /* missing latestVersion */ }] }),
    );

    const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
    await expect(mediforce.workflows.list()).rejects.toThrow();
  });
});
