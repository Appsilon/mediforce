import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createRouteAdapter } from '../route-adapter';

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
