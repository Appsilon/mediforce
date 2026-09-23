import type { z } from 'zod';
import type { PreviewEvaluatorInputSchema, PreviewEvaluatorOutput } from '../../contract/evaluation';
import type { CallerScope } from '../../repositories/index';
import { loadEvaluatedStep, stepRef } from './_lib/evaluated-step';
import { loadEvaluationSubject } from './_lib/evaluation-subject';
import { runEvaluatorCheck } from './_lib/run-evaluator-check';
import { listStepProductionAgentRuns } from './_lib/step-agent-runs';

/**
 * Runs a draft check against existing outputs of the Step and writes nothing —
 * no Score, no Evaluator (ADR-0023 D14 `preview_evaluator`). This is how the
 * Evaluation Assistant sees a check fail on real outputs before it proposes
 * it, and how a person tries one before saving it.
 */
export async function previewEvaluator(
  input: z.output<typeof PreviewEvaluatorInputSchema>,
  scope: CallerScope,
): Promise<PreviewEvaluatorOutput> {
  const step = stepRef(input);
  await loadEvaluatedStep(scope, step, 'read');
  const agentRunIds = input.agentRunIds
    ?? (await listStepProductionAgentRuns(scope, step, input.limit)).map((run) => run.id);

  const results: PreviewEvaluatorOutput['results'] = [];
  for (const agentRunId of agentRunIds) {
    const subject = await loadEvaluationSubject(scope, agentRunId, step);
    results.push(await runEvaluatorCheck(scope, input.check, subject, null));
  }
  return { results };
}
