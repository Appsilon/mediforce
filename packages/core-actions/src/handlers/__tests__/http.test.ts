import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { httpActionHandler } from '../http.js';
import type { ActionContext } from '../../types.js';

const baseCtx: ActionContext = {
  stepId: 'echo',
  processInstanceId: 'inst-1',
  sources: {
    triggerPayload: { body: { hello: 'filip' }, method: 'POST' },
    steps: {},
    variables: {},
  },
};

describe('httpActionHandler', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('sends an interpolated POST body and returns parsed JSON', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, echo: { hello: 'filip' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const out = await httpActionHandler(
      {
        method: 'POST',
        url: 'http://localhost:9099/anything',
        body: '${triggerPayload.body}',
      },
      baseCtx,
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchSpy.mock.calls[0];
    expect(calledUrl).toBe('http://localhost:9099/anything');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ hello: 'filip' }));
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');

    expect(out.status).toBe(200);
    expect(out.method).toBe('POST');
    expect(out.url).toBe('http://localhost:9099/anything');
    expect(out.body).toEqual({
      json: { ok: true, echo: { hello: 'filip' } },
      text: JSON.stringify({ ok: true, echo: { hello: 'filip' } }),
    });
  });

  it('handles GET (no body)', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('{"data":1}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    await httpActionHandler({ method: 'GET', url: 'http://x/y' }, baseCtx);
    const [, init] = fetchSpy.mock.calls[0];
    expect(init?.method).toBe('GET');
    expect(init?.body).toBeUndefined();
  });

  it('returns non-2xx responses without throwing', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('upstream broke', { status: 502 }),
    );
    const out = await httpActionHandler({ method: 'GET', url: 'http://x' }, baseCtx);
    expect(out.status).toBe(502);
    expect(out.body).toEqual({ json: null, text: 'upstream broke' });
  });

  it('passes a string body as-is when configured as string (no JSON wrap)', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('ok', { status: 200 }));
    await httpActionHandler(
      { method: 'POST', url: 'http://x', body: 'plain text' },
      baseCtx,
    );
    const [, init] = fetchSpy.mock.calls[0];
    expect(init?.body).toBe('plain text');
    // No automatic Content-Type for strings — caller can set it via headers.
    expect(init?.headers).toEqual({});
  });

  it('interpolates url and headers', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const ctx: ActionContext = {
      ...baseCtx,
      sources: {
        triggerPayload: { host: 'example.com', token: 'abc' },
        steps: {},
        variables: {},
      },
    };
    await httpActionHandler(
      {
        method: 'GET',
        url: 'https://${triggerPayload.host}/api',
        headers: { Authorization: 'Bearer ${triggerPayload.token}' },
      },
      ctx,
    );
    const [calledUrl, init] = fetchSpy.mock.calls[0];
    expect(calledUrl).toBe('https://example.com/api');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer abc');
  });

  it('throws on transport errors', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(
      httpActionHandler({ method: 'GET', url: 'http://nope' }, baseCtx),
    ).rejects.toThrow('ECONNREFUSED');
  });
});
