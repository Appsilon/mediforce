import { describe, it, expect } from 'vitest';
import { noopRunKicker, createHttpSelfFetchRunKicker } from '../run-kicker';

describe('noopRunKicker', () => {
  it('records each call on `kicks`', async () => {
    const kicker = noopRunKicker();

    await kicker.kick('inst-1');
    await kicker.kick('inst-2', { triggeredBy: 'alice' });

    expect(kicker.kicks).toEqual([
      { instanceId: 'inst-1', triggeredBy: undefined },
      { instanceId: 'inst-2', triggeredBy: 'alice' },
    ]);
  });

  it('resolves to undefined (fire-and-forget)', async () => {
    const kicker = noopRunKicker();
    await expect(kicker.kick('inst-1')).resolves.toBeUndefined();
  });
});

describe('createHttpSelfFetchRunKicker', () => {
  it('POSTs to /api/processes/:id/run with X-Api-Key + JSON body', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('{}', { status: 202 });
    }) as unknown as typeof fetch;

    const kicker = createHttpSelfFetchRunKicker({
      baseUrl: () => 'http://test.example',
      apiKey: () => 'secret-key',
      fetch: fakeFetch,
    });

    await kicker.kick('inst-abc', { triggeredBy: 'bob' });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://test.example/api/processes/inst-abc/run');
    expect(calls[0].init.method).toBe('POST');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['X-Api-Key']).toBe('secret-key');
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ triggeredBy: 'bob' });
  });

  it('defaults triggeredBy to "api-user" when not supplied', async () => {
    let capturedBody: string | undefined;
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      capturedBody = init.body as string;
      return new Response('{}', { status: 202 });
    }) as unknown as typeof fetch;

    const kicker = createHttpSelfFetchRunKicker({
      baseUrl: () => 'http://test.example',
      apiKey: () => 'k',
      fetch: fakeFetch,
    });

    await kicker.kick('inst-1');

    expect(JSON.parse(capturedBody ?? '{}').triggeredBy).toBe('api-user');
  });

  it('swallows fetch errors (fire-and-forget)', async () => {
    const fakeFetch = (async () => {
      throw new Error('connection refused');
    }) as unknown as typeof fetch;

    const kicker = createHttpSelfFetchRunKicker({
      baseUrl: () => 'http://test.example',
      apiKey: () => 'k',
      fetch: fakeFetch,
    });

    await expect(kicker.kick('inst-1')).resolves.toBeUndefined();
  });

  it('URL-encodes the instanceId', async () => {
    let capturedUrl: string | undefined;
    const fakeFetch = (async (url: string) => {
      capturedUrl = url;
      return new Response('{}', { status: 202 });
    }) as unknown as typeof fetch;

    const kicker = createHttpSelfFetchRunKicker({
      baseUrl: () => 'http://test.example',
      apiKey: () => 'k',
      fetch: fakeFetch,
    });

    await kicker.kick('inst with spaces');

    expect(capturedUrl).toBe('http://test.example/api/processes/inst%20with%20spaces/run');
  });

  it('re-reads baseUrl and apiKey on each call', async () => {
    const urls: string[] = [];
    const fakeFetch = (async (url: string) => {
      urls.push(url);
      return new Response('{}', { status: 202 });
    }) as unknown as typeof fetch;

    let url = 'http://a';
    const kicker = createHttpSelfFetchRunKicker({
      baseUrl: () => url,
      apiKey: () => 'k',
      fetch: fakeFetch,
    });

    await kicker.kick('inst-1');
    url = 'http://b';
    await kicker.kick('inst-1');

    expect(urls).toEqual([
      'http://a/api/processes/inst-1/run',
      'http://b/api/processes/inst-1/run',
    ]);
  });
});
