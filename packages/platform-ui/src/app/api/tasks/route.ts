import { NextRequest, NextResponse } from 'next/server';
import { getPlatformServices } from '@/lib/platform-services';
import { resolveCallerIdentity, callerCanAccess } from '@/lib/api-auth';
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
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { humanTaskRepo, instanceRepo, namespaceRepo, apiKeyRepo } = getPlatformServices();

  const caller = await resolveCallerIdentity(req, namespaceRepo, apiKeyRepo);
  if (caller instanceof NextResponse) return caller;

  const params = req.nextUrl.searchParams;
  const statuses = params.getAll('status');
  const rawInput = {
    instanceId: params.get('instanceId') ?? undefined,
    role: params.get('role') ?? undefined,
    stepId: params.get('stepId') ?? undefined,
    status: statuses.length > 0 ? statuses : undefined,
  };

  const parsed = ListTasksInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { tasks } = await listTasks(parsed.data as ListTasksInput, { humanTaskRepo });

  // API-key callers get unfiltered results
  if (caller.kind === 'apiKey') {
    return NextResponse.json({ tasks });
  }

  // For authenticated users, filter tasks to those whose process instance
  // belongs to a namespace the caller has access to.
  const filtered = await filterTasksByNamespace(tasks, caller, instanceRepo);
  return NextResponse.json({ tasks: filtered });
}

async function filterTasksByNamespace<
  T extends { processInstanceId: string },
>(
  tasks: readonly T[],
  caller: Extract<Awaited<ReturnType<typeof resolveCallerIdentity>>, { kind: 'user' }>,
  instanceRepo: { getById: (id: string) => Promise<{ namespace?: string } | null> },
): Promise<T[]> {
  // Batch-deduplicate instance lookups — many tasks may share the same instance
  const instanceIds = [...new Set(tasks.map((t) => t.processInstanceId))];
  const instanceMap = new Map<string, { namespace?: string } | null>();
  await Promise.all(
    instanceIds.map(async (id) => {
      instanceMap.set(id, await instanceRepo.getById(id));
    }),
  );

  return tasks.filter((task) => {
    const instance = instanceMap.get(task.processInstanceId);
    if (!instance || typeof instance.namespace !== 'string') return false;
    return callerCanAccess(caller, instance.namespace);
  });
}
