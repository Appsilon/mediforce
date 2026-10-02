import {
  calibrateConfidence,
  caseReliability,
  judgeAcceptanceCriteria,
  mcpServersByMode,
  recommendControl,
  wilsonInterval,
  type AcceptanceCriterionVerdict,
  type ConfidenceOutcome,
  type EvalRun,
  type EvalRunEvaluatorReport,
  type EvalRunMcpReport,
  type EvalRunReport,
  type EvalRunVariantReport,
  type EvalTrial,
  type EvalVariant,
  type JudgeVerdict,
  type VariantComparison,
} from '@mediforce/platform-core';
import type { CallerScope } from '../../../repositories/index';
import {
  checkOutcome,
  countedScores,
  isPass,
  judgeConfidenceOf,
  mean,
  passedEveryCounted,
  reviewDecision,
  trialScores,
  type TrialScores,
} from './trial-scores';

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

/**
 * Per Evaluator over one variant's trials: pass rate with its Wilson 95%
 * interval, pass@k, pass^k and flakiness over cases; a trial the check could
 * not grade counts as an error, not a failure, and a judge verdict left out
 * (`checkOutcome`) as excluded. Over cases, an ungraded, excluded or failed
 * trial still counts toward k, so it can lower pass@k and pass^k but never
 * lift them.
 */
function evaluatorReports(run: EvalRun, trials: readonly EvalTrial[], scores: ReadonlyMap<string, TrialScores>): EvalRunEvaluatorReport[] {
  const attempted = trials.filter((trial) => trial.status === 'scored' || trial.status === 'failed');
  return run.evaluators.map((evaluator) => {
    let passes = 0;
    let failures = 0;
    let errors = 0;
    let excluded = 0;
    const outcomesByCase = new Map<string, (boolean | null)[]>();
    const recordOutcome = (caseId: string, passed: boolean | null) =>
      outcomesByCase.set(caseId, [...(outcomesByCase.get(caseId) ?? []), passed]);
    for (const trial of attempted) {
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
function confidenceOutcomes(run: EvalRun, trials: readonly EvalTrial[], scores: ReadonlyMap<string, TrialScores>): ConfidenceOutcome[] {
  return trials.flatMap((trial) => {
    if (trial.status !== 'scored' || trial.confidence === null) return [];
    const recorded = scores.get(trial.id);
    const passed = passedEveryCounted(run, recorded === undefined ? [] : countedScores(recorded));
    return passed === null ? [] : [{ confidence: trial.confidence, passed }];
  });
}

/**
 * A criterion is met on the whole frozen Dataset or not at all: while some
 * trial failed or was skipped, one the scored trials reached is not judged.
 */
function judgedOnEveryTrial(verdicts: AcceptanceCriterionVerdict[], counts: EvalRunReport['trials']): AcceptanceCriterionVerdict[] {
  const unscored = counts.failed + counts.skipped;
  if (unscored === 0) return verdicts;
  return verdicts.map((verdict): AcceptanceCriterionVerdict => (verdict.status === 'met'
    ? { ...verdict, status: 'not_evaluable', reason: `${unscored} of ${counts.total} trials failed or were skipped, so the Dataset was not evaluated in full` }
    : verdict));
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

function variantReport(
  run: EvalRun,
  variant: EvalVariant,
  trials: readonly EvalTrial[],
  scores: ReadonlyMap<string, TrialScores>,
): EvalRunVariantReport {
  const evaluators = evaluatorReports(run, trials, scores);
  const counts = trialCounts(trials);
  const criteria = judgedOnEveryTrial(judgeAcceptanceCriteria(run.acceptanceCriteria, evaluators), counts);
  const outcomes = confidenceOutcomes(run, trials, scores);
  // Routing is recommended on a variant's finished results only.
  const finished = counts.inProgress === 0 && counts.scored > 0;
  const costs = trials.flatMap((trial) => (trial.costUsd === null ? [] : [trial.costUsd]));
  const durations = trials.flatMap((trial) => (trial.durationMs === null ? [] : [trial.durationMs]));
  return {
    ...variant,
    trials: counts,
    evaluators,
    criteria,
    confidence: calibrateConfidence(outcomes),
    recommendation: finished ? recommendControl(outcomes, criteria) : null,
    costUsd: costs.reduce((sum, cost) => sum + cost, 0),
    meanCostUsd: mean(costs),
    inputTokens: trials.reduce((sum, trial) => sum + (trial.inputTokens ?? 0), 0),
    outputTokens: trials.reduce((sum, trial) => sum + (trial.outputTokens ?? 0), 0),
    meanDurationMs: mean(durations),
    maxDurationMs: durations.length === 0 ? null : Math.max(...durations),
  };
}

function difference(challenger: number | null, champion: number | null): number | null {
  return challenger === null || champion === null ? null : challenger - champion;
}

/**
 * A challenger against the champion, Evaluator by Evaluator: `better` or
 * `worse` only when their Wilson 95% intervals do not overlap.
 */
function compare(champion: EvalRunVariantReport, challenger: EvalRunVariantReport): VariantComparison {
  return {
    variantId: challenger.id,
    evaluators: challenger.evaluators.map((result) => {
      const baseline = champion.evaluators.find((candidate) => candidate.evaluatorId === result.evaluatorId)!;
      const separated = result.wilsonLower !== null && baseline.wilsonUpper !== null && result.wilsonLower > baseline.wilsonUpper;
      const behind = result.wilsonUpper !== null && baseline.wilsonLower !== null && result.wilsonUpper < baseline.wilsonLower;
      return {
        evaluatorId: result.evaluatorId,
        name: result.name,
        championPassRate: baseline.passRate,
        challengerPassRate: result.passRate,
        delta: difference(result.passRate, baseline.passRate),
        verdict: separated ? 'better' : behind ? 'worse' : 'no_clear_difference',
      };
    }),
    meanCostDeltaUsd: difference(challenger.meanCostUsd, champion.meanCostUsd),
    meanDurationDeltaMs: difference(challenger.meanDurationMs, champion.meanDurationMs),
  };
}

/**
 * Every judge verdict on the run's scored trials, with its confidence,
 * rationale and a person's newest review — what someone reads to accept or
 * deny it.
 */
async function judgeVerdicts(
  scope: CallerScope,
  run: EvalRun,
  trials: readonly EvalTrial[],
  scores: ReadonlyMap<string, TrialScores>,
): Promise<JudgeVerdict[]> {
  const judges = run.evaluators.filter((evaluator) => evaluator.kind === 'llm_judge');
  if (judges.length === 0) return [];
  const variantOrder = new Map(run.variants.map((variant, index) => [variant.id, index]));
  const ordered = trials
    .filter((trial) => trial.status === 'scored' && trial.agentRunId !== null)
    .sort((left, right) => (variantOrder.get(left.variantId) ?? 0) - (variantOrder.get(right.variantId) ?? 0)
      || left.caseId.localeCompare(right.caseId)
      || left.trialIndex - right.trialIndex);
  const caseNames = new Map(await Promise.all([...new Set(ordered.map((trial) => trial.caseId))]
    .map(async (caseId) => [caseId, (await scope.evaluation.getCase(caseId))?.name ?? null] as const)));
  return ordered.flatMap((trial) => judges.flatMap((judge): JudgeVerdict[] => {
    const recorded = scores.get(trial.id);
    const score = recorded?.checks.find((candidate) => candidate.evaluatorId === judge.evaluatorId);
    if (score === undefined) return [];
    const review = recorded?.reviews.get(judge.evaluatorId);
    const decision = reviewDecision(review);
    return [{
      trialId: trial.id,
      trialIndex: trial.trialIndex,
      variantId: trial.variantId,
      caseId: trial.caseId,
      caseName: caseNames.get(trial.caseId) ?? null,
      agentRunId: trial.agentRunId!,
      evaluatorId: judge.evaluatorId,
      name: judge.name,
      severity: judge.severity,
      scoreId: score.id,
      passed: isPass(score),
      ...judgeConfidenceOf(score),
      rationale: score.comment,
      review: review === undefined || decision === null
        ? null
        : { decision, reviewedBy: review.createdBy, reviewedAt: review.createdAt, comment: review.comment },
      counts: judge.counted === true && checkOutcome(score, review) !== 'excluded',
    }];
  }));
}

/**
 * The Eval Run report (ADR-0023 D5, D10), computed from the Scores its trials
 * received — so its numbers are the Scores' numbers by construction. Per
 * variant: every Evaluator's results, the verdict on each Acceptance
 * Criterion, how the agent's confidence matched its pass rate and what that
 * recommends for routing, and what the variant cost. Then every challenger
 * against the champion, and how the trials reached MCP servers.
 */
export async function buildEvalRunReport(scope: CallerScope, run: EvalRun, trials: readonly EvalTrial[]): Promise<EvalRunReport> {
  const scores = await scoresByTrial(scope, run, trials);
  const variants = run.variants.map((variant) =>
    variantReport(run, variant, trials.filter((trial) => trial.variantId === variant.id), scores));
  const [champion, ...challengers] = variants;
  return {
    k: run.trialsPerCase,
    trials: trialCounts(trials),
    mcp: await mcpReport(scope, run, trials),
    variants,
    comparison: champion === undefined ? [] : challengers.map((challenger) => compare(champion, challenger)),
    judgeVerdicts: await judgeVerdicts(scope, run, trials, scores),
    costUsd: trials.reduce((sum, trial) => sum + (trial.costUsd ?? 0), 0),
    inputTokens: trials.reduce((sum, trial) => sum + (trial.inputTokens ?? 0), 0),
    outputTokens: trials.reduce((sum, trial) => sum + (trial.outputTokens ?? 0), 0),
  };
}
