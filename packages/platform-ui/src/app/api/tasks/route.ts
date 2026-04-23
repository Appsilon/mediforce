import { getPlatformServices } from '@/lib/platform-services';
import { createRouteAdapter } from '@/lib/route-adapter';
import { listTasks } from '@mediforce/platform-api/handlers';
import { ListTasksInputSchema } from '@mediforce/platform-api/contract';
import type { ListTasksInput } from '@mediforce/platform-api/contract';

/**
 * GET /api/tasks
 *
 * Contract lives in `@mediforce/platform-api`. Accepted query params:
 *   - `instanceId` OR `role` — exactly one is required
 *   - `stepId`               — optional filter within the instance/role
 *   - `status`               — repeatable; e.g. `?status=pending&status=claimed`
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
  (input) => listTasks(input, { humanTaskRepo: getPlatformServices().humanTaskRepo }),
);
