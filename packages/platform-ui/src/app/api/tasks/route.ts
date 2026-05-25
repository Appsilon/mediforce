import { createRouteAdapter } from '@/lib/route-adapter';
import { listTasks } from '@mediforce/platform-api/handlers';
import {
  ListTasksInputSchema,
  type ListTasksInput,
} from '@mediforce/platform-api/contract';

/**
 * GET /api/tasks
 *
 * Contract lives in `@mediforce/platform-api`. Accepted query params:
 *   - `instanceId` OR `role` — exactly one is required
 *   - `stepId`               — optional filter within the instance/role
 *   - `status`               — repeatable; e.g. `?status=pending&status=claimed`
 *
 * Workspace gating is enforced inside `scope.tasks`: api-key callers see every
 * matching task, user callers only see tasks whose parent run belongs to a
 * workspace they're a member of.
 */
export const GET = createRouteAdapter<typeof ListTasksInputSchema, ListTasksInput>(
  ListTasksInputSchema,
  (req) => {
    const params = req.nextUrl.searchParams;
    const statuses = params.getAll('status');
    return {
      instanceId: params.get('instanceId') ?? undefined,
      role: params.get('role') ?? undefined,
      stepId: params.get('stepId') ?? undefined,
      status: statuses.length > 0 ? statuses : undefined,
    };
  },
  listTasks,
);
