import type { z } from 'zod';
import type { ListStepAgentRunsInputSchema, ListStepAgentRunsOutput } from '../../contract/evaluation';
import type { CallerScope } from '../../repositories/index';
import { loadEvaluationSubject, stepOnly, subjectRef } from './_lib/evaluation-subject';
import { listStepProductionAgentRunsPage } from './_lib/step-agent-runs';

/** What an author harvests Eval Cases from and a preview runs against. */
export async function listStepAgentRuns(
  input: z.output<typeof ListStepAgentRunsInputSchema>,
  scope: CallerScope,
): Promise<ListStepAgentRunsOutput> {
  await loadEvaluationSubject(scope, input, 'read');
  return listStepProductionAgentRunsPage(scope, stepOnly(subjectRef(input), 'Listing production runs'), input.limit, input.cursor);
}
