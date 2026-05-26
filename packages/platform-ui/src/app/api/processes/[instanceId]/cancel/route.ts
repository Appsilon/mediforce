import { createRouteAdapter } from '@/lib/route-adapter';
import { cancelProcess } from '@mediforce/platform-api/handlers';
import { CancelProcessInputSchema } from '@mediforce/platform-api/contract';
import type { CancelProcessInput } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ instanceId: string }>;
}

/**
 * POST /api/processes/:instanceId/cancel
 *
 * Body: { reason?: string }
 *
 * State transition (running | paused → failed). State-machine precondition,
 * workspace gating, and audit emission live in the handler (Phase 2 PR2 /
 * ADR-0005 §5/§7). Response is entity-echoed `{ run: WorkflowRun }` —
 * replaces the pre-migration `{ instanceId, status }` shape.
 */
export const POST = createRouteAdapter<
  typeof CancelProcessInputSchema,
  CancelProcessInput,
  unknown,
  RouteContext
>(
  CancelProcessInputSchema,
  async (req, ctx) => {
    const { instanceId } = await ctx.params;
    const raw = (await req.json().catch(() => ({}))) as { reason?: unknown };
    const reason =
      typeof raw.reason === 'string' && raw.reason.length > 0 ? raw.reason : undefined;
    return { instanceId, ...(reason !== undefined ? { reason } : {}) };
  },
  cancelProcess,
);
