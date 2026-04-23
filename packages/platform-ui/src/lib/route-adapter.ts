import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { HandlerError } from '@mediforce/platform-api/handlers';

/**
 * Wraps a pure handler (from `@mediforce/platform-api`) into a Next.js route.
 *
 * Auth is handled globally by `src/middleware.ts` (X-Api-Key or Firebase ID
 * token) for `/api/*` paths — routes built on top of this adapter never
 * re-check auth. **Server actions and non-`/api` entry points are NOT covered
 * by that middleware** (it matches `/api/:path*` only). If you compose a pure
 * handler into a server action, that action is responsible for its own auth
 * check. `api-boundaries.test.ts` allows `app/actions/*.ts` to import handlers
 * precisely for that kind of composition — the guard cannot distinguish
 * "middleware-protected caller" from "self-auth caller".
 *
 * What this helper does:
 *
 *   1. `inputFromRequest(req, ctx)` maps the request (and optional dynamic
 *      route context) to a raw contract-input object. May be sync or async —
 *      Next.js passes `ctx.params` as a Promise on dynamic routes.
 *   2. Zod validation → 400 with the first issue's message
 *   3. Delegation to the handler
 *   4. Typed `HandlerError` → its declared `statusCode` + original message
 *   5. Unknown errors → 500 with a generic message (full error logged server-side)
 *
 * Example — flat route, query params only:
 *
 *   export const GET = createRouteAdapter(ListTasksInputSchema, (req) => ({
 *     instanceId: req.nextUrl.searchParams.get('instanceId') ?? undefined,
 *     role:       req.nextUrl.searchParams.get('role') ?? undefined,
 *   }), (input) => listTasks(input, { humanTaskRepo: getPlatformServices().humanTaskRepo }));
 *
 * Example — dynamic route, path params via `ctx.params`:
 *
 *   export const GET = createRouteAdapter<
 *     typeof GetTaskInputSchema,
 *     GetTaskInput,
 *     { params: Promise<{ taskId: string }> }
 *   >(
 *     GetTaskInputSchema,
 *     async (_req, ctx) => ({ taskId: (await ctx.params).taskId }),
 *     (input) => getTask(input, { humanTaskRepo: getPlatformServices().humanTaskRepo }),
 *   );
 *
 * The `NarrowInput` generic defaults to `z.infer<InputSchema>`. Pass it
 * explicitly when the handler expects a narrower type than the schema's
 * `z.infer`, e.g. a discriminated union backed by a Zod refine.
 *
 * **`NarrowInput` contract**: must be a *strict subset* of `z.infer<InputSchema>`.
 * The adapter casts `parsed.data` to `NarrowInput` on a successful parse — the
 * cast is trusted, not verified. In the pilot this is sound because the Zod
 * refine that produces the discriminated union runs inside `safeParse`, so
 * only instances that satisfy the refine reach the cast. For other usages,
 * the refine must logically enforce whatever narrowing `NarrowInput` claims,
 * or the cast becomes a silent lie. If you need a looser supertype rather
 * than a subset, do not use this generic — parse inside the handler instead.
 */
export function createRouteAdapter<
  InputSchema extends z.ZodType,
  NarrowInput = z.infer<InputSchema>,
  Context = undefined,
  Output = unknown,
>(
  inputSchema: InputSchema,
  inputFromRequest: (req: NextRequest, ctx: Context) => unknown | Promise<unknown>,
  handler: (input: NarrowInput) => Promise<Output>,
): (req: NextRequest, ctx: Context) => Promise<NextResponse> {
  return async (req, ctx) => {
    const raw = await Promise.resolve(inputFromRequest(req, ctx));
    const parsed = inputSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 },
      );
    }

    try {
      const result = await handler(parsed.data as NarrowInput);
      return NextResponse.json(result);
    } catch (err) {
      if (err instanceof HandlerError) {
        return NextResponse.json(
          { error: err.message },
          { status: err.statusCode },
        );
      }
      console.error('[route-adapter] handler error:', err);
      return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }
  };
}
