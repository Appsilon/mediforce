import type { GetStepSampleIoInput, GetStepSampleIoOutput } from '../../contract/workflows';
import type { CallerScope } from '../../repositories/index';

// Newest-first instances scanned looking for any attempt at the requested
// step. Bounded rather than exhaustive: a handful of recent runs is enough
// to find a live example without an unbounded namespace scan.
const SCAN_LIMIT = 10;

/**
 * Real input/output JSON from `stepId`'s best available attempt, for the
 * step editor's Data Flow panel. Scans a bounded window of recent instances
 * (newest first) and prefers the newest *real* completed run — a genuinely
 * successful, non-dry-run attempt — over a more recent dry run or failure.
 * Without that preference, a routine "Save & Dry Run" click after a real
 * successful run would shadow the real output with a dry run's fake one
 * simply for being newer.
 *
 * When no real completed run exists in the window, falls back to the
 * newest attempt of any kind so there's still something to show: `input`
 * (always the previous step's real output, independent of how this step
 * then fared) and `error` (if it failed). `output` stays withheld there —
 * withheld for a dry run because dry runs swap in `MockAgentPlugin` for
 * every executor including script-container, so a dry run's "output" is a
 * canned mock envelope, not the author's real result.json shape; withheld
 * for a failure because there is none.
 */
export async function getStepSampleIo(
  input: GetStepSampleIoInput,
  scope: CallerScope,
): Promise<GetStepSampleIoOutput> {
  const { items } = await scope.runs.listPage({
    definitionName: input.name,
    namespace: input.namespace,
    limit: SCAN_LIMIT,
  });

  let fallback: GetStepSampleIoOutput | null = null;

  for (const instance of items) {
    const execution = await scope.runs.getLatestStepExecution(instance.id, input.stepId);
    if (execution === null) continue;

    const fromDryRun = instance.dryRun === true;
    const isRealSuccess = execution.status === 'completed' && !fromDryRun;
    const candidate: GetStepSampleIoOutput = {
      input: execution.input,
      output: isRealSuccess ? execution.output : null,
      instanceId: instance.id,
      completedAt: execution.completedAt,
      status: execution.status,
      error: execution.error,
      fromDryRun,
    };

    if (isRealSuccess) return candidate;
    fallback ??= candidate;
  }

  return fallback ?? {
    input: null,
    output: null,
    instanceId: null,
    completedAt: null,
    status: null,
    error: null,
    fromDryRun: false,
  };
}
