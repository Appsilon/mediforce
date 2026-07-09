import type { CallerScope } from '../../repositories/index';
import type {
  GetMonitoringSummaryOutput,
  MonitoringSummary,
  MonitoringSummaryInput,
} from '../../contract/monitoring';
import { assertNamespaceAccess } from '../../auth';

/**
 * Compact dashboard aggregate for a single workspace. Computed server-side so
 * the wire payload is ~200 B regardless of the underlying data set size.
 *
 * Method: pull workspace runs in one indexed query, then pull every task
 * whose parent is in the run set in a single chunked `in`-query bulk
 * fetch, then tally in JS. Run counts are all-time per status (matches
 * the pre-PR2 Firestore-subscription hook this endpoint replaced); the
 * Postgres era replaces both calls with `SELECT COUNT(*) ... GROUP BY ...`
 * against workspace-scoped partial indexes.
 */
export async function getMonitoringSummary(
  input: MonitoringSummaryInput,
  scope: CallerScope,
): Promise<GetMonitoringSummaryOutput> {
  assertNamespaceAccess(scope.caller, input.handle);
  const handle = input.handle;

  const runs = await scope.runs.list({ namespace: handle, limit: 10_000 });

  const runsBucket = { running: 0, paused: 0, completed: 0, failed: 0 };
  for (const run of runs) {
    if (run.status === 'running') runsBucket.running++;
    else if (run.status === 'paused') runsBucket.paused++;
    else if (run.status === 'completed') runsBucket.completed++;
    else if (run.status === 'failed') runsBucket.failed++;
  }

  const tasksBucket = { pending: 0, claimed: 0 };
  const roleTally = new Map<string, { pending: number; claimed: number }>();
  const tasks = await scope.tasks.getByInstanceIds(runs.map((r) => r.id));
  for (const task of tasks) {
    if (task.deleted === true) continue;
    if (task.status === 'pending') {
      tasksBucket.pending++;
      roleBucket(roleTally, task.assignedRole).pending++;
    } else if (task.status === 'claimed') {
      tasksBucket.claimed++;
      roleBucket(roleTally, task.assignedRole).claimed++;
    }
  }

  const summary: MonitoringSummary = {
    runs: runsBucket,
    tasks: tasksBucket,
    roleTaskCounts: Object.fromEntries(roleTally),
  };
  return { summary };
}

function roleBucket(
  tally: Map<string, { pending: number; claimed: number }>,
  role: string,
): { pending: number; claimed: number } {
  let entry = tally.get(role);
  if (entry === undefined) {
    entry = { pending: 0, claimed: 0 };
    tally.set(role, entry);
  }
  return entry;
}
