import type { CallerScope } from '../../repositories/index.js';
import type {
  GetMonitoringSummaryOutput,
  MonitoringSummary,
  MonitoringSummaryInput,
} from '../../contract/monitoring.js';
import { assertNamespaceAccess } from '../../auth.js';

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/**
 * Compact dashboard aggregate for a single workspace. Computed server-side so
 * the wire payload is ~200 B regardless of the underlying data set size.
 *
 * Method: pull workspace runs + tally; for the tasks tally, walk those runs
 * and pull each run's tasks. N+1 today against Firestore; the Postgres era
 * replaces this with `SELECT COUNT(*) ... GROUP BY ...` queries against
 * workspace-scoped partial indexes (PRD §3 endpoint inventory note).
 */
export async function getMonitoringSummary(
  input: MonitoringSummaryInput,
  scope: CallerScope,
): Promise<GetMonitoringSummaryOutput> {
  assertNamespaceAccess(scope.caller, input.handle);
  const handle = input.handle;

  const allRuns = await scope.runs.list({});
  const runs = allRuns.filter((r) => r.namespace === handle && r.deleted !== true);

  const now = Date.now();
  const since24h = now - TWENTY_FOUR_HOURS_MS;
  const runsBucket = {
    running: 0,
    paused: 0,
    completed_24h: 0,
    failed_24h: 0,
    archived_total: 0,
  };
  for (const run of runs) {
    if (run.archived === true) {
      runsBucket.archived_total++;
      continue;
    }
    if (run.status === 'running') runsBucket.running++;
    if (run.status === 'paused') runsBucket.paused++;
    const updatedTs = new Date(run.updatedAt).getTime();
    if (Number.isFinite(updatedTs) && updatedTs >= since24h) {
      if (run.status === 'completed') runsBucket.completed_24h++;
      if (run.status === 'failed') runsBucket.failed_24h++;
    }
  }

  const tasksBucket = { pending: 0, claimed: 0, stuck_count: 0 };
  const roleTally = new Map<string, { pending: number; claimed: number }>();
  for (const run of runs) {
    if (run.archived === true) continue;
    const tasks = await scope.tasks.getByInstanceId(run.id);
    for (const task of tasks) {
      if (task.deleted === true) continue;
      if (task.status === 'pending') {
        tasksBucket.pending++;
        roleBucket(roleTally, task.assignedRole).pending++;
      } else if (task.status === 'claimed') {
        tasksBucket.claimed++;
        roleBucket(roleTally, task.assignedRole).claimed++;
        const updatedTs = new Date(task.updatedAt).getTime();
        if (Number.isFinite(updatedTs) && now - updatedTs > TWENTY_FOUR_HOURS_MS) {
          tasksBucket.stuck_count++;
        }
      }
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
