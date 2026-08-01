import { createRouteAdapter } from '@/lib/route-adapter';
import { listNamespaceAuditEvents } from '@mediforce/platform-api/handlers';
import { ListNamespaceAuditEventsInputSchema } from '@mediforce/platform-api/contract';

/**
 * GET /api/audit-events — keyset-paginated audit events for a workspace
 * (Monitoring → Users / Tasks tabs). Namespace gating lives in
 * AuthorizedAuditEventRepository.getByNamespace.
 *
 * Accepted query params:
 *   - `namespace` — required workspace handle
 *   - `limit`     — max items (1..100, default 20)
 *   - `cursor`    — opaque token from a prior `nextCursor`
 *   - `action`    — repeatable; restricts to this action set
 *   - `actorId`   — restrict to one actor
 *   - `fromDate` / `toDate` — inclusive `YYYY-MM-DD` bounds
 */
export const GET = createRouteAdapter(
  ListNamespaceAuditEventsInputSchema,
  (req) => {
    const params = req.nextUrl.searchParams;
    const namespace = params.get('namespace');
    const limit = params.get('limit');
    const actions = params.getAll('action');
    return {
      ...(namespace !== null ? { namespace } : {}),
      ...(limit !== null ? { limit } : {}),
      cursor: params.get('cursor') ?? undefined,
      actions: actions.length > 0 ? actions : undefined,
      actorId: params.get('actorId') ?? undefined,
      fromDate: params.get('fromDate') ?? undefined,
      toDate: params.get('toDate') ?? undefined,
    };
  },
  listNamespaceAuditEvents,
);
