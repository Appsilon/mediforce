import type { InstanceStatus, ProcessInstanceRepository } from '@mediforce/platform-core';
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

/**
 * The read half of spawn + wait: hands the parent what its children produced.
 * Read on demand from the children themselves, so nothing is ever written into
 * the parent when a child finishes. Children that failed or are still running
 * are listed with their status and a `null` output when the step never ran —
 * the next step decides what a partial result means.
 */
export function createCollectActionHandler(
  instanceRepo: Pick<ProcessInstanceRepository, 'getChildren'>,
): CollectActionHandler {
  return async (config, ctx) => {
    const runs = await instanceRepo.getChildren(ctx.processInstanceId);
    const children: CollectedChild[] = runs.map((run) => ({
      instanceId: run.id,
      definitionName: run.definitionName,
      status: run.status,
      error: run.error ?? null,
      output: config.step === undefined ? run.variables : (run.variables[config.step] ?? null),
    }));
    const output: CollectActionOutput = {
      children,
      count: children.length,
      completedCount: children.filter((child) => child.status === 'completed').length,
      failedCount: children.filter((child) => child.status === 'failed').length,
    };
    return output;
  };
}
