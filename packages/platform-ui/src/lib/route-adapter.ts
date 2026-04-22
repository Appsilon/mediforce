import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

/**
 * Wraps a pure handler (from `@mediforce/platform-api`) into a Next.js route.
 *
 * Auth is handled globally by `src/middleware.ts` (X-Api-Key or Firebase ID
 * token), so routes never check it again. What this helper does:
 *
 *   1. `inputFromRequest(req)` maps the request to a raw contract-input object
 *   2. Zod validation → 400 with the first issue's message
 *   3. Delegation to the handler
 *   4. Unknown errors → 500 with a generic message (full error logged server-side)
 *
 * Example usage:
 *
 *   export const GET = createRouteAdapter(ListTasksInputSchema, (req) => ({
 *     instanceId: req.nextUrl.searchParams.get('instanceId') ?? undefined,
 *     role:       req.nextUrl.searchParams.get('role') ?? undefined,
 *     status:     req.nextUrl.searchParams.get('status') ?? undefined,
 *   }), (input) => listTasks(input, { humanTaskRepo: getPlatformServices().humanTaskRepo }));
 *
 * The `NarrowInput` generic defaults to `z.infer<InputSchema>`. Pass it
 * explicitly when the handler expects a narrower type than the schema's
 * `z.infer`, e.g. a discriminated union backed by a Zod refine:
 *
 *   createRouteAdapter<typeof ListTasksInputSchema, ListTasksInput>(...)
 */
export function createRouteAdapter<
  InputSchema extends z.ZodType,
  NarrowInput = z.infer<InputSchema>,
  Output = unknown,
>(
  inputSchema: InputSchema,
  inputFromRequest: (req: NextRequest) => unknown,
  handler: (input: NarrowInput) => Promise<Output>,
): (req: NextRequest) => Promise<NextResponse> {
  return async (req) => {
    const parsed = inputSchema.safeParse(inputFromRequest(req));
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
      console.error('[route-adapter] handler error:', err);
      return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }
  };
}
