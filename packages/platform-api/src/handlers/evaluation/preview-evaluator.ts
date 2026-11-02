import type { z } from 'zod';
import type { EvalCase, EvaluationSubject } from '@mediforce/platform-core';
import type { PreviewEvaluatorInputSchema, PreviewEvaluatorOutput } from '../../contract/evaluation';
import type { CallerScope } from '../../repositories/index';
import { ForbiddenError, NotFoundError, ValidationError } from '../../errors';
import { assertCallerMayRunWorkflow } from '../workflows/_access-gate';
import { agentRunChange } from './_lib/agent-production-runs';
import { loadEvaluationSubject, subjectRef } from './_lib/evaluation-subject';
import { loadScoredRun, type ScoredRun } from './_lib/scored-run';
import { producedResult, runEvaluatorCheck } from './_lib/run-evaluator-check';
import { listStepProductionAgentRuns } from './_lib/step-agent-runs';

type TriedCase = EvalCase & { sourceAgentRunId: string; expectedOutput: Record<string, unknown> };

/** How many of a subject's cases one preview looks at, however many of them it has to skip. */
const CASES_LOOKED_AT = 50;

/** An Agent's check is tried only on its Eval Cases (ADR-0031); without one to try it on, its Eval Run is the first try. */
export const AGENT_NOT_PREVIEWED = 'None of this agent\'s Eval Cases can be tried here: that takes a case taken from a run of a workflow you may run, under the agent\'s output schema, with an expected output. The check is first tried in its next Eval Run.';

export const AGENT_RUNS_NOT_PREVIEWED = 'An agent\'s check is tried on its Eval Cases, not on production runs; leave agentRunIds out.';

/** The Evaluation Assistant proposes a judge untried; a person may still preview one. */
export const JUDGE_NOT_PREVIEWED = 'A judge is not tried before it is proposed: a couple of outputs say little of how it judges. Try it in a small Eval Run.';

export const EXPECTED_OUTPUT_NOT_PREVIEWED = 'An expected-output check compares an Eval Case trial\'s output with the case\'s expected output; a production output has none, so it cannot be tried on one.';

/**
 * The cases a check is tried on as outputs: ones taken from a run on its own
 * input, with an expected output to stand in for the run's result. The
 * expectation is left aside — it is what an expected-output check grades by,
 * not a verdict this check must reach.
 */
async function casesToTry(scope: CallerScope, subject: EvaluationSubject): Promise<TriedCase[]> {
  return (await scope.evaluation.listCases(subject))
    .filter((evalCase): evalCase is TriedCase =>
      evalCase.archived === false
      && evalCase.source === 'production'
      && evalCase.sourceAgentRunId !== null
      && typeof evalCase.expectedOutput === 'object'
      && evalCase.expectedOutput !== null
      && Array.isArray(evalCase.expectedOutput) === false)
    .slice(0, CASES_LOOKED_AT);
}

/**
 * The run a case is graded as, or null when it has none to give: a case outlives
 * the run it was taken from. An Agent's case is graded on the input it holds and
 * says what the run's Step altered (ADR-0031 D3). It is skipped when its run no
 * longer reads as one of a Step that used the Agent or answered under another
 * output schema, or when the caller may not run that workflow: a check runs over
 * its workspace, which the Agent's `run` verb does not cover.
 */
async function loadCaseRun(scope: CallerScope, subject: EvaluationSubject, evalCase: TriedCase): Promise<{ source: ScoredRun; changedFromAgent?: string[] } | null> {
  try {
    if (subject.kind === 'step') return { source: await loadScoredRun(scope, evalCase.sourceAgentRunId, subject) };
    const source = await loadScoredRun(scope, evalCase.sourceAgentRunId);
    const change = await agentRunChange(scope, subject, source.agentRun, source.instance);
    if (change === null || change.outputSchemaDiffers) return null;
    await assertCallerMayRunWorkflow(scope, subject.namespace, change.workflowName);
    return { source: { ...source, stepInput: evalCase.input.triggerPayload }, changedFromAgent: change.changes };
  } catch (err) {
    if (err instanceof NotFoundError || (subject.kind === 'agent' && err instanceof ForbiddenError)) return null;
    throw err;
  }
}

/**
 * Runs a draft check against existing outputs and writes nothing — no Score,
 * no Evaluator (ADR-0023 D14 `preview_evaluator`). This is how the Evaluation
 * Assistant sees a check fail on real outputs before it proposes it, and how a
 * person tries one before saving it. The subject's Eval Cases come first; a
 * Step's latest production runs that gave a result — other than the ones those
 * cases were taken from — fill the rest. An Agent's stop at its cases (ADR-0031).
 */
export async function previewEvaluator(
  input: z.output<typeof PreviewEvaluatorInputSchema>,
  scope: CallerScope,
): Promise<PreviewEvaluatorOutput> {
  const step = subjectRef(input);
  await loadEvaluationSubject(scope, step, 'run');
  if (input.check.kind === 'expected_output') throw new ValidationError(EXPECTED_OUTPUT_NOT_PREVIEWED);
  if (step.kind === 'agent' && input.agentRunIds !== undefined) throw new ValidationError(AGENT_RUNS_NOT_PREVIEWED);

  const cases: PreviewEvaluatorOutput['cases'] = [];
  for (const evalCase of input.agentRunIds === undefined ? await casesToTry(scope, step) : []) {
    if (cases.length === input.limit) break;
    const caseRun = await loadCaseRun(scope, step, evalCase);
    const envelope = caseRun?.source.agentRun.envelope ?? null;
    if (caseRun === null || envelope === null) continue;
    const { source, changedFromAgent } = caseRun;
    const subject = { ...source, agentRun: { ...source.agentRun, envelope: { ...envelope, result: evalCase.expectedOutput } } };
    cases.push({
      ...await runEvaluatorCheck(scope, input.check, subject, evalCase),
      caseId: evalCase.id,
      caseName: evalCase.name,
      expectation: evalCase.expectation,
      ...(changedFromAgent === undefined ? {} : { changedFromAgent }),
    });
  }
  if (step.kind === 'agent') return { cases, results: [] };

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
