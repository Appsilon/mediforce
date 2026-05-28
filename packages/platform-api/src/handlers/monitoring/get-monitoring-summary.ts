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
 * Method: pull workspace runs in one indexed query, then pull every task
 * whose parent is in the run set in a single chunked `in`-query bulk
 * fetch, then tally in JS. The Postgres era replaces both calls with
 * `SELECT COUNT(*) ... GROUP BY ...` against workspace-scoped partial
 * indexes (PRD §3 endpoint inventory note).
 */
export async function getMonitoringSummary(
  input: MonitoringSummaryInput,
  scope: CallerScope,
): Promise<GetMonitoringSummaryOutput> {
  assertNamespaceAccess(scope.caller, input.handle);
  const handle = input.handle;

  // Namespace filter is pushed into the repo so Firestore returns the
  // workspace's slice directly off the
  // `(namespace, deleted, createdAt DESC)` composite index instead of
  // streaming up to 10k cross-workspace docs for a JS-side filter. The
  // 10_000 ceiling stays as a defence in depth; in practice a workspace
  // is in the low hundreds.
  const runs = await scope.runs.list({ namespace: handle, limit: 10_000 });

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
  const activeRunIds = runs
    .filter((r) => r.archived !== true)
    .map((r) => r.id);
  const tasks = await scope.tasks.getByInstanceIds(activeRunIds);
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
