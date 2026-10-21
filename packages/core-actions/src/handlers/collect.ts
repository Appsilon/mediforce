import type { InstanceStatus, ProcessInstance, ProcessInstanceRepository } from '@mediforce/platform-core';
import type { CollectActionHandler } from '../types';

export interface CollectedChild {
  instanceId: string;
  definitionName: string;
  status: InstanceStatus;
  error: string | null;
  output: unknown;
}

export interface CollectActionOutput {
  children: CollectedChild[];
  count: number;
  completedCount: number;
  failedCount: number;
  [key: string]: unknown;
}

/** One child's result: `output` is its `variables[step]` (all of its
 *  variables when no step is named, `null` when that step never ran). */
export function toCollectedChild(run: ProcessInstance, step: string | undefined): CollectedChild {
  return {
    instanceId: run.id,
    definitionName: run.definitionName,
    status: run.status,
    error: run.error ?? null,
    output: step === undefined ? run.variables : (run.variables[step] ?? null),
  };
}

/**
 * The read half of spawn + wait: hands the parent what its children produced.
 * Read on demand from the children themselves, so nothing is ever written into
 * the parent when a child finishes. Children that failed or are still running
 * are listed with their status and a `null` output when the step never ran —
 * the next step decides what a partial result means.
 */
export function createCollectActionHandler(
  instanceRepo: Pick<ProcessInstanceRepository, 'getChildrenAll'>,
): CollectActionHandler {
  return async (config, ctx) => {
    const runs = await instanceRepo.getChildrenAll(ctx.processInstanceId);
    const children = runs.map((run) => toCollectedChild(run, config.step));
    const output: CollectActionOutput = {
      children,
      count: children.length,
      completedCount: children.filter((child) => child.status === 'completed').length,
      failedCount: children.filter((child) => child.status === 'failed').length,
    };
    return output;
  };
}
