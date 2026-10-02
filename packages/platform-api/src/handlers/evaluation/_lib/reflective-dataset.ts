import type { GepaReflectiveRecord } from '@mediforce/agent-runtime';
import { evaluatorAppliesToCase, type EvalCase, type EvalRun, type EvalTrial, type StoredAgentTrajectoryEntry } from '@mediforce/platform-core';
import type { CallerScope } from '../../../repositories/index';
import { loadEvaluationSubject } from './evaluation-subject';
import { checkOutcome, countedScores, passedEveryCounted, trialScores, type TrialScores } from './trial-scores';

/** What one job reflects on at most: its prompt must fit the reflection model's context many times over. */
const MAX_RECORDS = 12;
const MAX_FIELD_CHARS = 4000;

function clipped(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? 'null';
  return text.length <= MAX_FIELD_CHARS ? text : `${text.slice(0, MAX_FIELD_CHARS)}… (truncated, ${text.length} chars)`;
}

function toolCallSummary(trajectory: readonly StoredAgentTrajectoryEntry[]): string {
  const counts = new Map<string, number>();
  for (const entry of trajectory) {
    const tool = entry.tool ?? entry.tool_name;
    if (entry.subtype === 'tool_call' && tool !== undefined) counts.set(tool, (counts.get(tool) ?? 0) + 1);
  }
  return counts.size === 0 ? 'none' : [...counts].map(([tool, count]) => `${tool} ×${count}`).join(', ');
}

interface GradedTrial {
  readonly trial: EvalTrial;
  readonly evalCase: EvalCase;
  readonly scores: TrialScores;
  readonly failing: boolean;
}

const VERDICT_WORDS = { pass: 'PASS', fail: 'FAIL', excluded: 'LEFT OUT' } as const;

/**
 * GEPA's reflective dataset (its `Inputs`, `Generated Outputs`, `Feedback`)
 * from one variant's scored trials of an Eval Run — only its dev cases: the
 * holdout cases are what the candidates are checked on afterwards, so the job
 * never sees them. Feedback is each counted Evaluator's verdict — PASS, FAIL,
 * or ERROR when it gave none — with its rule and comment, the trial's
 * Evaluator errors, and the output the case expects or must not get. Trials that did not
 * pass every counted Evaluator come first.
 */
export async function reflectiveDataset(scope: CallerScope, run: EvalRun, variantId: string): Promise<GepaReflectiveRecord[]> {
  const counted = run.evaluators.filter((evaluator) => evaluator.counted);
  const rules = new Map(await Promise.all(counted.map(async (evaluator) => {
    const version = (await scope.evaluation.listEvaluatorVersions(evaluator.evaluatorId))
      .find((candidate) => candidate.version === evaluator.version);
    return [evaluator.evaluatorId, version?.rule ?? null] as const;
  })));

  const graded: GradedTrial[] = [];
  for (const trial of await scope.evaluation.listTrials(run.id)) {
    if (trial.variantId !== variantId || trial.status !== 'scored' || trial.agentRunId === null) continue;
    const evalCase = await scope.evaluation.getCase(trial.caseId);
    if (evalCase === null || evalCase.split !== 'dev') continue;
    const scores = await trialScores(scope, run, trial);
    graded.push({ trial, evalCase, scores, failing: passedEveryCounted(run, countedScores(scores), evalCase) !== true });
  }
  const chosen = [...graded.filter((row) => row.failing), ...graded.filter((row) => row.failing === false)].slice(0, MAX_RECORDS);

  return Promise.all(chosen.map(async ({ trial, evalCase, scores }) => {
    const subject = await loadEvaluationSubject(scope, trial.agentRunId!);
    const verdicts = counted.filter((evaluator) => evaluatorAppliesToCase(evaluator, evalCase)).map((evaluator) => {
      const score = scores.checks.find((candidate) => candidate.evaluatorId === evaluator.evaluatorId);
      const verdict = score === undefined ? 'ERROR' : VERDICT_WORDS[checkOutcome(score, scores.reviews.get(evaluator.evaluatorId))];
      const rule = rules.get(evaluator.evaluatorId);
      const comment = score === undefined || score.comment === null ? '' : ` — ${score.comment}`;
      return `${verdict} ${evaluator.name} (${evaluator.severity})${rule === null || rule === undefined ? '' : `: ${rule}`}${comment}`;
    });
    return {
      Inputs: clipped({
        triggerPayload: evalCase.input.triggerPayload,
        previousStepOutputs: evalCase.input.previousStepOutputs,
      }),
      'Generated Outputs': `${clipped(subject.agentRun.envelope?.result ?? null)}\n\nTool calls: ${toolCallSummary(subject.trajectory)}`,
      Feedback: [
        ...(evalCase.expectedOutput === null ? [] : [
          `The output ${evalCase.expectation === 'positive' ? 'should match' : 'must not match'}: ${clipped(evalCase.expectedOutput)}`,
        ]),
        ...verdicts,
        ...(trial.error === null ? [] : [`Evaluator errors: ${trial.error}`]),
      ].join('\n'),
    };
  }));
}
