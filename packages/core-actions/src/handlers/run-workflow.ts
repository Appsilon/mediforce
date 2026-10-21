import { parseIsoDurationMs } from '@mediforce/platform-core';
import { interpolate } from '../interpolation';
import type { RunWorkflowActionHandler, SpawnActionHandler } from '../types';
import type { SpawnActionOutput } from './spawn';
import type { WaitSentinel } from './wait';

/**
 * Spawn one child, then park the run on it: the `__wait` sentinel carries the
 * child's id, so `resumeWait` resolves the step with exactly that child's
 * result once it ends or the timeout passes — never a sibling a loop spawned
 * on an earlier pass, which is what `collect` would hand back.
 */
export function createRunWorkflowActionHandler(spawn: SpawnActionHandler): RunWorkflowActionHandler {
  return async (config, ctx) => {
    const timeout = String(interpolate(config.timeout, ctx.sources));
    const timeoutMs = parseIsoDurationMs(timeout);
    if (timeoutMs === null || timeoutMs === 0) {
      throw new Error(`timeout must be an ISO 8601 duration greater than zero (e.g. P14D, PT2H), got '${timeout}'`);
    }

    const { timeout: _timeout, step, ...target } = config;
    const spawned = (await spawn({ targets: target, continueOnSpawnError: false }, ctx)) as SpawnActionOutput;
    const [child] = spawned.spawned;
    if (child === undefined) {
      throw new Error(`workflow '${config.definitionName}' was not started`);
    }

    const now = new Date();
    const sentinel: WaitSentinel = {
      __wait: {
        stepId: ctx.stepId,
        resumeAt: new Date(now.getTime() + timeoutMs).toISOString(),
        pausedAt: now.toISOString(),
        mode: 'deadline',
        child: { instanceId: child.instanceId, ...(step !== undefined ? { step } : {}) },
      },
    };
    return sentinel;
  };
}
