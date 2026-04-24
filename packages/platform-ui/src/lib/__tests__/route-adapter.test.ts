import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createRouteAdapter } from '../route-adapter';
import { HandlerError, NotFoundError } from '@mediforce/platform-api/handlers';

const InputSchema = z.object({ name: z.string().min(1) });

function makeRequest(params?: Record<string, string>): NextRequest {
  const url = new URL('http://localhost/api/test');
  if (params !== undefined) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  return new NextRequest(url.toString());
}

describe('createRouteAdapter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // Auth is enforced globally by `src/middleware.ts` (X-Api-Key or Firebase
  // ID token) before any route handler runs. This adapter therefore does not
  // reimplement auth — it only covers input parsing, delegation, and error
  // sanitisation. See `src/test/middleware.test.ts` for auth coverage.

  it('returns 400 with the first Zod issue when input fails validation', async () => {
    const GET = createRouteAdapter(
      InputSchema,
      (req) => ({ name: req.nextUrl.searchParams.get('name') }),
      vi.fn(),
    );

    const res = await GET(makeRequest());

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBeTypeOf('string');
    expect(json.error.length).toBeGreaterThan(0);
  });

  it('passes parsed input to the handler and returns its result as JSON', async () => {
    const handler = vi.fn().mockResolvedValue({ greeting: 'hello alice' });
    const GET = createRouteAdapter(
      InputSchema,
      (req) => ({ name: req.nextUrl.searchParams.get('name') }),
      handler,
    );

    const res = await GET(makeRequest({ name: 'alice' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ greeting: 'hello alice' });
    expect(handler).toHaveBeenCalledWith({ name: 'alice' });
  });

  it('returns 500 with a generic message when the handler throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handler = vi.fn().mockRejectedValue(new Error('database on fire'));
    const GET = createRouteAdapter(
      InputSchema,
      (req) => ({ name: req.nextUrl.searchParams.get('name') }),
      handler,
    );

    const res = await GET(makeRequest({ name: 'alice' }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Internal error' });
    expect(consoleError).toHaveBeenCalled();
  });

  describe('HandlerError mapping', () => {
    it('maps NotFoundError to 404 with the original message', async () => {
      const handler = vi.fn().mockRejectedValue(new NotFoundError('Task abc not found'));
      const GET = createRouteAdapter(
        InputSchema,
        (req) => ({ name: req.nextUrl.searchParams.get('name') }),
        handler,
      );

      const res = await GET(makeRequest({ name: 'alice' }));

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'Task abc not found' });
    });

    it('maps an arbitrary HandlerError to its declared statusCode', async () => {
      const handler = vi.fn().mockRejectedValue(new HandlerError(409, 'Precondition failed'));
      const GET = createRouteAdapter(
        InputSchema,
        (req) => ({ name: req.nextUrl.searchParams.get('name') }),
        handler,
      );

      const res = await GET(makeRequest({ name: 'alice' }));

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: 'Precondition failed' });
    });

    it('does not log HandlerError to console (it is not an unexpected failure)', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const handler = vi.fn().mockRejectedValue(new NotFoundError('Task missing'));
      const GET = createRouteAdapter(
        InputSchema,
        (req) => ({ name: req.nextUrl.searchParams.get('name') }),
        handler,
      );

      await GET(makeRequest({ name: 'alice' }));

      expect(consoleError).not.toHaveBeenCalled();
    });
  });

  describe('dynamic route context (path params)', () => {
    // Next.js passes dynamic-route params as the second arg to a route
    // handler — `{ params: Promise<{ taskId: string }> }` in App Router.
    // The adapter must thread that context through to `inputFromRequest`
    // and await any async result.

    interface RouteContext {
      params: Promise<{ taskId: string }>;
    }

    const TaskInputSchema = z.object({ taskId: z.string().min(1) });

    it('awaits an async inputFromRequest that reads params', async () => {
      const handler = vi.fn().mockResolvedValue({ ok: true });
      const GET = createRouteAdapter<typeof TaskInputSchema, z.infer<typeof TaskInputSchema>, RouteContext>(
        TaskInputSchema,
        async (_req, ctx) => ({ taskId: (await ctx.params).taskId }),
        handler,
      );

      const req = new NextRequest('http://localhost/api/tasks/task-xyz');
      const res = await GET(req, { params: Promise.resolve({ taskId: 'task-xyz' }) });

      expect(res.status).toBe(200);
      expect(handler).toHaveBeenCalledWith({ taskId: 'task-xyz' });
    });

    it('still returns 400 when the resolved input fails Zod validation', async () => {
      const handler = vi.fn();
      const GET = createRouteAdapter<typeof TaskInputSchema, z.infer<typeof TaskInputSchema>, RouteContext>(
        TaskInputSchema,
        async (_req, ctx) => ({ taskId: (await ctx.params).taskId }),
        handler,
      );

      const req = new NextRequest('http://localhost/api/tasks/');
      const res = await GET(req, { params: Promise.resolve({ taskId: '' }) });

      expect(res.status).toBe(400);
      expect(handler).not.toHaveBeenCalled();
    });
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
      const handler = vi.fn<(input: NarrowExample) => Promise<{ ok: true }>>().mockResolvedValue({
        ok: true,
      });

      const GET = createRouteAdapter<typeof UnionSchema, NarrowExample>(
        UnionSchema,
        (req) => ({
          instanceId: req.nextUrl.searchParams.get('instanceId') ?? undefined,
          role: req.nextUrl.searchParams.get('role') ?? undefined,
        }),
        handler,
      );

      const res = await GET(makeRequest({ instanceId: 'inst-a' }));

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
