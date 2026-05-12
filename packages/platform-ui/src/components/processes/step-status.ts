import type { ProcessInstance, StepExecution, Step } from '@mediforce/platform-core';
import { getWorkflowStatus } from '@/lib/workflow-status';

export type EffectiveStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'waiting'
  | 'awaiting_approval';

export function getEffectiveStatus(
  step: Step,
  instance: ProcessInstance,
  stepExecutions: StepExecution[],
): EffectiveStatus {
  const execs = stepExecutions
    .filter((e) => e.stepId === step.id)
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

  const exec = execs[0];

  const isCurrent = instance.currentStepId === step.id;
  const wf = getWorkflowStatus(instance);
  const isWaiting = wf.displayStatus === 'waiting_for_human';
  const waitingKind: EffectiveStatus =
    wf.rawReason === 'awaiting_agent_approval' ? 'awaiting_approval' : 'waiting';

  if (exec) {
    if (exec.status === 'running' || exec.status === 'pending') {
      if (isCurrent && isWaiting) return waitingKind;
      return 'running';
    }
    if (exec.status === 'completed') {
      if (isCurrent && isWaiting) return waitingKind;
      return 'completed';
    }
    if (exec.status === 'escalated' || exec.status === 'paused') return 'waiting';
    if (exec.status === 'failed') return 'failed';
  }

  if (isCurrent) {
    if (isWaiting) return waitingKind;
    if (instance.status === 'running') return 'running';
  }

  return 'pending';
}
