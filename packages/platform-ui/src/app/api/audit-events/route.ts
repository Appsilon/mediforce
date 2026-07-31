import { createRouteAdapter } from '@/lib/route-adapter';
import { listNamespaceAuditEvents } from '@mediforce/platform-api/handlers';
import { ListNamespaceAuditEventsInputSchema } from '@mediforce/platform-api/contract';

/**
 * GET /api/audit-events?namespace=…&limit=… — every audit event for a
 * workspace (Monitoring → Users tab). Namespace gating lives in
 * AuthorizedAuditEventRepository.getByNamespace.
 */
export const GET = createRouteAdapter(
  ListNamespaceAuditEventsInputSchema,
  (req) => {
    const params = req.nextUrl.searchParams;
    const namespace = params.get('namespace');
    const limit = params.get('limit');
    return {
      ...(namespace !== null ? { namespace } : {}),
      ...(limit !== null ? { limit } : {}),
    };
  },
  listNamespaceAuditEvents,
);
