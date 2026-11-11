import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import {
  DEFAULT_ACCEPTANCE_CRITERIA,
  canonicalJson,
  compareToBaseline,
  evaluationOwnerOf,
  isEmptyVariant,
  isOwnedBy,
  recommendationScope,
  type EvalComparison,
  type EvalRun,
  type EvalRunEvaluator,
  type TrialGrade,
} from '@mediforce/platform-core';
import type {
  CancelComparisonInput,
  ComparisonOutput,
  ComparisonRun,
  GetComparisonInput,
  ListComparisonsInput,
  ListComparisonsOutput,
  PrepareComparisonInputSchema,
  StartComparisonInput,
} from '../../contract/evaluation';
import type { CallerScope } from '../../repositories/index';
import { ConflictError, NotFoundError, ValidationError } from '../../errors';
import { loadEvaluationSubject, subjectName, subjectRef } from './_lib/evaluation-subject';
import { appendEvaluationAudit, authorId } from './_lib/audit';
import { buildEvalRunReport } from './_lib/eval-run-report';
import { casesOfRun } from './_lib/trial-scores';
import { cancelEvalRun, planEvalRun, prepareEvalRun, startEvalRun } from './eval-runs';

type EvalRunPlan = Awaited<ReturnType<typeof planEvalRun>>;

const FINISHED_RUN_STATUSES: ReadonlySet<EvalRun['status']> = new Set(['completed', 'budget_exceeded', 'cancelled']);

/** A budget in whole cents, rounded up so the sum a person confirms never understates a run's cap. */
function centsUp(usd: number): number {
  return Math.max(0.01, Math.ceil(usd * 100 - 1e-9) / 100);
}

function evaluatorVersions(evaluators: readonly Pick<EvalRunEvaluator, 'evaluatorId' | 'version' | 'counted'>[]): string {
  return canonicalJson([...evaluators]
    .map(({ evaluatorId, version, counted }) => ({ evaluatorId, version, counted }))
    .sort((left, right) => left.evaluatorId.localeCompare(right.evaluatorId)));
}

/** The inputs every run of a Comparison freezes the same (ADR-0024 D4), as they differ between a run and the plan. */
function frozenInputMismatches(
  run: EvalRun,
  plan: EvalRunPlan,
  acceptanceCriteria: EvalRun['acceptanceCriteria'],
  trialsPerCase: number,
): string[] {
  return [
    ...(run.datasetVersionId === plan.dataset.id ? [] : ['its Eval Dataset version']),
    ...(evaluatorVersions(run.evaluators) === evaluatorVersions(plan.frozenEvaluators.map(({ frozen }) => frozen)) ? [] : ['its Evaluator versions']),
    ...(run.trialsPerCase === trialsPerCase ? [] : ['its trials per case']),
    ...(canonicalJson(run.mcpPolicy) === canonicalJson(plan.mcpPolicy) ? [] : ['its MCP policy']),
    ...(canonicalJson(run.env) === canonicalJson(plan.env) ? [] : ['its MCP env']),
    ...(canonicalJson(run.acceptanceCriteria) === canonicalJson(acceptanceCriteria) ? [] : ['its Acceptance Criteria']),
  ];
}

/** What keeps a finished run from being the baseline a Comparison would run now (ADR-0024 D4). */
function baselineMismatches(
  run: EvalRun,
  plan: EvalRunPlan,
  acceptanceCriteria: EvalRun['acceptanceCriteria'],
  trialsPerCase: number,
): string[] {
  return [
    ...(run.status === 'completed' ? [] : [`it is ${run.status}, not completed`]),
    ...(run.variant === null ? [] : ['it ran a Variant']),
    ...(run.fingerprint?.hash === plan.fingerprint.hash ? [] : ['its Fingerprint']),
    ...frozenInputMismatches(run, plan, acceptanceCriteria, trialsPerCase),
  ];
}

async function loadComparison(scope: CallerScope, comparisonId: string): Promise<EvalComparison> {
  const comparison = await scope.evaluation.getComparison(comparisonId);
  if (comparison === null) throw new NotFoundError(`Comparison '${comparisonId}' not found`);
  return comparison;
}

async function loadRun(scope: CallerScope, evalRunId: string): Promise<EvalRun> {
  const run = await scope.evaluation.getEvalRun(evalRunId);
  if (run === null) throw new NotFoundError(`Eval Run '${evalRunId}' not found`);
  return run;
}

/**
 * A running Comparison reads `completed` once every run it prepared has
 * finished — worked out on read, never written by one, so the list and a
 * single Comparison agree and reading needs no right to change it.
 */
function withStatus(comparison: EvalComparison, prepared: readonly EvalRun[]): EvalComparison {
  if (comparison.status !== 'running' || prepared.some((run) => FINISHED_RUN_STATUSES.has(run.status) === false)) return comparison;
  const finishedAt = prepared.map((run) => run.completedAt ?? '').sort().at(-1) ?? '';
  return { ...comparison, status: 'completed', completedAt: finishedAt === '' ? null : finishedAt };
}

/** Stops a Comparison that could not be prepared or started in full, and every run it prepared that has not finished. */
async function abandon(scope: CallerScope, comparison: EvalComparison, from: 'prepared' | 'running'): Promise<void> {
  await scope.evaluation.transitionComparison(comparison.id, from, { status: 'cancelled', completedAt: new Date().toISOString() });
  for (const run of await scope.evaluation.listEvalRunsOfComparison(comparison.id)) {
    if (run.status === 'prepared' || run.status === 'running') await cancelEvalRun({ evalRunId: run.id }, scope);
  }
}

/** One run of a Comparison: how it fared, and every trial's grade by case for pairing. */
async function comparisonRun(scope: CallerScope, run: EvalRun): Promise<{ summary: ComparisonRun; grades: TrialGrade[] }> {
  const trials = await scope.evaluation.listTrials(run.id);
  const report = await buildEvalRunReport(scope, run, trials);
  const caseOfTrial = new Map(trials.map((trial) => [trial.id, trial.caseId]));
  const grades = report.trialResults.flatMap((result) => {
    const caseId = caseOfTrial.get(result.trialId);
    return caseId === undefined ? [] : result.evaluators.map((grade) => ({ caseId, evaluatorId: grade.evaluatorId, outcome: grade.outcome }));
  });
  const costed = trials.filter((trial) => trial.costUsd !== null).length;
  const scored = report.trials.scored;
  return {
    grades,
    summary: {
      evalRun: run,
      evaluators: report.evaluators.map(({ evaluatorId, name, counted, passRate, wilsonLower, wilsonUpper }) => ({
        evaluatorId, name, counted, passRate, wilsonLower, wilsonUpper,
      })),
      scoredTrials: scored,
      meanAgentCostUsd: costed === 0 ? null : Math.max(0, report.costUsd - report.judgeCostUsd) / costed,
      meanJudgeCostUsd: scored === 0 ? null : report.judgeCostUsd / scored,
      meanDurationMs: report.meanDurationMs,
      inputTokens: report.inputTokens,
      outputTokens: report.outputTokens,
      acceptance: run.acceptance,
    },
  };
}

async function comparisonOutput(scope: CallerScope, comparisonId: string): Promise<ComparisonOutput> {
  const stored = await loadComparison(scope, comparisonId);
  const prepared = await scope.evaluation.listEvalRunsOfComparison(stored.id);
  const baselineRun = prepared.find((run) => run.id === stored.baselineEvalRunId) ?? await loadRun(scope, stored.baselineEvalRunId);
  const variantRuns = prepared.filter((run) => run.id !== stored.baselineEvalRunId);

  const baseline = await comparisonRun(scope, baselineRun);
  const cases = [...(await casesOfRun(scope, baselineRun)).values()];
  // Dev and holdout are read apart only when the cases have both (ADR-0024 D5).
  const split = cases.some((evalCase) => evalCase?.split === 'dev') && cases.some((evalCase) => evalCase?.split === 'holdout');
  const splitById = new Map(cases.flatMap((evalCase) => (evalCase === null ? [] : [[evalCase.id, evalCase.split] as const])));
  const counted = baselineRun.evaluators.filter((evaluator) => evaluator.counted === true).map((evaluator) => evaluator.evaluatorId);
  const variants = await Promise.all(variantRuns.map(async (run) => {
    const { summary, grades } = await comparisonRun(scope, run);
    return {
      ...summary,
      calls: compareToBaseline({
        baseline: baseline.grades,
        variant: grades,
        evaluatorIds: counted,
        ...(split ? { splitOf: (caseId: string) => splitById.get(caseId) ?? null } : {}),
      }),
      recommendationScope: recommendationScope(run.variant ?? {}, split),
    };
  }));
  return { comparison: withStatus(stored, prepared), baseline: baseline.summary, variants };
}

/**
 * Prepares a Comparison (ADR-0024 D4): every Variant and, unless a finished
 * run of the subject as it is matches every frozen input, the baseline, each
 * as an Eval Run on the same Eval Dataset version and Definition version.
 * Nothing runs until a person confirms the sum of their budgets; a Comparison
 * whose runs could not all be prepared alike is cancelled, not left to start.
 */
export async function prepareComparison(
  input: z.output<typeof PrepareComparisonInputSchema>,
  scope: CallerScope,
): Promise<ComparisonOutput> {
  const patches = new Set<string>();
  for (const variant of input.variants) {
    if (isEmptyVariant(variant)) throw new ValidationError('A Variant must change the model or the prompt; the baseline is the subject as it is');
    const key = canonicalJson(variant);
    if (patches.has(key)) throw new ValidationError('Two Variants of a Comparison are the same; each must differ');
    patches.add(key);
  }
  const owner = { namespace: input.namespace, workflowName: input.workflowName, stepId: input.stepId, agentId: input.agentId };
  const baselinePlan = await planEvalRun({
    ...owner,
    ...(input.definitionVersion === undefined ? {} : { definitionVersion: input.definitionVersion }),
    ...(input.datasetVersionId === undefined ? {} : { datasetVersionId: input.datasetVersionId }),
    trialsPerCase: input.trialsPerCase,
  }, scope);
  const subject = baselinePlan.step;
  // Every run pins what the baseline plan resolved, so none picks a newer version mid-prepare.
  const shared = {
    ...owner,
    ...(subject.kind === 'step' ? { definitionVersion: baselinePlan.definition.version } : {}),
    datasetVersionId: baselinePlan.dataset.id,
    trialsPerCase: input.trialsPerCase,
  };
  const [criteria] = await scope.evaluation.listAcceptanceCriteria(subject);
  const acceptanceCriteria = criteria?.criteria ?? DEFAULT_ACCEPTANCE_CRITERIA;

  let reusedBaseline: EvalRun | null;
  if (input.baselineEvalRunId !== undefined) {
    const named = await loadRun(scope, input.baselineEvalRunId);
    if (isOwnedBy(named, subject) === false) throw new ValidationError(`Eval Run '${named.id}' is not a run of ${subjectName(subject, false)}`);
    const mismatches = baselineMismatches(named, baselinePlan, acceptanceCriteria, input.trialsPerCase);
    if (mismatches.length > 0) {
      throw new ValidationError(`Eval Run '${named.id}' cannot be the baseline — it differs in ${mismatches.join(', ')}`);
    }
    reusedBaseline = named;
  } else {
    reusedBaseline = (await scope.evaluation.listEvalRuns(subject))
      .find((run) => baselineMismatches(run, baselinePlan, acceptanceCriteria, input.trialsPerCase).length === 0) ?? null;
  }

  const plans = await Promise.all(input.variants.map((variant) => planEvalRun({ ...shared, variant }, scope)));
  const budgetOf = (plan: EvalRunPlan): number => {
    const budget = input.budgetUsdPerRun ?? plan.suggestedBudgetUsd;
    if (budget === null) throw new ValidationError('No cost history or model price for a run of this Comparison — set budgetUsdPerRun to cap each run');
    return centsUp(budget);
  };
  const baselineBudget = reusedBaseline === null ? budgetOf(baselinePlan) : 0;
  const variantBudgets = plans.map(budgetOf);

  const comparison: EvalComparison = {
    ...evaluationOwnerOf(subject),
    id: randomUUID(),
    datasetVersionId: baselinePlan.dataset.id,
    trialsPerCase: input.trialsPerCase,
    baselineEvalRunId: reusedBaseline?.id ?? randomUUID(),
    baselineReused: reusedBaseline !== null,
    status: 'prepared',
    budgetUsd: Math.round((baselineBudget + variantBudgets.reduce((sum, budget) => sum + budget, 0)) * 100) / 100,
    createdBy: authorId(scope),
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
  };
  await scope.evaluation.createComparison(comparison);
  try {
    const run = { ...shared, concurrency: input.concurrency };
    if (reusedBaseline === null) {
      await prepareEvalRun({ ...run, budgetUsd: baselineBudget }, scope, { evalRunId: comparison.baselineEvalRunId, comparisonId: comparison.id });
    }
    for (const [index, variant] of input.variants.entries()) {
      await prepareEvalRun({ ...run, variant, budgetUsd: variantBudgets[index]! }, scope, { comparisonId: comparison.id });
    }
    for (const prepared of await scope.evaluation.listEvalRunsOfComparison(comparison.id)) {
      const drift = frozenInputMismatches(prepared, baselinePlan, acceptanceCriteria, input.trialsPerCase);
      if (drift.length > 0) throw new ConflictError(`The Evaluation changed while the Comparison was prepared (${drift.join(', ')}); prepare it again`);
    }
  } catch (error) {
    await abandon(scope, comparison, 'prepared');
    throw error;
  }
  await appendEvaluationAudit(scope, {
    action: 'eval_comparison.prepared',
    description: `Comparison prepared for ${subjectName(subject, false)}: ${input.variants.length} Variant(s), budget $${comparison.budgetUsd}`,
    namespace: subject.namespace,
    entityType: 'eval_comparison',
    entityId: comparison.id,
    inputSnapshot: { ...subject, variants: input.variants, datasetVersionId: comparison.datasetVersionId, trialsPerCase: input.trialsPerCase },
    outputSnapshot: { baselineEvalRunId: comparison.baselineEvalRunId, baselineReused: comparison.baselineReused, budgetUsd: comparison.budgetUsd },
    basis: 'Comparison prepared with one budget for a person to confirm (ADR-0024 D4, ADR-0023 D15)',
  });
  return comparisonOutput(scope, comparison.id);
}

/**
 * Starts every run a Comparison prepared once a person confirms the sum of
 * their budgets (ADR-0024 D4): the one confirmation covers each run. A run
 * that cannot start cancels the Comparison rather than leave it half-started.
 */
export async function startComparison(input: StartComparisonInput, scope: CallerScope): Promise<ComparisonOutput> {
  const comparison = await loadComparison(scope, input.comparisonId);
  await loadEvaluationSubject(scope, subjectRef(comparison), 'run');
  if (input.confirmedBudgetUsd !== comparison.budgetUsd) {
    throw new ValidationError(`Starting this Comparison spends up to $${comparison.budgetUsd}; a person must confirm that budget`);
  }
  const started = await scope.evaluation.transitionComparison(comparison.id, 'prepared', { status: 'running', startedAt: new Date().toISOString() });
  if (started === false) throw new ConflictError(`Comparison '${comparison.id}' is ${comparison.status}, not prepared`);
  try {
    for (const run of await scope.evaluation.listEvalRunsOfComparison(comparison.id)) {
      if (run.status === 'prepared') await startEvalRun({ evalRunId: run.id, confirmedBudgetUsd: run.budgetUsd }, scope);
    }
  } catch (error) {
    await abandon(scope, comparison, 'running');
    throw error;
  }
  await appendEvaluationAudit(scope, {
    action: 'eval_comparison.started',
    description: `Comparison '${comparison.id}' started with a budget of $${comparison.budgetUsd}`,
    namespace: comparison.namespace,
    entityType: 'eval_comparison',
    entityId: comparison.id,
    inputSnapshot: { confirmedBudgetUsd: input.confirmedBudgetUsd },
    basis: 'A person confirmed the Comparison budget (ADR-0024 D4, ADR-0023 D15)',
  });
  return comparisonOutput(scope, comparison.id);
}

export async function getComparison(input: GetComparisonInput, scope: CallerScope): Promise<ComparisonOutput> {
  const comparison = await loadComparison(scope, input.comparisonId);
  await loadEvaluationSubject(scope, subjectRef(comparison), 'read');
  return comparisonOutput(scope, comparison.id);
}

/** The subject's Comparisons, newest first, each with its status as `getComparison` reads it. */
export async function listComparisons(input: ListComparisonsInput, scope: CallerScope): Promise<ListComparisonsOutput> {
  await loadEvaluationSubject(scope, input, 'read');
  const stored = await scope.evaluation.listComparisons(subjectRef(input));
  return {
    comparisons: await Promise.all(stored.map(async (comparison) => (comparison.status === 'running'
      ? withStatus(comparison, await scope.evaluation.listEvalRunsOfComparison(comparison.id))
      : comparison))),
  };
}

/** Stops a Comparison and every run it prepared that has not finished; a reused baseline is left as it is. */
export async function cancelComparison(input: CancelComparisonInput, scope: CallerScope): Promise<ComparisonOutput> {
  const stored = await loadComparison(scope, input.comparisonId);
  await loadEvaluationSubject(scope, subjectRef(stored), 'run');
  const comparison = withStatus(stored, await scope.evaluation.listEvalRunsOfComparison(stored.id));
  if (comparison.status !== 'prepared' && comparison.status !== 'running') {
    throw new ConflictError(`Comparison '${comparison.id}' is already ${comparison.status}`);
  }
  await abandon(scope, comparison, comparison.status);
  await appendEvaluationAudit(scope, {
    action: 'eval_comparison.cancelled',
    description: `Comparison '${comparison.id}' cancelled`,
    namespace: comparison.namespace,
    entityType: 'eval_comparison',
    entityId: comparison.id,
    inputSnapshot: {},
    basis: 'A person stopped the Comparison',
  });
  return comparisonOutput(scope, comparison.id);
}
