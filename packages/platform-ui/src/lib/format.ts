import type { StepExecution } from '@mediforce/platform-core';

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}

export function formatStepName(stepId: string): string {
  return stepId
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function computeWallClockDuration(
  createdAt: string,
  stepExecutions: StepExecution[],
): number | null {
  let latestCompletedAt: number | null = null;

  for (const step of stepExecutions) {
    if (step.completedAt !== null) {
      const completedTime = new Date(step.completedAt).getTime();
      if (latestCompletedAt === null || completedTime > latestCompletedAt) {
        latestCompletedAt = completedTime;
      }
    }
  }

  if (latestCompletedAt === null) {
    return null;
  }

  return latestCompletedAt - new Date(createdAt).getTime();
}

export function computeActiveProcessingTime(
  stepExecutions: StepExecution[],
): number {
  let total = 0;

  for (const step of stepExecutions) {
    if (step.completedAt !== null) {
      const started = new Date(step.startedAt).getTime();
      const completed = new Date(step.completedAt).getTime();
      total += completed - started;
    }
  }

  return total;
}
