import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError } from '@mediforce/platform-api/errors';
import type { CallerIdentity } from '@mediforce/platform-api/auth';
import type { CallerScope } from '@mediforce/platform-api/repositories';
import { createRouteAdapter } from '../route-adapter';

const InputSchema = z.object({ name: z.string().min(1) });

const apiKeyCaller: CallerIdentity = { kind: 'apiKey', isSystemActor: true };

/** Minimal scope stub — adapter tests don't exercise wrapper internals, so
 *  an opaque object carrying just the caller is enough to verify routing. */
function stubScope(caller: CallerIdentity): CallerScope {
  return { caller } as unknown as CallerScope;
}

function makeRequest(params?: Record<string, string>): NextRequest {
  const url = new URL('http://localhost/api/test');
  if (params !== undefined) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  return new NextRequest(url.toString());
}

function stubCaller(caller: CallerIdentity = apiKeyCaller) {
  return vi.fn().mockResolvedValue(caller);
}

const buildScope = (c: CallerIdentity): CallerScope => stubScope(c);

describe('createRouteAdapter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // Auth pipeline: middleware (`src/middleware.ts`) first gates `/api/*` for
  // presence of credentials. The adapter then resolves those credentials into
  // a typed `CallerIdentity`, builds a per-request `CallerScope` from the
  // platform services, and threads it into the handler. Tests stub both
  // resolveCaller and buildScope to bypass Firebase/Firestore.

  it('returns 400 with the first Zod issue when input fails validation', async () => {
    const GET = createRouteAdapter(
      InputSchema,
      (req) => ({ name: req.nextUrl.searchParams.get('name') }),
      vi.fn(),
      { resolveCaller: stubCaller(), buildScope },
    );

    const res = await GET(makeRequest(), undefined);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe('validation');
    expect(json.error.message).toBeTypeOf('string');
    expect(json.error.message.length).toBeGreaterThan(0);
    expect(Array.isArray(json.error.details)).toBe(true);
  });

  it('passes parsed input + scope to the handler and returns its result as JSON', async () => {
    const handler = vi.fn().mockResolvedValue({ greeting: 'hello alice' });
    const userCaller: CallerIdentity = {
      kind: 'user',
      uid: 'u1',
      namespaces: new Set(['ns-a']),
      isSystemActor: false,
    };
    const GET = createRouteAdapter(
      InputSchema,
      (req) => ({ name: req.nextUrl.searchParams.get('name') }),
      handler,
      { resolveCaller: stubCaller(userCaller), buildScope },
    );

    const res = await GET(makeRequest({ name: 'alice' }), undefined);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ greeting: 'hello alice' });
    expect(handler).toHaveBeenCalledWith(
      { name: 'alice' },
      expect.objectContaining({ caller: userCaller }),
    );
  });

  it('short-circuits with the 401 response returned by resolveCaller', async () => {
    const handler = vi.fn();
    const unauthorized = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const GET = createRouteAdapter(
      InputSchema,
      (req) => ({ name: req.nextUrl.searchParams.get('name') }),
      handler,
      { resolveCaller: vi.fn().mockResolvedValue(unauthorized), buildScope },
    );

    const res = await GET(makeRequest({ name: 'alice' }), undefined);

    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  describe('typed-error → envelope mapping (ADR-0005 §3)', () => {
    const cases: ReadonlyArray<{ code: string; status: number }> = [
      { code: 'unauthorized', status: 401 },
      { code: 'forbidden', status: 403 },
      { code: 'not_found', status: 404 },
      { code: 'validation', status: 400 },
      { code: 'precondition_failed', status: 409 },
      { code: 'conflict', status: 409 },
      { code: 'rate_limited', status: 429 },
      { code: 'internal', status: 500 },
    ];

    for (const { code, status } of cases) {
      it(`maps ApiError('${code}') to HTTP ${status} with typed envelope`, async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const handler = vi
          .fn()
          .mockRejectedValue(
            new ApiError(code as never, `boom: ${code}`, { hint: 'detail' }),
          );
        const GET = createRouteAdapter(
          InputSchema,
          (req) => ({ name: req.nextUrl.searchParams.get('name') }),
          handler,
          { resolveCaller: stubCaller(), buildScope },
        );

        const res = await GET(makeRequest({ name: 'alice' }), undefined);

        expect(res.status).toBe(status);
        expect(await res.json()).toEqual({
          error: { code, message: `boom: ${code}`, details: { hint: 'detail' } },
        });
        consoleError.mockRestore();
      });
    }
  });

  it('maps a thrown ZodError to validation with the issues in details', async () => {
    const Inner = z.object({ x: z.number() });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handler = vi.fn().mockImplementation(() => {
      Inner.parse({ x: 'not-a-number' });
    });
    const GET = createRouteAdapter(
      InputSchema,
      (req) => ({ name: req.nextUrl.searchParams.get('name') }),
      handler,
      { resolveCaller: stubCaller(), buildScope },
    );

    const res = await GET(makeRequest({ name: 'alice' }), undefined);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('validation');
    expect(Array.isArray(body.error.details)).toBe(true);
    consoleError.mockRestore();
  });

  it('returns 500 with a generic envelope when the handler throws an unexpected error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handler = vi.fn().mockRejectedValue(new Error('database on fire'));
    const GET = createRouteAdapter(
      InputSchema,
      (req) => ({ name: req.nextUrl.searchParams.get('name') }),
      handler,
      { resolveCaller: stubCaller(), buildScope },
    );

    const res = await GET(makeRequest({ name: 'alice' }), undefined);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: { code: 'internal', message: 'Internal error' },
    });
    expect(consoleError).toHaveBeenCalled();
  });

  it('awaits async inputFromRequest (for dynamic-segment route params)', async () => {
    interface RouteContext {
      params: Promise<{ id: string }>;
    }
    const handler = vi.fn().mockResolvedValue({ ok: true, id: 'abc' });
    const ParamSchema = z.object({ id: z.string().min(1) });
    const GET = createRouteAdapter<typeof ParamSchema, { id: string }, { ok: true; id: string }, RouteContext>(
      ParamSchema,
      async (_req, ctx) => ({ id: (await ctx.params).id }),
      handler,
      { resolveCaller: stubCaller(), buildScope },
    );

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'abc' }) });

    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledWith(
      { id: 'abc' },
      expect.objectContaining({ caller: apiKeyCaller }),
    );
  });

  describe('NarrowInput generic', () => {
    type NarrowExample =
      | { instanceId: string; role?: undefined }
      | { role: string; instanceId?: undefined };

    const _check: NarrowExample = { instanceId: 'x' };
    void _check;

    const UnionSchema = z
      .object({
        instanceId: z.string().min(1).optional(),
        role: z.string().min(1).optional(),
      })
      .refine(
        (val) => (val.instanceId !== undefined) !== (val.role !== undefined),
        { message: 'Exactly one of `instanceId` or `role` is required' },
      );

    it('passes the narrowed input type through to the handler', async () => {
      const handler = vi
        .fn<(input: NarrowExample, scope: CallerScope) => Promise<{ ok: true }>>()
        .mockResolvedValue({ ok: true });

      const GET = createRouteAdapter<typeof UnionSchema, NarrowExample>(
        UnionSchema,
        (req) => ({
          instanceId: req.nextUrl.searchParams.get('instanceId') ?? undefined,
          role: req.nextUrl.searchParams.get('role') ?? undefined,
        }),
        handler,
        { resolveCaller: stubCaller(), buildScope },
      );

      const res = await GET(makeRequest({ instanceId: 'inst-a' }), undefined);

      expect(res.status).toBe(200);
      expect(handler).toHaveBeenCalledTimes(1);
      const received = handler.mock.calls[0]?.[0];
      expect(received).toEqual({ instanceId: 'inst-a' });
      if (received !== undefined && received.instanceId !== undefined) {
        expect(received.instanceId).toBe('inst-a');
      }
    });
  });
});
