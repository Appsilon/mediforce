import { createRouteAdapter } from '@/lib/route-adapter';
import { listCoworkSessions } from '@mediforce/platform-api/handlers';
import { ListCoworkSessionsInputSchema } from '@mediforce/platform-api/contract';

/**
 * GET /api/cowork
 *
 * Contract lives in `@mediforce/platform-api`. Accepted query params:
 *   - `role`      — narrow to an assigned role
 *   - `status`    — repeatable; e.g. `?status=active&status=finalized`
 *   - `namespace` — repeatable; narrows the caller-scope axis to the named
 *                   workspaces
 *   - (none)   — caller-scope axis: every session whose parent run belongs
 *                to a workspace the caller is a member of (system actors see
 *                every session)
 *
 * Workspace gating is enforced inside `scope.coworkSessions`: api-key callers
 * see every matching session, user callers only see sessions whose parent run
 * belongs to a workspace they're a member of.
 */
export const GET = createRouteAdapter(
  ListCoworkSessionsInputSchema,
  (req) => {
    const params = req.nextUrl.searchParams;
    const statuses = params.getAll('status');
    const namespaces = params.getAll('namespace');
    return {
      role: params.get('role') ?? undefined,
      status: statuses.length > 0 ? statuses : undefined,
      namespace: namespaces.length > 0 ? namespaces : undefined,
    };
  },
  listCoworkSessions,
);
