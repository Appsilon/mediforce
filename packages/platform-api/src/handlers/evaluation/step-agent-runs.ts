import type { z } from 'zod';
import type { ListStepAgentRunsInputSchema, ListStepAgentRunsOutput } from '../../contract/evaluation';
import type { CallerScope } from '../../repositories/index';
import { loadEvaluatedStep, stepRef } from './_lib/evaluated-step';
import { listStepProductionAgentRuns } from './_lib/step-agent-runs';

/** What an author harvests Eval Cases from and a preview runs against. */
export async function listStepAgentRuns(
  input: z.output<typeof ListStepAgentRunsInputSchema>,
  scope: CallerScope,
): Promise<ListStepAgentRunsOutput> {
  await loadEvaluatedStep(scope, input, 'read');
  return { runs: await listStepProductionAgentRuns(scope, stepRef(input), input.limit) };
}
