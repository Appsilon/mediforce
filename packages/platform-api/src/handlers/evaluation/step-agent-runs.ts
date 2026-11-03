import type { z } from 'zod';
import type { ListAgentProductionRunsInputSchema, ListAgentProductionRunsOutput, ListStepAgentRunsInputSchema, ListStepAgentRunsOutput } from '../../contract/evaluation';
import type { CallerScope } from '../../repositories/index';
import { loadEvaluationSubject, stepOnly, subjectRef } from './_lib/evaluation-subject';
import { listAgentProductionRuns } from './_lib/agent-production-runs';
import { listStepProductionAgentRunsPage } from './_lib/step-agent-runs';

/** What an author harvests Eval Cases from and a preview runs against. */
export async function listStepAgentRuns(
  input: z.output<typeof ListStepAgentRunsInputSchema>,
  scope: CallerScope,
): Promise<ListStepAgentRunsOutput> {
  await loadEvaluationSubject(scope, input, 'read');
  return listStepProductionAgentRunsPage(scope, stepOnly(subjectRef(input), 'Listing production runs'), input.limit, input.cursor);
}

/** What an author starts an Agent's Eval Cases from: the runs of the Steps that use it, each with what its Step changes about it. */
export async function listAgentProductionRunsPage(
  input: z.output<typeof ListAgentProductionRunsInputSchema>,
  scope: CallerScope,
): Promise<ListAgentProductionRunsOutput> {
  await loadEvaluationSubject(scope, { namespace: input.namespace, agentId: input.agentId }, 'read');
  const offset = input.cursor === undefined ? 0 : Number(input.cursor);
  const { runs, hasMore } = await listAgentProductionRuns(scope, { kind: 'agent', namespace: input.namespace, agentId: input.agentId }, input.limit, offset);
  return {
    runs: runs.map(({ agentRun, change, instance }) => ({
      // What a run answered under another output schema is no case's to use (ADR-0031 D4).
      agentRun: change.outputSchemaDiffers ? { ...agentRun, envelope: null } : agentRun,
      change,
      workflowRunStatus: instance.status,
    })),
    ...(hasMore ? { nextCursor: String(offset + input.limit) } : {}),
  };
}
