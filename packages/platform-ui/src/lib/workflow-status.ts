export type WorkflowDisplayStatus = 'in_progress' | 'waiting_for_human' | 'error' | 'completed';

export interface WorkflowStatus {
  displayStatus: WorkflowDisplayStatus;
  /**
   * Human-readable description of the current state. Null when no additional context is needed
   * (e.g. in_progress or completed). For waiting/error states, describes the specific reason.
   *
   * To add context to a new pause reason: return it as a `reason` string here rather than
   * introducing a new `displayStatus` value. The four display statuses intentionally cover all
   * semantic states; reasons provide the detail.
   */
  reason: string | null;
  /**
   * Raw `pauseReason` from storage. Use only for feature-specific branching that requires the
   * exact reason (e.g. routing to the active task link vs. the cowork session link). Prefer
   * `displayStatus` and `reason` for all other UI logic.
   */
  rawReason: string | null;
  /** True when the user can trigger "Run again this step" to restart from this error state. */
  isRetryable: boolean;
}

export function getWorkflowStatus(instance: {
  status: string;
  pauseReason?: string | null;
  error?: string | null;
}): WorkflowStatus {
  const pauseReason = instance.pauseReason ?? null;
  const error = instance.error ?? null;

  if (instance.status === 'completed') {
    return { displayStatus: 'completed', reason: null, rawReason: null, isRetryable: false };
  }

  if (instance.status === 'running' || instance.status === 'created') {
    return { displayStatus: 'in_progress', reason: null, rawReason: null, isRetryable: false };
  }

  if (instance.status === 'paused') {
    switch (pauseReason) {
      case 'waiting_for_human':
        return { displayStatus: 'waiting_for_human', reason: 'Waiting for human task', rawReason: pauseReason, isRetryable: false };
      case 'awaiting_agent_approval':
        return { displayStatus: 'waiting_for_human', reason: 'Waiting for agent approval review', rawReason: pauseReason, isRetryable: false };
      case 'cowork_in_progress':
        return { displayStatus: 'waiting_for_human', reason: 'Cowork session in progress', rawReason: pauseReason, isRetryable: false };
      case 'agent_escalated':
        return { displayStatus: 'waiting_for_human', reason: 'Agent escalated to human review', rawReason: pauseReason, isRetryable: true };
      case 'agent_paused':
        return { displayStatus: 'waiting_for_human', reason: 'Agent requested human review', rawReason: pauseReason, isRetryable: true };
      case 'missing_env':
        return { displayStatus: 'error', reason: 'Missing environment configuration', rawReason: pauseReason, isRetryable: false };
      case 'step_failure':
        return { displayStatus: 'error', reason: error ?? 'Step execution failed', rawReason: pauseReason, isRetryable: true };
      case 'routing_error':
        return { displayStatus: 'error', reason: 'Workflow routing error', rawReason: pauseReason, isRetryable: true };
      case 'max_iterations_exceeded':
        return { displayStatus: 'error', reason: 'Maximum review iterations exceeded', rawReason: pauseReason, isRetryable: false };
      default:
        return { displayStatus: 'error', reason: pauseReason ?? 'Workflow stopped unexpectedly', rawReason: pauseReason, isRetryable: false };
    }
  }

  if (instance.status === 'failed') {
    // cancelProcessRun sets error='Cancelled by user' — the user intentionally stopped the run,
    // so retry should not be offered. All other failed states are retryable.
    const isCancelled = error === 'Cancelled by user';
    return { displayStatus: 'error', reason: error ?? 'Process failed', rawReason: null, isRetryable: !isCancelled };
  }

  return { displayStatus: 'error', reason: `Unknown status: ${instance.status}`, rawReason: null, isRetryable: false };
}
