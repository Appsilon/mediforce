import { invalidTimeoutMessage, parseIsoDurationMs } from '@mediforce/platform-core';
import { interpolate } from '../interpolation';
import type { RunWorkflowActionHandler } from '../types';
import type { SpawnChildren } from './spawn';
import type { WaitSentinel } from './wait';

/**
 * Spawn one child, then park the run on it: the `__wait` sentinel carries the
 * child's id, so `resumeWait` resolves the step with exactly that child's
 * result once it ends or the timeout passes — never a sibling a loop spawned
 * on an earlier pass, which is what `collect` would hand back.
 */
export function createRunWorkflowActionHandler(spawn: SpawnChildren): RunWorkflowActionHandler {
  return async (config, ctx) => {
    const timeout = String(interpolate(config.timeout, ctx.sources));
    const timeoutMs = parseIsoDurationMs(timeout);
    const now = new Date();
    // An oversized duration parses but lands past the Date range; reject it
    // here, before the child is spawned, not at toISOString() after.
    const resumeAt = new Date(now.getTime() + (timeoutMs ?? Number.NaN));
    if (timeoutMs === null || timeoutMs === 0 || Number.isNaN(resumeAt.getTime())) {
      throw new Error(invalidTimeoutMessage(timeout));
    }

    const { timeout: _timeout, step, ...target } = config;
    const spawned = await spawn({ targets: target, continueOnSpawnError: false }, ctx);
    const [child] = spawned.spawned;
    if (child === undefined) {
      throw new Error(`workflow '${config.definitionName}' was not started`);
    }

    const sentinel: WaitSentinel = {
      __wait: {
        stepId: ctx.stepId,
        resumeAt: resumeAt.toISOString(),
        pausedAt: now.toISOString(),
        mode: 'deadline',
        child: {
          instanceId: child.instanceId,
          definitionName: child.definitionName,
          ...(step !== undefined ? { step } : {}),
        },
      },
    };
    return sentinel;
  };
}
