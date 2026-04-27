import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Mediforce, ApiError } from '../index.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const TEST_BASE_URL = 'http://localhost';

/**
 * NOTE: GET /api/runs/<runId> ships on the n8n-migrator branch and is not
 * yet on `main`. Tests run against a fetch loopback only; smoke against a
 * live server unblocks once the endpoint merges.
 */

describe('mediforce.runs.get', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('GETs /api/runs/<runId> and validates the response', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        runId: 'run-123',
        status: 'completed',
        currentStepId: 'final',
        error: null,
        finalOutput: { ok: true },
      }),
    );

    const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
    const result = await mediforce.runs.get({ runId: 'run-123' });

    expect(result.runId).toBe('run-123');
    expect(result.status).toBe('completed');
    expect(result.finalOutput).toEqual({ ok: true });
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('http://localhost/api/runs/run-123');
  });

  it('URL-encodes runIds with reserved characters', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        runId: 'a/b c',
        status: 'running',
        currentStepId: null,
        error: null,
        finalOutput: null,
      }),
    );

    const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
    await mediforce.runs.get({ runId: 'a/b c' });

    expect(fetchSpy.mock.calls[0]?.[0]).toBe('http://localhost/api/runs/a%2Fb%20c');
  });

  it('rejects an empty runId before firing a request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });

    await expect(mediforce.runs.get({ runId: '' })).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('throws ApiError on 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'Run not found' }, 404),
    );

    const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
    const error = await mediforce.runs.get({ runId: 'nope' }).catch((err) => err);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(404);
  });
});
