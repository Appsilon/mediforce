import type { StepExecution } from '@mediforce/platform-core';

export { formatBytes } from '@mediforce/platform-core';

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}

export function formatCostUsd(cost: number): string {
  if (cost === 0) return '$0.00';
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}

export function formatStepName(stepId: string): string {
  return stepId
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function deriveInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  const first = words[0]?.[0] ?? '';
  const last = words.length > 1 ? words[words.length - 1]![0] ?? '' : '';
  return (first + last).toUpperCase();
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
