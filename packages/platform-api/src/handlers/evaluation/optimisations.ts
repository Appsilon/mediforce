import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import {
  CHAMPION_VARIANT_ID,
  EVALUATION_ASSISTANT_DEFAULT_MODEL,
  StepVariantPatchSchema,
  type EvalOptimisation,
  type EvalOptimisationStatus,
} from '@mediforce/platform-core';
import { GEPA_REFLECTION_MINIBATCH_SIZE, runGepaJob, type GepaJobOutcome, type GepaReflectiveRecord } from '@mediforce/agent-runtime';
import type {
  EvalOptimisationOutput,
  GetOptimisationInput,
  ListOptimisationsInput,
  ListOptimisationsOutput,
  StartOptimisationInputSchema,
} from '../../contract/evaluation';
import type { CallerScope } from '../../repositories/index';
import { NotFoundError, ValidationError } from '../../errors';
import { requireOpenRouterApiKey } from '../../services/openrouter-key';
import { appendEvaluationAudit, authorId } from './_lib/audit';
import { isSameStep, loadEvaluatedStep, stepRef } from './_lib/evaluated-step';
import { loadModelPrices, type ModelPrice } from './_lib/model-prices';
import { optimisationResults } from './_lib/optimisation-results';
import { reflectiveDataset } from './_lib/reflective-dataset';
import { prepareEvalRun, startEvalRun } from './eval-runs';

const JOB_TIMEOUT_MS = 10 * 60_000;
const JOB_HEARTBEAT_INTERVAL_MS = 60_000;
/** A proposing optimisation silent this long died with its process; the platform heartbeat fails it. */
const STALE_HEARTBEAT_MS = 5 * JOB_HEARTBEAT_INTERVAL_MS;
const REFLECTION_MAX_OUTPUT_TOKENS = 4000;
/** The reflection prompt's own instructions around the current prompt and the records, in characters. */
const REFLECTION_TEMPLATE_CHARS = 4000;
/** Fewer characters per token than most text has, so the worst case errs high. */
const CHARS_PER_TOKEN = 3;
/** The candidates' Eval Run starts this many trials at a time, as an Eval Run prepared by the assistant does. */
const EVAL_CONCURRENCY = 2;

async function loadOptimisation(scope: CallerScope, optimisationId: string): Promise<EvalOptimisation> {
  const optimisation = await scope.evaluation.getOptimisation(optimisationId);
  if (optimisation === null) throw new NotFoundError(`Optimisation '${optimisationId}' not found`);
  return optimisation;
}

async function optimisationOutput(scope: CallerScope, optimisation: EvalOptimisation): Promise<EvalOptimisationOutput> {
  const { jobCostUsd } = optimisation;
  const run = optimisation.evalRunId === null ? null : await scope.evaluation.getEvalRun(optimisation.evalRunId);
  if (run === null) return { optimisation, evalRun: null, spentUsd: jobCostUsd, baseline: null, ranking: [] };
  const { baseline, ranking } = await optimisationResults(scope, optimisation, run);
  return {
    optimisation,
    evalRun: { id: run.id, status: run.status, budgetUsd: run.budgetUsd, spentUsd: run.spentUsd },
    spentUsd: jobCostUsd === null ? null : jobCostUsd + run.spentUsd,
    baseline,
    ranking,
  };
}

/** Moves the optimisation to `failed` from `from`, audited; a no-op when another writer moved it first. */
async function failOptimisation(
  scope: CallerScope,
  optimisation: EvalOptimisation,
  from: EvalOptimisationStatus,
  error: string,
): Promise<void> {
  const failed: EvalOptimisation = { ...optimisation, status: 'failed', error };
  if (await scope.evaluation.transitionOptimisation(optimisation.id, from, failed) === false) return;
  await appendEvaluationAudit(scope, {
    action: 'eval_optimisation.failed',
    description: `Optimisation '${optimisation.id}' of step '${optimisation.stepId}' failed: ${error}`,
    namespace: optimisation.namespace,
    entityType: 'eval_optimisation',
    entityId: optimisation.id,
    inputSnapshot: {},
    outputSnapshot: { error, jobCostUsd: optimisation.jobCostUsd, candidates: optimisation.candidates },
    basis: 'The GEPA optimisation stopped before its candidates were evaluated',
  });
}

/** What the reflection calls cost at the registry's price; the start refused a model it does not price. */
async function jobCost(scope: CallerScope, model: string, usage: GepaJobOutcome['usage']): Promise<number> {
  const priceOf = await loadModelPrices(scope);
  return usage.reduce((sum, call) =>
    sum + (priceOf(model, { inputTokens: call.promptTokens, outputTokens: call.completionTokens }) ?? 0), 0);
}

/** The most the job can spend: every call on the largest records and at its full output allowance. */
function worstCaseJobCostUsd(
  priceOf: ModelPrice,
  model: string,
  currentPrompt: string,
  records: readonly GepaReflectiveRecord[],
  candidates: number,
): number {
  const largest = records.map((record) => JSON.stringify(record).length).sort((left, right) => right - left)
    .slice(0, GEPA_REFLECTION_MINIBATCH_SIZE);
  const inputChars = REFLECTION_TEMPLATE_CHARS + currentPrompt.length + largest.reduce((sum, length) => sum + length, 0);
  const perCall = priceOf(model, { inputTokens: Math.ceil(inputChars / CHARS_PER_TOKEN), outputTokens: REFLECTION_MAX_OUTPUT_TOKENS });
  return candidates * (perCall ?? 0);
}

/**
 * Runs `work` while stamping the optimisation's heartbeat, so the sweep leaves
 * a live job alone however long it waits in the container queue.
 */
async function whileBeating<Result>(scope: CallerScope, optimisation: EvalOptimisation, work: () => Promise<Result>): Promise<Result> {
  let beat: Promise<unknown> = Promise.resolve();
  const timer = setInterval(() => {
    beat = beat
      .then(() => scope.evaluation.transitionOptimisation(optimisation.id, 'proposing', { ...optimisation, heartbeatAt: new Date().toISOString() }))
      .catch((err) => console.warn(`[optimisation] Could not stamp the heartbeat of '${optimisation.id}':`, err));
  }, JOB_HEARTBEAT_INTERVAL_MS);
  try {
    return await work();
  } finally {
    clearInterval(timer);
    await beat;
  }
}

/**
 * The job, then the candidates' Eval Run: runs the GEPA container job, keeps
 * the prompts it proposed that differ from the current one and from each
 * other, and runs them as challengers over the Step's newest Dataset — dev and
 * holdout — with what is left of the budget, confirmed by the person's grant.
 * Runs after `startOptimisation` has answered; never throws.
 */
export async function proposeAndEvaluate(
  scope: CallerScope,
  optimisation: EvalOptimisation,
  currentPrompt: string,
  records: readonly GepaReflectiveRecord[],
): Promise<void> {
  let current = optimisation;
  try {
    const apiKey = await requireOpenRouterApiKey(scope, optimisation.namespace);
    const outcome = await whileBeating(scope, optimisation, () => runGepaJob({
      input: {
        reflectionModel: optimisation.reflectionModel,
        currentPrompt,
        candidates: optimisation.candidateCount,
        maxOutputTokens: REFLECTION_MAX_OUTPUT_TOKENS,
        minibatchSize: GEPA_REFLECTION_MINIBATCH_SIZE,
        records,
      },
      apiKey,
      timeoutMs: JOB_TIMEOUT_MS,
      label: optimisation.id.slice(0, 12),
    }));
    const jobCostUsd = await jobCost(scope, optimisation.reflectionModel, outcome.usage);
    const seen = new Set([currentPrompt.trim()]);
    const candidates = outcome.candidates.flatMap((candidate) => {
      const prompt = candidate.prompt.trim();
      if (seen.has(prompt) || StepVariantPatchSchema.safeParse({ ...optimisation.basePatch, prompt }).success === false) return [];
      seen.add(prompt);
      return [{ prompt, reflectedOn: candidate.reflectedOn }];
    }).map((candidate, index) => ({ variantId: null, label: `GEPA candidate ${index + 1}`, ...candidate }));
    // A job that stopped part-way still hands over what it proposed; its error says why there are fewer.
    current = { ...current, jobCostUsd, candidates, error: outcome.error };

    if (candidates.length === 0) {
      await failOptimisation(scope, current, 'proposing', outcome.error ?? 'The job proposed no prompt that differs from the current one');
      return;
    }
    const remainingUsd = Math.floor((optimisation.budgetUsd - jobCostUsd) * 100) / 100;
    if (remainingUsd <= 0) {
      await failOptimisation(scope, current, 'proposing', `The job spent $${jobCostUsd.toFixed(4)} of the $${optimisation.budgetUsd} budget; nothing is left to evaluate its candidates`);
      return;
    }

    const { evalRun } = await prepareEvalRun({
      ...stepRef(optimisation),
      challengers: candidates.map((candidate) => ({ label: candidate.label, patch: { ...optimisation.basePatch, prompt: candidate.prompt } })),
      trialsPerCase: optimisation.trialsPerCase,
      concurrency: EVAL_CONCURRENCY,
      budgetUsd: remainingUsd,
    }, scope);
    const evaluating: EvalOptimisation = {
      ...current,
      status: 'evaluating',
      evalRunId: evalRun.id,
      candidates: candidates.map((candidate, index) => ({ ...candidate, variantId: evalRun.variants[index + 1]!.id })),
    };
    // Moved on by the heartbeat meanwhile: its prepared run is left for a person to start or ignore.
    if (await scope.evaluation.transitionOptimisation(optimisation.id, 'proposing', evaluating) === false) return;
    current = evaluating;
    await appendEvaluationAudit(scope, {
      action: 'eval_optimisation.proposed',
      description: `Optimisation '${optimisation.id}' proposed ${candidates.length} prompt(s) for step '${optimisation.stepId}' at $${jobCostUsd.toFixed(4)}; Eval Run '${evalRun.id}' runs them with $${remainingUsd}`,
      namespace: optimisation.namespace,
      entityType: 'eval_optimisation',
      entityId: optimisation.id,
      inputSnapshot: { reflectionModel: optimisation.reflectionModel, records: records.length },
      outputSnapshot: { candidates: evaluating.candidates, jobCostUsd, jobError: outcome.error, evalRunId: evalRun.id, evalRunBudgetUsd: remainingUsd },
      basis: 'GEPA proposed candidate prompts; their Eval Run starts under the budget the person granted (ADR-0023 D15)',
    });
    await startEvalRun({ evalRunId: evalRun.id, confirmedBudgetUsd: evalRun.budgetUsd }, scope);
  } catch (err) {
    await failOptimisation(scope, current, current.status, err instanceof Error ? err.message : String(err))
      .catch((auditErr) => console.error(`[optimisation] Could not record the failure of '${optimisation.id}':`, auditErr));
  }
}

/**
 * Starts a GEPA optimisation of the Step's prompt (ADR-0023 D15) from a
 * finished Eval Run. The request's `budgetUsd` is the person's grant: it must
 * cover the job's worst case at the reflection model's registry price, the job
 * is charged what it spent, and the candidates' Eval Run gets what is left. Returns at once, `proposing`; the job and the
 * run go on in the background.
 */
export async function startOptimisation(
  input: z.output<typeof StartOptimisationInputSchema>,
  scope: CallerScope,
): Promise<EvalOptimisationOutput> {
  const step = stepRef(input);
  await loadEvaluatedStep(scope, step, 'run');

  const source = await scope.evaluation.getEvalRun(input.evalRunId);
  if (source === null || isSameStep(source, step) === false) {
    throw new NotFoundError(`Eval Run '${input.evalRunId}' is not a run of step '${step.stepId}'`);
  }
  if (source.status === 'prepared' || source.status === 'running') {
    throw new ValidationError(`Eval Run '${source.id}' is ${source.status}; optimise from a finished run`);
  }
  const variantId = input.variantId ?? CHAMPION_VARIANT_ID;
  const variant = source.variants.find((candidate) => candidate.id === variantId);
  if (variant === undefined) {
    throw new NotFoundError(`Eval Run '${source.id}' has no variant '${variantId}'; its variants are ${source.variants.map((candidate) => candidate.id).join(', ')}`);
  }
  if (source.evaluators.some((evaluator) => evaluator.counted) === false) {
    throw new ValidationError(`No Evaluator of Eval Run '${source.id}' counts, so there is no feedback to optimise against`);
  }
  const reflectionModel = input.reflectionModel ?? EVALUATION_ASSISTANT_DEFAULT_MODEL;
  const priceOf = await loadModelPrices(scope);
  if (priceOf(reflectionModel, { inputTokens: 0, outputTokens: 0 }) === null) {
    throw new ValidationError(`The model registry has no price for '${reflectionModel}', so the job could not be held to the budget; choose a priced reflection model`);
  }
  await requireOpenRouterApiKey(scope, step.namespace);
  const records = await reflectiveDataset(scope, source, variantId);
  if (records.length === 0) {
    throw new ValidationError(`Variant '${variantId}' of Eval Run '${source.id}' has no scored trial of a dev case to reflect on`);
  }
  // The prompt the source run's feedback was produced by: its variant's, or the Step's in the version the run pinned.
  const { step: sourceStep } = await loadEvaluatedStep(scope, step, 'read', source.definitionVersion);
  const currentPrompt = variant.patch.prompt ?? sourceStep.agent?.prompt ?? '';
  const worstCaseUsd = worstCaseJobCostUsd(priceOf, reflectionModel, currentPrompt, records, input.candidates);
  if (worstCaseUsd >= input.budgetUsd) {
    throw new ValidationError(`The job may spend up to $${worstCaseUsd.toFixed(4)} on ${input.candidates} call(s) to '${reflectionModel}', which leaves nothing of the $${input.budgetUsd} budget for its candidates' Eval Run; grant more, propose fewer candidates, or reflect with a cheaper model`);
  }

  const optimisation: EvalOptimisation = {
    ...step,
    id: randomUUID(),
    sourceEvalRunId: source.id,
    sourceVariantId: variantId,
    basePatch: variant.patch,
    reflectionModel,
    candidateCount: input.candidates,
    trialsPerCase: input.trialsPerCase,
    budgetUsd: input.budgetUsd,
    jobCostUsd: null,
    candidates: [],
    evalRunId: null,
    status: 'proposing',
    error: null,
    heartbeatAt: null,
    createdBy: authorId(scope),
    createdAt: new Date().toISOString(),
  };
  await scope.evaluation.createOptimisation(optimisation);
  await appendEvaluationAudit(scope, {
    action: 'eval_optimisation.started',
    description: `GEPA optimisation of step '${step.stepId}' started from Eval Run '${source.id}' (${variant.label}) with a budget of $${input.budgetUsd}`,
    namespace: step.namespace,
    entityType: 'eval_optimisation',
    entityId: optimisation.id,
    inputSnapshot: { ...step, evalRunId: source.id, variantId, candidates: input.candidates, trialsPerCase: input.trialsPerCase, reflectionModel },
    outputSnapshot: { budgetUsd: input.budgetUsd, worstCaseJobCostUsd: worstCaseUsd, records: records.length },
    basis: 'A person granted the optimisation its budget (ADR-0023 D15)',
  });

  void proposeAndEvaluate(scope, optimisation, currentPrompt, records);
  return optimisationOutput(scope, optimisation);
}

export async function getOptimisation(input: GetOptimisationInput, scope: CallerScope): Promise<EvalOptimisationOutput> {
  const optimisation = await loadOptimisation(scope, input.optimisationId);
  await loadEvaluatedStep(scope, stepRef(optimisation), 'read');
  return optimisationOutput(scope, optimisation);
}

export async function listOptimisations(input: ListOptimisationsInput, scope: CallerScope): Promise<ListOptimisationsOutput> {
  await loadEvaluatedStep(scope, input, 'read');
  return { optimisations: await scope.evaluation.listOptimisations(stepRef(input)) };
}

/** The platform heartbeat's sweep: a proposing optimisation whose job stopped stamping its heartbeat died with its process. */
export async function failStaleOptimisations(scope: CallerScope): Promise<void> {
  const silentSince = new Date(Date.now() - STALE_HEARTBEAT_MS).toISOString();
  for (const optimisationId of await scope.evaluation.listStaleProposingOptimisationIds(silentSince)) {
    try {
      const optimisation = await loadOptimisation(scope, optimisationId);
      if ((optimisation.heartbeatAt ?? optimisation.createdAt) > silentSince) continue;
      await failOptimisation(scope, optimisation, 'proposing', 'The GEPA job did not finish; the platform may have restarted while it ran');
    } catch (err) {
      console.error(`[optimisation] Failed to sweep optimisation '${optimisationId}':`, err);
    }
  }
}
