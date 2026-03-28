import type { HumanTask, ProcessInstance } from '@mediforce/platform-core';

/** Format a stepId into a human-readable title. */
export function formatStepName(stepId: string): string {
  return stepId
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Check if a task is an agent output review (L3 approval).
 *  Checks multiple signals: completionData.reviewType, completionData.agentOutput,
 *  and the process instance's pauseReason.
 */
export function isAgentReviewTask(
  task: HumanTask,
  instance?: ProcessInstance | null,
): boolean {
  const data = task.completionData as Record<string, unknown> | null;
  // Direct marker from L3 task creation
  if (data?.reviewType === 'agent_output_review') return true;
  // completionData has agentOutput embedded (even without reviewType marker)
  if (data?.agentOutput !== undefined && data.agentOutput !== null) return true;
  // Instance is paused awaiting agent approval on this step
  if (
    instance?.status === 'paused' &&
    instance.pauseReason === 'awaiting_agent_approval' &&
    instance.currentStepId === task.stepId
  ) {
    return true;
  }
  return false;
}

/** Get a display-friendly title for a task. */
export function getTaskDisplayTitle(
  task: HumanTask,
  instance?: ProcessInstance | null,
): string {
  const stepName = formatStepName(task.stepId);
  if (isAgentReviewTask(task, instance)) {
    return `Review: ${stepName}`;
  }
  return stepName;
}

/** Extract the agent output from a task's completionData. */
export function getAgentOutput(task: HumanTask): AgentOutputData | null {
  const data = task.completionData as Record<string, unknown> | null;
  const agentOutput = data?.agentOutput as Record<string, unknown> | undefined;
  if (!agentOutput) return null;

  const rawGit = agentOutput.gitMetadata as Record<string, unknown> | undefined;
  const gitMetadata: GitMetadataData | null =
    rawGit &&
    typeof rawGit.commitSha === 'string' &&
    typeof rawGit.branch === 'string' &&
    Array.isArray(rawGit.changedFiles) &&
    typeof rawGit.repoUrl === 'string'
      ? {
          commitSha: rawGit.commitSha,
          branch: rawGit.branch,
          changedFiles: rawGit.changedFiles as string[],
          repoUrl: rawGit.repoUrl,
        }
      : null;

  return {
    confidence: typeof agentOutput.confidence === 'number' ? agentOutput.confidence : null,
    confidence_rationale: typeof agentOutput.confidence_rationale === 'string' ? agentOutput.confidence_rationale : null,
    reasoning: typeof agentOutput.reasoning === 'string' ? agentOutput.reasoning : null,
    result: (agentOutput.result as Record<string, unknown> | null) ?? null,
    model: typeof agentOutput.model === 'string' ? agentOutput.model : null,
    duration_ms: typeof agentOutput.duration_ms === 'number' ? agentOutput.duration_ms : null,
    gitMetadata,
    presentation: typeof agentOutput.presentation === 'string' ? agentOutput.presentation : null,
  };
}

/** Find agent output from sibling tasks for the same step. */
export function getAgentOutputFromSiblings(
  task: HumanTask,
  siblingTasks: HumanTask[],
): AgentOutputData | null {
  // Look for a sibling task with the same stepId that has agent output
  for (const sibling of siblingTasks) {
    if (sibling.id === task.id) continue;
    if (sibling.stepId !== task.stepId) continue;
    const output = getAgentOutput(sibling);
    if (output) return output;
  }
  return null;
}

export interface GitMetadataData {
  commitSha: string;
  branch: string;
  changedFiles: string[];
  repoUrl: string;
}

export interface AgentOutputData {
  confidence: number | null;
  confidence_rationale: string | null;
  reasoning: string | null;
  result: Record<string, unknown> | null;
  model: string | null;
  duration_ms: number | null;
  gitMetadata: GitMetadataData | null;
  presentation: string | null;
}
