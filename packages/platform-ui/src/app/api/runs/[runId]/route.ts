import { createRouteAdapter } from '@/lib/route-adapter';
import { getRun } from '@mediforce/platform-api/handlers';
import { GetRunInputSchema, type GetRunInput } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ runId: string }>;
}

/**
 * GET /api/runs/<runId>
 *
 * Polling endpoint for webhook + manual triggers. The handler returns the
 * run with `finalOutput` (most-recent completed step output once terminal)
 * and `definitionNamespace` (so clients can build the human-facing URL in
 * one round-trip).
 *
 * Workspace gating lives in `scope.runs.getById` — out-of-scope runs surface
 * as 404 (anti-enumeration). This is a deliberate behavioural change from
 * the legacy inline route's 403, matching the Phase 1 pattern.
 */
export const GET = createRouteAdapter<typeof GetRunInputSchema, GetRunInput, unknown, RouteContext>(
  GetRunInputSchema,
  async (_req, ctx) => ({ runId: (await ctx.params).runId }),
  getRun,
);
