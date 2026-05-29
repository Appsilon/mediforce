import type { WaitActionConfig } from '@mediforce/platform-core';
import type { WaitActionHandler } from '../types.js';
import { interpolate } from '../interpolation.js';

export interface WaitActionOutput {
  resumeReason: 'deadline_reached' | 'duration_elapsed' | 'condition_met';
  waitedSeconds: number;
  resolvedAt: string;
}

export interface WaitSentinel {
  [key: string]: unknown;
  __wait: {
    stepId: string;
    resumeAt: string;
    pausedAt: string;
    mode: 'duration' | 'deadline';
    condition?: string;
  };
}

export function isWaitSentinel(output: Record<string, unknown>): output is WaitSentinel {
  const w = output.__wait;
  if (w === null || typeof w !== 'object') return false;
  const r = w as Record<string, unknown>;
  return (
    typeof r.stepId === 'string' &&
    typeof r.resumeAt === 'string' &&
    typeof r.pausedAt === 'string'
  );
}

export const waitActionHandler: WaitActionHandler = async (config, ctx) => {
  const now = new Date();
  const sources = ctx.sources;
  const resolvedDeadline = config.deadline
    ? String(interpolate(config.deadline, sources))
    : undefined;
  const resolvedCondition = config.condition
    ? String(interpolate(config.condition, sources))
    : undefined;

  if (config.duration) {
    const { seconds = 0, minutes = 0, hours = 0 } = config.duration;
    const totalMs = ((hours * 60 + minutes) * 60 + seconds) * 1000;
    const resumeAt = new Date(now.getTime() + totalMs);

    return {
      __wait: {
        stepId: ctx.stepId,
        resumeAt: resumeAt.toISOString(),
        pausedAt: now.toISOString(),
        mode: 'duration' as const,
        ...(resolvedCondition ? { condition: resolvedCondition } : {}),
      },
    };
  }

  const deadline = resolvedDeadline ?? config.deadline!;
  const parsed = new Date(deadline);
  if (isNaN(parsed.getTime())) {
    throw new Error(`Invalid deadline: '${deadline}'`);
  }

  if (parsed <= now) {
    return {
      resumeReason: 'deadline_reached' as const,
      waitedSeconds: 0,
      resolvedAt: now.toISOString(),
    };
  }

  return {
    __wait: {
      stepId: ctx.stepId,
      resumeAt: parsed.toISOString(),
      pausedAt: now.toISOString(),
      mode: 'deadline' as const,
      ...(resolvedCondition ? { condition: resolvedCondition } : {}),
    },
  };
};
