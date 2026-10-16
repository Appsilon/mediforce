'use client';

import { useQuery } from '@tanstack/react-query';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { stopRetryOn4xx } from '@/lib/retry';
import { useWorkflowEditGate, useWorkflowRunGate } from './use-workflow-access';

/** Whether the caller may change an Evaluation and start its Eval Runs, and what to say when not. */
export interface EvaluationGates {
  readonly mayEdit: boolean;
  readonly editReason: string | undefined;
  readonly mayRun: boolean;
  readonly runReason: string | undefined;
}

/** A Step's Evaluation follows its workflow's `edit` and `run` verbs (ADR-0019). */
export function useWorkflowEvaluationGates(handle: string, workflowName: string): EvaluationGates {
  const { mayEdit, reason: editReason } = useWorkflowEditGate(handle, workflowName);
  const { mayRun, reason: runReason } = useWorkflowRunGate(handle, workflowName);
  return { mayEdit, editReason, mayRun, runReason };
}

/**
 * An Agent's Evaluation (ADR-0029) is changed and run by whoever may change the
 * Agent: a member of the workspace it belongs to.
 */
export function useAgentEvaluationGates(handle: string, agentId: string): EvaluationGates {
  const agent = useQuery({
    queryKey: queryKeys.agentDefinition(agentId),
    queryFn: () => mediforce.agents.get({ id: agentId }),
    retry: stopRetryOn4xx,
  });
  const owned = agent.data === undefined || agent.data.agent.namespace === handle;
  const reason = owned ? undefined : 'This agent belongs to another workspace';
  return { mayEdit: owned, editReason: reason, mayRun: owned, runReason: reason };
}
