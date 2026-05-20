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
 * Returns `{ events: AuditEvent[] }` — wrapped (breaking change vs `main`,
 * which returned a bare array) to keep pagination additive once #231 lands.
 * Missing instances 404 via `NotFoundError`. Namespace gating is enforced
 * inside the handler.
 */
export const GET = createRouteAdapter<
  typeof ListAuditEventsInputSchema,
  ListAuditEventsInput,
  unknown,
  RouteContext
>(
  ListAuditEventsInputSchema,
  async (_req, ctx) => ({ instanceId: (await ctx.params).instanceId }),
  (input, caller) => {
    const { auditRepo, instanceRepo } = getPlatformServices();
    return listAuditEvents(input, { auditRepo, instanceRepo }, caller);
  },
);
