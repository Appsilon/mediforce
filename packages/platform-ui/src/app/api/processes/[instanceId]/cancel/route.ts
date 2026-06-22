import { createRouteAdapter } from '@/lib/route-adapter';
import { cancelRun } from '@mediforce/platform-api/handlers';
import { CancelRunInputSchema } from '@mediforce/platform-api/contract';
import type { CancelRunInput } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ instanceId: string }>;
}

/**
 * POST /api/processes/:instanceId/cancel
 *
 * State transition (running | paused → failed). State-machine precondition,
 * workspace gating, and audit emission live in the handler (ADR-0005 §5/§7).
 * Response is entity-echoed `{ run: WorkflowRun }` — replaces the
 * pre-migration `{ instanceId, status }` shape.
 *
 * The URL path keeps the legacy `processes/:instanceId` segment until a
 * coordinated URL rename phase; the adapter translates `params.instanceId`
 * to the contract field `runId`.
 */
export const POST = createRouteAdapter<typeof CancelRunInputSchema, CancelRunInput, unknown, RouteContext>(
  CancelRunInputSchema,
  async (req, ctx) => ({
    runId: (await ctx.params).instanceId,
    ...((await req.json().catch(() => ({}))) as Record<string, unknown>),
  }),
  cancelRun,
);
