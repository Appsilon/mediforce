import type { HumanTask, ProcessInstance, Presentation } from '@mediforce/platform-core';
export { formatStepName } from '@/lib/format';
import { formatStepName } from '@/lib/format';

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

  const escalationReason = agentOutput.escalationReason;
  const normalizedEscalation: EscalationReason =
    escalationReason === 'low_confidence' ||
    escalationReason === 'timeout' ||
    escalationReason === 'error' ||
    escalationReason === 'iterations_limit'
      ? escalationReason
      : null;

  const rawTokenUsage = agentOutput.tokenUsage as Record<string, unknown> | undefined;
  const tokenUsage: TokenUsageData | null =
    rawTokenUsage &&
    typeof rawTokenUsage.inputTokens === 'number' &&
    typeof rawTokenUsage.outputTokens === 'number'
      ? { inputTokens: rawTokenUsage.inputTokens, outputTokens: rawTokenUsage.outputTokens }
      : null;

  return {
    confidence: typeof agentOutput.confidence === 'number' ? agentOutput.confidence : null,
    confidence_rationale: typeof agentOutput.confidence_rationale === 'string' ? agentOutput.confidence_rationale : null,
    reasoning: typeof agentOutput.reasoning === 'string' ? agentOutput.reasoning : null,
    result: (agentOutput.result as Record<string, unknown> | null) ?? null,
    model: typeof agentOutput.model === 'string' ? agentOutput.model : null,
    duration_ms: typeof agentOutput.duration_ms === 'number' ? agentOutput.duration_ms : null,
    estimatedCostUsd: typeof agentOutput.estimatedCostUsd === 'number' ? agentOutput.estimatedCostUsd : null,
    tokenUsage,
    gitMetadata,
    presentation: normalizePresentation(agentOutput.presentation),
    escalationReason: normalizedEscalation,
  };
}

/** Map a stored `presentation` field into the discriminated shape the UI
 *  branches on. Legacy Firestore rows have `presentation: string` (always
 *  HTML); newer rows carry `{kind, content}`. Unknown shapes return null
 *  so the UI silently drops malformed data instead of crashing. */
export function normalizePresentation(value: unknown): Presentation | null {
  if (typeof value === 'string') {
    return value.length > 0 ? { kind: 'html', content: value } : null;
  }
  if (value !== null && typeof value === 'object') {
    const candidate = value as { kind?: unknown; content?: unknown };
    if (
      (candidate.kind === 'markdown' || candidate.kind === 'html') &&
      typeof candidate.content === 'string' &&
      candidate.content.length > 0
    ) {
      return { kind: candidate.kind, content: candidate.content };
    }
  }
  return null;
}

export interface GitMetadataData {
  commitSha: string;
  branch: string;
  changedFiles: string[];
  repoUrl: string;
}

export interface TokenUsageData {
  inputTokens: number;
  outputTokens: number;
}

export type EscalationReason = 'low_confidence' | 'timeout' | 'error' | 'iterations_limit' | null;

export interface AgentOutputData {
  confidence: number | null;
  confidence_rationale: string | null;
  reasoning: string | null;
  result: Record<string, unknown> | null;
  model: string | null;
  duration_ms: number | null;
  estimatedCostUsd: number | null;
  tokenUsage: TokenUsageData | null;
  gitMetadata: GitMetadataData | null;
  presentation: Presentation | null;
  escalationReason: EscalationReason;
}
