import type {
  HumanTask,
  HumanTaskRepository,
  HumanTaskStatus,
  ProcessInstanceRepository,
} from '@mediforce/platform-core';
import type { CallerIdentity } from '../../auth.js';
import { callerCanAccess } from '../../auth.js';
import type { ListTasksInput, ListTasksOutput } from '../../contract/tasks.js';

export interface ListTasksDeps {
  humanTaskRepo: HumanTaskRepository;
  /** Used to look up each task's instance for namespace gating. */
  instanceRepo: ProcessInstanceRepository;
}

/**
 * List tasks visible to the caller. API-key callers see every task matching
 * the filter; user callers only see tasks whose process instance belongs to
 * a namespace they're a member of.
 *
 * Input validation is the adapter's job. Output validation is the contract's
 * job (the Zod schema is the source of truth — handlers conform by type, not
 * by runtime parse).
 */
export async function listTasks(
  input: ListTasksInput,
  deps: ListTasksDeps,
  caller: CallerIdentity,
): Promise<ListTasksOutput> {
  const base =
    input.instanceId !== undefined
      ? await deps.humanTaskRepo.getByInstanceId(input.instanceId)
      : await deps.humanTaskRepo.getByRole(input.role);
  const filtered = applyFilters(base, input);

  if (caller.kind === 'apiKey') {
    return { tasks: filtered };
  }

  // Batch-deduplicate instance lookups — many tasks may share the same
  // instance, and Firestore reads dominate this code path.
  const instanceIds = [...new Set(filtered.map((t) => t.processInstanceId))];
  const namespaceById = new Map<string, string | undefined>();
  await Promise.all(
    instanceIds.map(async (id) => {
      const instance = await deps.instanceRepo.getById(id);
      namespaceById.set(id, instance?.namespace);
    }),
  );

  return {
    tasks: filtered.filter((task) =>
      callerCanAccess(caller, namespaceById.get(task.processInstanceId)),
    ),
  };
}

function applyFilters(
  tasks: readonly HumanTask[],
  input: ListTasksInput,
): HumanTask[] {
  const statusSet = input.status !== undefined ? new Set<HumanTaskStatus>(input.status) : null;
  const stepId = input.stepId;
  return tasks.filter((task) => {
    if (statusSet !== null && !statusSet.has(task.status)) return false;
    if (stepId !== undefined && task.stepId !== stepId) return false;
    return true;
  });
}
