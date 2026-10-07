import {
  calibrateConfidence,
  caseReliability,
  evalRunAcceptance,
  judgeAcceptanceCriteria,
  mcpServersByMode,
  recommendControl,
  wilsonInterval,
  type AcceptanceCriterionVerdict,
  type ConfidenceOutcome,
  type EvalCase,
  type EvalRun,
  type EvalRunAcceptance,
  type EvalRunEvaluatorReport,
  type EvalRunMcpReport,
  type EvalRunReport,
  type EvalTrial,
  type EvalTrialResult,
  type JudgeVerdict,
} from '@mediforce/platform-core';
import type { CallerScope } from '../../../repositories/index';
import {
  casesOfRun,
  checkOutcome,
  countedScores,
  evaluatorsOfCase,
  isModelVerdict,
  isPass,
  judgeConfidenceOf,
  mean,
  passedEveryCounted,
  reviewDecision,
  trialScores,
  type TrialScores,
} from './trial-scores';

type RunCases = ReadonlyMap<string, EvalCase | null>;

function byCaseThenTrial(left: EvalTrial, right: EvalTrial): number {
  return left.caseId.localeCompare(right.caseId) || left.trialIndex - right.trialIndex;
}

/** What the run recorded on its scored trials, by trial id. */
async function scoresByTrial(scope: CallerScope, run: EvalRun, trials: readonly EvalTrial[]): Promise<Map<string, TrialScores>> {
  const scored = trials.filter((trial) => trial.status === 'scored');
  return new Map(await Promise.all(scored.map(async (trial) => [trial.id, await trialScores(scope, run, trial)] as const)));
}

function trialCounts(trials: readonly EvalTrial[]): EvalRunReport['trials'] {
  return {
    total: trials.length,
    scored: trials.filter((trial) => trial.status === 'scored').length,
    failed: trials.filter((trial) => trial.status === 'failed').length,
    skipped: trials.filter((trial) => trial.status === 'skipped').length,
    inProgress: trials.filter((trial) => trial.status === 'pending' || trial.status === 'running' || trial.status === 'scoring').length,
  };
}

function gradesTrial(run: EvalRun, cases: RunCases, trial: EvalTrial, evaluatorId: string): boolean {
  return evaluatorsOfCase(run, cases.get(trial.caseId) ?? null).some((candidate) => candidate.evaluatorId === evaluatorId);
}

/**
 * Per Evaluator over the run's trials: pass rate with its Wilson 95%
 * interval, pass@k, pass^k and flakiness over cases; a trial the check could
 * not grade counts as an error, not a failure, and a judge verdict left out
 * (`checkOutcome`) as excluded. Over cases, an ungraded, excluded or failed
 * trial still counts toward k, so it can lower pass@k and pass^k but never
 * lift them. A trial of a case the Evaluator does not grade is not counted at all.
 */
function evaluatorReports(run: EvalRun, trials: readonly EvalTrial[], scores: ReadonlyMap<string, TrialScores>, cases: RunCases): EvalRunEvaluatorReport[] {
  const attempted = trials.filter((trial) => trial.status === 'scored' || trial.status === 'failed');
  const grades = (trial: EvalTrial, evaluatorId: string) => gradesTrial(run, cases, trial, evaluatorId);
  return run.evaluators.map((evaluator) => {
    let passes = 0;
    let failures = 0;
    let errors = 0;
    let excluded = 0;
    const outcomesByCase = new Map<string, (boolean | null)[]>();
    const recordOutcome = (caseId: string, passed: boolean | null) =>
      outcomesByCase.set(caseId, [...(outcomesByCase.get(caseId) ?? []), passed]);
    for (const trial of attempted.filter((candidate) => grades(candidate, evaluator.evaluatorId))) {
      if (trial.status === 'failed') {
        recordOutcome(trial.caseId, null);
        continue;
      }
      const recorded = scores.get(trial.id);
      const score = recorded?.checks.find((candidate) => candidate.evaluatorId === evaluator.evaluatorId);
      if (score === undefined) {
        errors += 1;
        recordOutcome(trial.caseId, null);
        continue;
      }
      const outcome = checkOutcome(score, recorded?.reviews.get(evaluator.evaluatorId));
      if (outcome === 'excluded') {
        excluded += 1;
        recordOutcome(trial.caseId, null);
        continue;
      }
      const passed = outcome === 'pass';
      if (passed) passes += 1;
      else failures += 1;
      recordOutcome(trial.caseId, passed);
    }
    const graded = passes + failures;
    const interval = wilsonInterval(passes, graded);
    const reliability = caseReliability(outcomesByCase);
    return {
      ...evaluator,
      passes,
      failures,
      errors,
      excluded,
      passRate: graded === 0 ? null : passes / graded,
      wilsonLower: interval?.lower ?? null,
      wilsonUpper: interval?.upper ?? null,
      passAtK: reliability?.passAtK ?? null,
      passHatK: reliability?.passHatK ?? null,
      flakiness: reliability?.flakiness ?? null,
    };
  });
}

/**
 * A scored trial that reported a confidence, against whether its output
 * passed every counted Evaluator — the pairs confidence is calibrated on. A
 * trial some counted Evaluator could not grade says nothing: a missing Score
 * is not a pass.
 */
function confidenceOutcomes(run: EvalRun, trials: readonly EvalTrial[], scores: ReadonlyMap<string, TrialScores>, cases: RunCases): ConfidenceOutcome[] {
  return trials.flatMap((trial) => {
    if (trial.status !== 'scored' || trial.confidence === null) return [];
    const recorded = scores.get(trial.id);
    const passed = passedEveryCounted(run, recorded === undefined ? [] : countedScores(recorded), cases.get(trial.caseId) ?? null);
    return passed === null ? [] : [{ confidence: trial.confidence, passed }];
  });
}

/**
 * A criterion is met on the whole frozen Dataset or not at all: while some
 * trial failed or was skipped, one the scored trials reached is not judged.
 */
function judgedOnEveryTrial(verdict: AcceptanceCriterionVerdict | null, counts: EvalRunReport['trials']): AcceptanceCriterionVerdict | null {
  const unscored = counts.failed + counts.skipped;
  if (verdict === null || unscored === 0 || verdict.status !== 'met') return verdict;
  return { ...verdict, status: 'not_evaluable', reason: `${unscored} of ${counts.total} trials failed or were skipped, so the Dataset was not evaluated in full` };
}

/**
 * The servers by the mode the run froze for them, the cases each replayed
 * server ran live to record because none had a recording yet, and every
 * unanswered replayed call, counted by server and tool.
 */
async function mcpReport(scope: CallerScope, run: EvalRun, trials: readonly EvalTrial[]): Promise<EvalRunMcpReport> {
  const modes = mcpServersByMode(run.mcpPolicy);
  const recordedByThisRun = modes.replayed.length === 0
    ? []
    : await scope.evaluation.listMcpRecordedCases(run, { evalRunId: run.id });
  const recordedFirst = modes.replayed
    .map((server) => ({ server, cases: recordedByThisRun.filter((recorded) => recorded.server === server).length }))
    .filter((recorded) => recorded.cases > 0);
  const counts = new Map<string, EvalRunMcpReport['unrecordedCalls'][number]>();
  for (const miss of trials.flatMap((trial) => trial.mcpReplayMisses)) {
    const key = `${miss.server}\u0000${miss.tool}`;
    const counted = counts.get(key);
    counts.set(key, { server: miss.server, tool: miss.tool, count: (counted?.count ?? 0) + 1 });
  }
  return { ...modes, recordedFirst, unrecordedCalls: [...counts.values()] };
}

/**
 * Every model's verdict on the run's scored trials — a judge's, or an
 * expected-output agreement score — with its confidence, rationale and a
 * person's newest review: what someone reads to accept or deny it.
 */
function judgeVerdicts(
  run: EvalRun,
  trials: readonly EvalTrial[],
  scores: ReadonlyMap<string, TrialScores>,
  cases: RunCases,
): JudgeVerdict[] {
  const judges = run.evaluators.filter((evaluator) => evaluator.kind === 'llm_judge' || evaluator.kind === 'expected_output');
  if (judges.length === 0) return [];
  const ordered = trials
    .filter((trial) => trial.status === 'scored' && trial.agentRunId !== null)
    .sort(byCaseThenTrial);
  return ordered.flatMap((trial) => judges.flatMap((judge): JudgeVerdict[] => {
    const recorded = scores.get(trial.id);
    const score = recorded?.checks.find((candidate) => candidate.evaluatorId === judge.evaluatorId);
    if (score === undefined || isModelVerdict(score) === false) return [];
    const review = recorded?.reviews.get(judge.evaluatorId);
    const decision = reviewDecision(review);
    return [{
      trialId: trial.id,
      trialIndex: trial.trialIndex,
      caseId: trial.caseId,
      caseName: cases.get(trial.caseId)?.name ?? null,
      agentRunId: trial.agentRunId!,
      evaluatorId: judge.evaluatorId,
      name: judge.name,
      scoreId: score.id,
      passed: isPass(score),
      ...judgeConfidenceOf(score),
      agreement: typeof score.metadata?.agreement === 'number' ? score.metadata.agreement : null,
      rationale: score.comment,
      review: review === undefined || decision === null
        ? null
        : { decision, reviewedBy: review.createdBy, reviewedAt: review.createdAt, comment: review.comment },
      counts: judge.counted === true && checkOutcome(score, review) !== 'excluded',
    }];
  }));
}

/**
 * Every trial with its grade from each Evaluator its case selects — what the
 * per-Evaluator rates are counted from, one trial at a time. An Evaluator with
 * no Score on a scored trial could not grade it; a trial not scored has no grades.
 */
function trialResults(
  run: EvalRun,
  trials: readonly EvalTrial[],
  scores: ReadonlyMap<string, TrialScores>,
  cases: RunCases,
): EvalTrialResult[] {
  return [...trials]
    .sort(byCaseThenTrial)
    .map((trial) => {
      const evalCase = cases.get(trial.caseId) ?? null;
      const recorded = scores.get(trial.id) ?? { checks: [], reviews: new Map() };
      return {
        trialId: trial.id,
        caseName: evalCase?.name ?? null,
        passed: passedEveryCounted(run, countedScores(recorded), evalCase),
        evaluators: trial.status !== 'scored' ? [] : evaluatorsOfCase(run, evalCase).map((evaluator) => {
          const score = recorded.checks.find((candidate) => candidate.evaluatorId === evaluator.evaluatorId);
          return {
            evaluatorId: evaluator.evaluatorId,
            outcome: score === undefined ? 'errored' : checkOutcome(score, recorded.reviews.get(evaluator.evaluatorId)),
            comment: score?.comment ?? null,
          };
        }),
      };
    });
}

/**
 * The Eval Run report (ADR-0023 D10), computed from the Scores its trials
 * received — so its numbers are the Scores' numbers by construction: every
 * Evaluator's results, the verdict on each Acceptance Criterion, how the
 * agent's confidence matched its pass rate and what that recommends for
 * routing, what the run cost, and how the trials reached MCP servers.
 */
export async function buildEvalRunReport(scope: CallerScope, run: EvalRun, trials: readonly EvalTrial[]): Promise<EvalRunReport> {
  const scores = await scoresByTrial(scope, run, trials);
  const cases = await casesOfRun(scope, run);
  const evaluators = evaluatorReports(run, trials, scores, cases);
  const counts = trialCounts(trials);
  // An Evaluator no case selects grades nothing, so it is left out of the criteria like one that does not count.
  const grading = evaluators.filter((evaluator) => trials.some((trial) => gradesTrial(run, cases, trial, evaluator.evaluatorId)));
  const criteriaVerdict = judgedOnEveryTrial(judgeAcceptanceCriteria(run.acceptanceCriteria, grading), counts);
  const outcomes = confidenceOutcomes(run, trials, scores, cases);
  // Routing is recommended on finished results only.
  const finished = counts.inProgress === 0 && counts.scored > 0;
  const costs = trials.flatMap((trial) => (trial.costUsd === null ? [] : [trial.costUsd]));
  const durations = trials.flatMap((trial) => (trial.durationMs === null ? [] : [trial.durationMs]));
  return {
    k: run.trialsPerCase,
    trials: counts,
    mcp: await mcpReport(scope, run, trials),
    evaluators,
    criteriaVerdict,
    confidence: calibrateConfidence(outcomes),
    recommendation: finished ? recommendControl(outcomes, criteriaVerdict) : null,
    judgeVerdicts: judgeVerdicts(run, trials, scores, cases),
    trialResults: trialResults(run, trials, scores, cases),
    costUsd: costs.reduce((sum, cost) => sum + cost, 0),
    meanCostUsd: mean(costs),
    inputTokens: trials.reduce((sum, trial) => sum + (trial.inputTokens ?? 0), 0),
    outputTokens: trials.reduce((sum, trial) => sum + (trial.outputTokens ?? 0), 0),
    meanDurationMs: mean(durations),
    maxDurationMs: durations.length === 0 ? null : Math.max(...durations),
  };
}

/** How a finished run fared on its criteria, rebuilt from its report; null while it is prepared or running. */
export async function rebuildEvalRunAcceptance(scope: CallerScope, run: EvalRun): Promise<EvalRunAcceptance | null> {
  return evalRunAcceptance(run, await buildEvalRunReport(scope, run, await scope.evaluation.listTrials(run.id)));
}

/** Rebuilds a finished run's acceptance and stores it on the run, so the run list reads it. */
export async function storeEvalRunAcceptance(scope: CallerScope, run: EvalRun): Promise<EvalRunAcceptance | null> {
  const acceptance = await rebuildEvalRunAcceptance(scope, run);
  if (acceptance !== null) await scope.evaluation.setEvalRunAcceptance(run.id, acceptance);
  return acceptance;
}
