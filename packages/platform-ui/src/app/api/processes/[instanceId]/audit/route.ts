import { createRouteAdapter } from '@/lib/route-adapter';
import { listAuditEvents } from '@mediforce/platform-api/handlers';
import { ListAuditEventsInputSchema } from '@mediforce/platform-api/contract';
import type { ListAuditEventsInput } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ instanceId: string }>;
}

/**
 * GET /api/processes/:instanceId/audit
 *
 * Returns `{ events: AuditEvent[] }` — wrapped (breaking change vs `main`,
 * which returned a bare array) to keep pagination additive once #231 lands.
 * Workspace gating in `scope.runs` / `scope.auditEvents`.
 */
export const GET = createRouteAdapter<typeof ListAuditEventsInputSchema, ListAuditEventsInput, unknown, RouteContext>(
  ListAuditEventsInputSchema,
  async (_req, ctx) => ({ instanceId: (await ctx.params).instanceId }),
  listAuditEvents,
);
