import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const mockVerifyIdToken = vi.fn();

vi.mock('@mediforce/platform-infra', () => ({
  getAdminAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { POST } from '../route';

function makePostRequest(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new Request('http://localhost/api/tickets', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer valid-token',
      ...headers,
    },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

const validBody = {
  title: 'Something is broken',
  description: '**Steps to reproduce:**\n1. Click here',
  type: 'bug' as const,
  context: [
    { label: 'Page', value: '/workflows/abc' },
  ],
  filedBy: 'Test User',
};

describe('POST /api/tickets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-1' });
    process.env.GITHUB_TOKEN = 'fake-token';
    process.env.GITHUB_REPO = 'appsilon/mediforce';
  });

  it('returns 401 when authorization header is missing', async () => {
    const req = new Request('http://localhost/api/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    }) as unknown as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 401 when token verification fails', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('Invalid token'));
    const res = await POST(makePostRequest(validBody));
    expect(res.status).toBe(401);
  });

  it('returns 400 when title is empty', async () => {
    const res = await POST(makePostRequest({ ...validBody, title: '' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when type is invalid', async () => {
    const res = await POST(makePostRequest({ ...validBody, type: 'rant' }));
    expect(res.status).toBe(400);
  });

  it('returns 503 when GITHUB_TOKEN is missing', async () => {
    delete process.env.GITHUB_TOKEN;
    const res = await POST(makePostRequest(validBody));
    expect(res.status).toBe(503);
  });

  it('posts to GitHub API with correct payload and returns the issue number + url', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ number: 42, html_url: 'https://github.com/appsilon/mediforce/issues/42' }), {
        status: 201,
      }),
    );

    const res = await POST(makePostRequest(validBody));
    expect(res.status).toBe(201);

    const body = (await res.json()) as { number: number; url: string };
    expect(body.number).toBe(42);
    expect(body.url).toBe('https://github.com/appsilon/mediforce/issues/42');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/appsilon/mediforce/issues');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer fake-token');

    const payload = JSON.parse(init.body) as { title: string; body: string; labels: string[] };
    expect(payload.title).toBe('Something is broken');
    expect(payload.labels).toEqual(['bug']);
    expect(payload.body).toContain('**Steps to reproduce:**');
    expect(payload.body).toContain('**Filed by:** Test User');
    expect(payload.body).toContain('**Page:** /workflows/abc');
  });

  it('maps idea type to enhancement label', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ number: 1, html_url: 'https://example.com' }), { status: 201 }),
    );

    await POST(makePostRequest({ ...validBody, type: 'idea' }));
    const [, init] = mockFetch.mock.calls[0];
    const payload = JSON.parse(init.body) as { labels: string[] };
    expect(payload.labels).toEqual(['enhancement']);
  });

  it('returns 502 when GitHub API returns an error', async () => {
    mockFetch.mockResolvedValue(new Response('forbidden', { status: 403 }));

    const res = await POST(makePostRequest(validBody));
    expect(res.status).toBe(502);
  });
});
