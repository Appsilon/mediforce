import type { z } from 'zod';
import type { EvalCase, EvaluatedStep } from '@mediforce/platform-core';
import type { PreviewEvaluatorInputSchema, PreviewEvaluatorOutput } from '../../contract/evaluation';
import type { CallerScope } from '../../repositories/index';
import { NotFoundError, ValidationError } from '../../errors';
import { loadEvaluationSubject, stepOnly, subjectRef } from './_lib/evaluation-subject';
import { loadScoredRun } from './_lib/scored-run';
import { producedResult, runEvaluatorCheck } from './_lib/run-evaluator-check';
import { listStepProductionAgentRuns } from './_lib/step-agent-runs';

type TriedCase = EvalCase & { sourceAgentRunId: string; expectedOutput: Record<string, unknown> };

/** An Agent evaluated on its own (ADR-0029) has no production outputs; a check is first tried in its Eval Run. */
export const AGENT_NOT_PREVIEWED = 'An agent evaluated on its own has no production outputs to try a check on; the check is first tried in its next Eval Run.';

/** The Evaluation Assistant proposes a judge untried; a person may still preview one. */
export const JUDGE_NOT_PREVIEWED = 'A judge is not tried before it is proposed: a couple of outputs say little of how it judges. Try it in a small Eval Run.';

export const EXPECTED_OUTPUT_NOT_PREVIEWED = 'An expected-output check compares an Eval Case trial\'s output with the case\'s expected output; a production output has none, so it cannot be tried on one.';

/**
 * The Step's cases a check is tried on as outputs: ones taken from a run on
 * its own input, with an expected output to stand in for the run's result. The
 * expectation is left aside — it is what an expected-output check grades by,
 * not a verdict this check must reach.
 */
async function casesToTry(scope: CallerScope, step: EvaluatedStep, limit: number): Promise<TriedCase[]> {
  return (await scope.evaluation.listCases({ kind: 'step', ...step }))
    .filter((evalCase): evalCase is TriedCase =>
      evalCase.archived === false
      && evalCase.source === 'production'
      && evalCase.sourceAgentRunId !== null
      && typeof evalCase.expectedOutput === 'object'
      && evalCase.expectedOutput !== null
      && Array.isArray(evalCase.expectedOutput) === false)
    .slice(0, limit);
}

/**
 * Runs a draft check against existing outputs of the Step and writes nothing —
 * no Score, no Evaluator (ADR-0023 D14 `preview_evaluator`). This is how the
 * Evaluation Assistant sees a check fail on real outputs before it proposes
 * it, and how a person tries one before saving it. The Step's Eval Cases come
 * first; its latest production runs that gave a result — other than the ones
 * those cases were taken from — fill the rest.
 */
export async function previewEvaluator(
  input: z.output<typeof PreviewEvaluatorInputSchema>,
  scope: CallerScope,
): Promise<PreviewEvaluatorOutput> {
  const step = stepOnly(subjectRef(input), 'A preview');
  await loadEvaluationSubject(scope, step, 'run');
  if (input.check.kind === 'expected_output') throw new ValidationError(EXPECTED_OUTPUT_NOT_PREVIEWED);

  const cases: PreviewEvaluatorOutput['cases'] = [];
  for (const evalCase of input.agentRunIds === undefined ? await casesToTry(scope, step, input.limit) : []) {
    // A case outlives the run it was taken from; one whose run is gone has nothing to grade it as.
    const source = await loadScoredRun(scope, evalCase.sourceAgentRunId, step).catch((err: unknown) => {
      if (err instanceof NotFoundError) return null;
      throw err;
    });
    const envelope = source?.agentRun.envelope ?? null;
    if (source === null || envelope === null) continue;
    const subject = { ...source, agentRun: { ...source.agentRun, envelope: { ...envelope, result: evalCase.expectedOutput } } };
    cases.push({ ...await runEvaluatorCheck(scope, input.check, subject, evalCase), caseId: evalCase.id, caseName: evalCase.name });
  }

  const caseSources = new Set(cases.map((outcome) => outcome.agentRunId));
  const agentRunIds = input.agentRunIds ?? (input.limit === cases.length ? [] : (await listStepProductionAgentRuns(
    scope,
    step,
    input.limit - cases.length,
    (run) => producedResult(run) && caseSources.has(run.id) === false,
  )).map((run) => run.id));
  const results: PreviewEvaluatorOutput['results'] = [];
  for (const agentRunId of agentRunIds) {
    const subject = await loadScoredRun(scope, agentRunId, step);
    results.push(await runEvaluatorCheck(scope, input.check, subject, null));
  }
  return { cases, results };
}
