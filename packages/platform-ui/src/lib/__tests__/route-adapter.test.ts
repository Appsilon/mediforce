import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ForbiddenError, HandlerError, NotFoundError } from '@mediforce/platform-api/errors';
import type { CallerIdentity } from '@mediforce/platform-api/auth';
import { createRouteAdapter } from '../route-adapter';

const InputSchema = z.object({ name: z.string().min(1) });

const apiKeyCaller: CallerIdentity = { kind: 'apiKey' };

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

describe('createRouteAdapter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // Auth pipeline: middleware (`src/middleware.ts`) first gates `/api/*` for
  // presence of credentials. The adapter then resolves those credentials into
  // a typed `CallerIdentity` and threads it into the handler so domain code
  // can enforce namespace policy. Both layers run in production; tests stub
  // `resolveCaller` to bypass Firebase/Firestore.

  it('returns 400 with the first Zod issue when input fails validation', async () => {
    const GET = createRouteAdapter(
      InputSchema,
      (req) => ({ name: req.nextUrl.searchParams.get('name') }),
      vi.fn(),
      { resolveCaller: stubCaller() },
    );

    const res = await GET(makeRequest(), undefined);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBeTypeOf('string');
    expect(json.error.length).toBeGreaterThan(0);
  });

  it('passes parsed input + caller to the handler and returns its result as JSON', async () => {
    const handler = vi.fn().mockResolvedValue({ greeting: 'hello alice' });
    const userCaller: CallerIdentity = {
      kind: 'user',
      uid: 'u1',
      namespaces: new Set(['ns-a']),
    };
    const GET = createRouteAdapter(
      InputSchema,
      (req) => ({ name: req.nextUrl.searchParams.get('name') }),
      handler,
      { resolveCaller: stubCaller(userCaller) },
    );

    const res = await GET(makeRequest({ name: 'alice' }), undefined);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ greeting: 'hello alice' });
    expect(handler).toHaveBeenCalledWith({ name: 'alice' }, userCaller);
  });

  it('short-circuits with the 401 response returned by resolveCaller', async () => {
    const handler = vi.fn();
    const unauthorized = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const GET = createRouteAdapter(
      InputSchema,
      (req) => ({ name: req.nextUrl.searchParams.get('name') }),
      handler,
      { resolveCaller: vi.fn().mockResolvedValue(unauthorized) },
    );

    const res = await GET(makeRequest({ name: 'alice' }), undefined);

    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it('maps NotFoundError to 404 with the error message', async () => {
    const handler = vi.fn().mockRejectedValue(new NotFoundError('Task not found'));
    const GET = createRouteAdapter(
      InputSchema,
      (req) => ({ name: req.nextUrl.searchParams.get('name') }),
      handler,
      { resolveCaller: stubCaller() },
    );

    const res = await GET(makeRequest({ name: 'alice' }), undefined);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Task not found' });
  });

  it('maps ForbiddenError to 403 with the error message', async () => {
    const handler = vi.fn().mockRejectedValue(new ForbiddenError());
    const GET = createRouteAdapter(
      InputSchema,
      (req) => ({ name: req.nextUrl.searchParams.get('name') }),
      handler,
      { resolveCaller: stubCaller() },
    );

    const res = await GET(makeRequest({ name: 'alice' }), undefined);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Forbidden' });
  });

  it('maps an arbitrary HandlerError subclass to its declared status', async () => {
    class TeapotError extends HandlerError {
      constructor() {
        super(418, "I'm a teapot");
      }
    }
    const handler = vi.fn().mockRejectedValue(new TeapotError());
    const GET = createRouteAdapter(
      InputSchema,
      (req) => ({ name: req.nextUrl.searchParams.get('name') }),
      handler,
      { resolveCaller: stubCaller() },
    );

    const res = await GET(makeRequest({ name: 'alice' }), undefined);

    expect(res.status).toBe(418);
    expect(await res.json()).toEqual({ error: "I'm a teapot" });
  });

  it('returns 500 with a generic message when the handler throws an unexpected error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handler = vi.fn().mockRejectedValue(new Error('database on fire'));
    const GET = createRouteAdapter(
      InputSchema,
      (req) => ({ name: req.nextUrl.searchParams.get('name') }),
      handler,
      { resolveCaller: stubCaller() },
    );

    const res = await GET(makeRequest({ name: 'alice' }), undefined);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Internal error' });
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
      { resolveCaller: stubCaller() },
    );

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'abc' }) });

    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledWith({ id: 'abc' }, apiKeyCaller);
  });

  describe('NarrowInput generic', () => {
    // Discriminated union narrower than the schema's `z.infer` — the handler
    // wants exactly-one-of, but the schema parses a refine on an object where
    // both keys are optional. Callers opt in by passing the narrow type
    // explicitly as the second type parameter.
    type NarrowExample =
      | { instanceId: string; role?: undefined }
      | { role: string; instanceId?: undefined };

    // Type-level sanity check: a valid narrowed value is assignable to the
    // union, and discriminating on presence of `instanceId` narrows correctly.
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
        .fn<(input: NarrowExample, caller: CallerIdentity) => Promise<{ ok: true }>>()
        .mockResolvedValue({ ok: true });

      const GET = createRouteAdapter<typeof UnionSchema, NarrowExample>(
        UnionSchema,
        (req) => ({
          instanceId: req.nextUrl.searchParams.get('instanceId') ?? undefined,
          role: req.nextUrl.searchParams.get('role') ?? undefined,
        }),
        handler,
        { resolveCaller: stubCaller() },
      );

      const res = await GET(makeRequest({ instanceId: 'inst-a' }), undefined);

      expect(res.status).toBe(200);
      expect(handler).toHaveBeenCalledTimes(1);
      const received = handler.mock.calls[0]?.[0];
      expect(received).toEqual({ instanceId: 'inst-a' });
      // Runtime narrowing mirrors what the type claims.
      if (received !== undefined && received.instanceId !== undefined) {
        expect(received.instanceId).toBe('inst-a');
      }
    });
  });
});
