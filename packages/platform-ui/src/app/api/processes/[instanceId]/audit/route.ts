import { getPlatformServices } from '@/lib/platform-services';
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
 * Returns every audit event for the given process instance in
 * `{ events: AuditEvent[] }`. The wrapper reserves room for a future
 * `nextCursor` field (see headless-migration Phase 1 pagination note)
 * without another breaking change.
 */
export const GET = createRouteAdapter<
  typeof ListAuditEventsInputSchema,
  ListAuditEventsInput,
  RouteContext
>(
  ListAuditEventsInputSchema,
  async (_req, ctx) => ({ instanceId: (await ctx.params).instanceId }),
  (input) => listAuditEvents(input, { auditRepo: getPlatformServices().auditRepo }),
);
