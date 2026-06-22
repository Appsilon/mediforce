import { createRouteAdapter } from '@/lib/route-adapter';
import { listTasks } from '@mediforce/platform-api/handlers';
import { ListTasksInputSchema, type ListTasksInput } from '@mediforce/platform-api/contract';

/**
 * GET /api/tasks
 *
 * Contract lives in `@mediforce/platform-api`. Accepted query params:
 *   - `instanceId` — narrow to a single process instance (mutually exclusive with `role`)
 *   - `role`       — narrow to an assigned role
 *   - `stepId`     — optional filter within the chosen base set
 *   - `status`     — repeatable; e.g. `?status=pending&status=claimed`
 *   - (none)       — caller-scope axis: returns every task whose parent run
 *                    belongs to a workspace the caller is a member of
 *                    (system actors see every task)
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
