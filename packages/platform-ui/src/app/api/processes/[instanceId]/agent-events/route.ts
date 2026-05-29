import { createRouteAdapter } from '@/lib/route-adapter';
import { listAgentEvents } from '@mediforce/platform-api/handlers';
import { ListAgentEventsInputSchema } from '@mediforce/platform-api/contract';
import type { ListAgentEventsInput } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ instanceId: string }>;
}

/**
 * GET /api/processes/:instanceId/agent-events?stepId=X&afterSequence=N
 *
 * Returns `{ events: AgentEvent[] }` sorted by `sequence` ASC. The optional
 * `stepId` query param narrows to one step; absent returns the full
 * per-instance log. The optional `afterSequence` cursor returns only events
 * with `sequence > afterSequence`, letting the live poller fetch deltas.
 * Workspace gating in `scope.runs` / `scope.agentEvents`.
 */
export const GET = createRouteAdapter<
  typeof ListAgentEventsInputSchema,
  ListAgentEventsInput,
  unknown,
  RouteContext
>(
  ListAgentEventsInputSchema,
  async (req, ctx) => {
    const { instanceId } = await ctx.params;
    const params = new URL(req.url).searchParams;
    const stepId = params.get('stepId') ?? undefined;
    const afterSequenceRaw = params.get('afterSequence');
    const afterSequence =
      afterSequenceRaw === null ? undefined : Number(afterSequenceRaw);
    return { instanceId, stepId, afterSequence };
  },
  listAgentEvents,
);
