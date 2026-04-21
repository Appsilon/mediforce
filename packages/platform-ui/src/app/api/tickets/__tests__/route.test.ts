import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const mockVerifyIdToken = vi.fn();

vi.mock('@mediforce/platform-infra', () => ({
  getAdminAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { POST, __resetRateLimitsForTests } from '../route';

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
};

describe('POST /api/tickets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitsForTests();
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', name: 'Test User', email: 'test@example.com' });
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

  it('derives filedBy from verified token, ignoring any filedBy in the body', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ number: 1, html_url: 'https://example.com' }), { status: 201 }),
    );

    await POST(makePostRequest({ ...validBody, filedBy: 'CEO' }));
    const [, init] = mockFetch.mock.calls[0];
    const payload = JSON.parse(init.body) as { body: string };
    expect(payload.body).toContain('**Filed by:** Test User');
    expect(payload.body).not.toContain('CEO');
  });

  it('falls back to email then uid when token has no name', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-2', email: 'only-email@example.com' });
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ number: 1, html_url: 'https://example.com' }), { status: 201 }),
    );

    await POST(makePostRequest(validBody));
    const [, init] = mockFetch.mock.calls[0];
    const payload = JSON.parse(init.body) as { body: string };
    expect(payload.body).toContain('**Filed by:** only-email@example.com');
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

  it('returns 500 with a generic message (no internal details) on unexpected failure', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED to internal-proxy.corp:8080'));

    const res = await POST(makePostRequest(validBody));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Failed to create ticket');
    expect(body.error).not.toContain('ECONNREFUSED');
    expect(body.error).not.toContain('internal-proxy');
  });

  describe('rate limiting', () => {
    beforeEach(() => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ number: 1, html_url: 'https://example.com' }), { status: 201 }),
        ),
      );
    });

    it('allows up to 50 tickets per day for a single user', async () => {
      mockVerifyIdToken.mockResolvedValue({ uid: 'burst-user', name: 'Burst' });

      for (let count = 0; count < 50; count += 1) {
        const res = await POST(makePostRequest(validBody));
        expect(res.status).toBe(201);
      }
    });

    it('returns 429 with Retry-After on the 51st ticket', async () => {
      mockVerifyIdToken.mockResolvedValue({ uid: 'over-user', name: 'Over' });

      for (let count = 0; count < 50; count += 1) {
        await POST(makePostRequest(validBody));
      }

      const res = await POST(makePostRequest(validBody));
      expect(res.status).toBe(429);
      expect(res.headers.get('Retry-After')).not.toBeNull();
      const retryAfter = Number(res.headers.get('Retry-After'));
      expect(retryAfter).toBeGreaterThan(0);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('50');
    });

    it('tracks rate limits independently per user', async () => {
      mockVerifyIdToken.mockResolvedValue({ uid: 'user-a', name: 'A' });
      for (let count = 0; count < 50; count += 1) {
        await POST(makePostRequest(validBody));
      }
      const overA = await POST(makePostRequest(validBody));
      expect(overA.status).toBe(429);

      mockVerifyIdToken.mockResolvedValue({ uid: 'user-b', name: 'B' });
      const freshB = await POST(makePostRequest(validBody));
      expect(freshB.status).toBe(201);
    });

    it('resets the window after 24 hours', async () => {
      mockVerifyIdToken.mockResolvedValue({ uid: 'reset-user', name: 'R' });
      const realNow = Date.now;
      const baseTime = 1_700_000_000_000;
      let fakeNow = baseTime;
      Date.now = () => fakeNow;

      try {
        for (let count = 0; count < 50; count += 1) {
          await POST(makePostRequest(validBody));
        }
        const capped = await POST(makePostRequest(validBody));
        expect(capped.status).toBe(429);

        fakeNow = baseTime + 24 * 60 * 60 * 1000 + 1;
        const afterWindow = await POST(makePostRequest(validBody));
        expect(afterWindow.status).toBe(201);
      } finally {
        Date.now = realNow;
      }
    });
  });
});
