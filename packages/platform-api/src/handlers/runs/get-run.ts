import type { CallerScope } from '../../repositories/index';
import { NotFoundError } from '../../errors';
import type { GetRunInput, GetRunOutput } from '../../contract/runs';
import type { InstanceStatus } from '@mediforce/platform-core';

/**
 * Fetch one run by id. Out-of-scope ids surface as 404 (anti-enumeration —
 * same shape as a truly missing run, so non-members cannot probe ownership).
 *
 * `finalOutput` resolves to the most recent step execution's output once the
 * run is terminal (completed / failed); null while it's still active.
 *
 * `definitionNamespace` enriches the response with the workspace handle that
 * owns the workflow definition, letting clients build human-facing URLs in
 * one round-trip. Best-effort: a missing or invisible definition collapses
 * to `null`.
 */
export async function getRun(
  input: GetRunInput,
  scope: CallerScope,
): Promise<GetRunOutput> {
  const run = await scope.runs.getById(input.runId);
  if (run === null) {
    throw new NotFoundError(`Run ${input.runId} not found`);
  }

  const finalOutput = await resolveFinalOutput(run.status, input.runId, scope);
  const definitionNamespace = await resolveDefinitionNamespace(run, scope);

  return {
    runId: run.id,
    status: run.status,
    currentStepId: run.currentStepId,
    error: run.error,
    finalOutput,
    definitionName: run.definitionName,
    definitionNamespace,
    ...(run.totalCostUsd != null ? { totalCostUsd: run.totalCostUsd } : {}),
  };
}

async function resolveFinalOutput(
  status: InstanceStatus,
  runId: string,
  scope: CallerScope,
): Promise<unknown> {
  if (status !== 'completed' && status !== 'failed') return null;
  const executions = await scope.runs.getStepExecutions(runId);
  // Why: walk in reverse insertion order — repository preserves execution
  // order, and timestamp-based sort is unreliable when chained actions
  // complete inside the same millisecond.
  for (let i = executions.length - 1; i >= 0; i--) {
    const exec = executions[i];
    if (exec.status === 'completed' && exec.output !== null && exec.output !== undefined) {
      return exec.output;
    }
  }
  return null;
}

async function resolveDefinitionNamespace(
  run: { namespace?: string; definitionName: string; definitionVersion: string },
  scope: CallerScope,
): Promise<string | null> {
  const versionNumber = Number(run.definitionVersion);
  if (!Number.isInteger(versionNumber) || versionNumber <= 0) return null;
  const def = await scope.workflowDefinitions.get(
    run.namespace ?? '',
    run.definitionName,
    versionNumber,
  );
  return def?.namespace ?? null;
}
