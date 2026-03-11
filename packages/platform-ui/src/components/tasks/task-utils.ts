import type { HumanTask } from '@mediforce/platform-core';

/** Format a stepId into a human-readable title. */
export function formatStepName(stepId: string): string {
  return stepId
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Check if a task is an agent output review (L3 approval). */
export function isAgentReviewTask(task: HumanTask): boolean {
  const data = task.completionData as Record<string, unknown> | null;
  return data?.reviewType === 'agent_output_review';
}

/** Get a display-friendly title for a task. */
export function getTaskDisplayTitle(task: HumanTask): string {
  const stepName = formatStepName(task.stepId);
  if (isAgentReviewTask(task)) {
    return `Review: ${stepName}`;
  }
  return stepName;
}

/** Extract the agent output from a review task's completionData. */
export function getAgentOutput(task: HumanTask): AgentOutputData | null {
  if (!isAgentReviewTask(task)) return null;
  const data = task.completionData as Record<string, unknown> | null;
  const agentOutput = data?.agentOutput as Record<string, unknown> | undefined;
  if (!agentOutput) return null;
  return {
    confidence: typeof agentOutput.confidence === 'number' ? agentOutput.confidence : null,
    reasoning: typeof agentOutput.reasoning === 'string' ? agentOutput.reasoning : null,
    result: (agentOutput.result as Record<string, unknown> | null) ?? null,
    model: typeof agentOutput.model === 'string' ? agentOutput.model : null,
    duration_ms: typeof agentOutput.duration_ms === 'number' ? agentOutput.duration_ms : null,
  };
}

export interface AgentOutputData {
  confidence: number | null;
  reasoning: string | null;
  result: Record<string, unknown> | null;
  model: string | null;
  duration_ms: number | null;
}
