import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WorkflowEngine } from '@mediforce/workflow-engine';
import { buildAgentOutputEnvelope, buildAgentRun, buildStepExecution } from '@mediforce/platform-core/testing';
import { noopRunKicker, type NoopRunKicker } from '../../../runtime/run-kicker';
import { ConflictError, ValidationError } from '../../../errors';
import type { CallerScope } from '../../../repositories/index';
import { createEvaluator } from '../evaluators';
import { createEvalCase } from '../eval-cases';
import { saveEvalDataset } from '../eval-datasets';
import { advanceEvalRunOfInstance, getEvalRun, listEvalRuns, prepareEvalRun, startEvalRun } from '../eval-runs';
import { cancelComparison, getComparison, listComparisons, prepareComparison, startComparison } from '../comparisons';
import { evaluationFixture, registryEntry, STEP, type EvaluationFixture } from './fixture';

const VARIANT = { model: 'openai/gpt-5' };

describe('Comparisons (ADR-0024 D4, D5)', () => {
  let fixture: EvaluationFixture;
  let kicker: NoopRunKicker;
  let scope: CallerScope;
  let previousAllowLocal: string | undefined;

  afterEach(() => {
    vi.restoreAllMocks();
    if (previousAllowLocal === undefined) delete process.env.ALLOW_LOCAL_AGENTS;
    else process.env.ALLOW_LOCAL_AGENTS = previousAllowLocal;
  });

  beforeEach(async () => {
    previousAllowLocal = process.env.ALLOW_LOCAL_AGENTS;
    process.env.ALLOW_LOCAL_AGENTS = 'true';
    fixture = await evaluationFixture();
    kicker = noopRunKicker();
    scope = fixture.scope();
    Object.assign(scope.system, {
      engine: new WorkflowEngine(fixture.processRepo, fixture.instanceRepo, fixture.auditRepo),
      runKicker: kicker,
    });
    await createEvaluator({ ...STEP, name: 'findings-present', rule: 'The result lists findings.', check: { kind: 'schema', schema: { required: ['findings'] } }, origin: 'user' }, scope);
    for (const [name, split] of [['Grade 5 sepsis', 'dev'], ['Grade 4 neutropenia', 'holdout']] as const) {
      await createEvalCase({
        ...STEP,
        name,
        input: { triggerPayload: { studyId: 'CDISCPILOT01' }, previousStepOutputs: { 'extract-aes': { events: [{ term: name }] } } },
        workspaceSeedCommit: 'a1b2c3d4',
        expectation: 'positive',
        expectedOutput: null, comparison: 'exact', agreementInstructions: null, evaluatorIds: null,
        split,
        containsProductionData: false,
        origin: 'user',
      }, scope);
    }
    await saveEvalDataset(STEP, scope);
  });

  /** Plays the auto-runner for every trial kicked so far: a baseline trial lists no findings, a Variant's does. */
  async function finishKickedTrials(variantRunIds: ReadonlySet<string>) {
    for (const { instanceId } of kicker.kicks) {
      const instance = await fixture.instanceRepo.getById(instanceId);
      if (instance === null || instance.status !== 'running') continue;
      const startedAt = new Date().toISOString();
      await fixture.instanceRepo.addStepExecution(instanceId, buildStepExecution({
        instanceId, stepId: 'grade-aes', startedAt,
        agentOutput: {
          confidence: 0.9, confidence_rationale: null, reasoning: null, model: 'anthropic/claude-sonnet-5',
          duration_ms: 1000, gitMetadata: null, tokenUsage: { inputTokens: 100, outputTokens: 20 }, estimatedCostUsd: 0.1,
        },
      }));
      const result = variantRunIds.has(instance.evalRunId ?? '') ? { findings: ['sepsis: 5'] } : { summary: 'nothing' };
      await fixture.agentRunRepo.create(buildAgentRun({ processInstanceId: instanceId, stepId: 'grade-aes', startedAt, envelope: buildAgentOutputEnvelope({ result }) }));
      await fixture.instanceRepo.update(instanceId, { status: 'completed', currentStepId: null });
      await advanceEvalRunOfInstance(scope, instanceId);
    }
  }

  it('prepares its own baseline when none matches, on one budget rounded up to whole cents per run', async () => {
    const { comparison, baseline, variants } = await prepareComparison({ ...STEP, variants: [VARIANT], trialsPerCase: 1, concurrency: 2, budgetUsdPerRun: 0.001 }, scope);

    expect(comparison).toMatchObject({ status: 'prepared', baselineReused: false, budgetUsd: 0.02, trialsPerCase: 1 });
    expect(baseline.evalRun).toMatchObject({ id: comparison.baselineEvalRunId, variant: null, comparisonId: comparison.id, budgetUsd: 0.01 });
    expect(variants.map((variant) => variant.evalRun)).toEqual([expect.objectContaining({ variant: VARIANT, comparisonId: comparison.id, budgetUsd: 0.01 })]);
    expect(variants[0]!.evalRun.definitionVersion).toBe(baseline.evalRun.definitionVersion);
    expect(variants[0]!.evalRun.datasetVersionId).toBe(baseline.evalRun.datasetVersionId);
  });

  it('keeps a Comparison\'s own baseline run out of the subject\'s plain Eval Runs and its validation', async () => {
    const { comparison } = await prepareComparison({ ...STEP, variants: [VARIANT], trialsPerCase: 1, concurrency: 2, budgetUsdPerRun: 0.001 }, scope);

    const { evalRuns } = await listEvalRuns(STEP, scope);
    expect(evalRuns.map((run) => run.id)).not.toContain(comparison.baselineEvalRunId);
  });

  it('refuses an empty or repeated Variant, and a named baseline that differs in a frozen input', async () => {
    await expect(prepareComparison({ ...STEP, variants: [{}], trialsPerCase: 1, concurrency: 1, budgetUsdPerRun: 1 }, scope)).rejects.toThrow(/must change/);
    await expect(prepareComparison({ ...STEP, variants: [VARIANT, VARIANT], trialsPerCase: 1, concurrency: 1, budgetUsdPerRun: 1 }, scope)).rejects.toThrow(/the same/);
    const { evalRun } = await prepareEvalRun({ ...STEP, trialsPerCase: 1, concurrency: 1, budgetUsd: 1 }, scope);
    await expect(prepareComparison({ ...STEP, variants: [VARIANT], baselineEvalRunId: evalRun.id, trialsPerCase: 2, concurrency: 1, budgetUsdPerRun: 1 }, scope))
      .rejects.toThrow(/not completed.*trials per case/);
    expect((await listComparisons(STEP, scope)).comparisons).toEqual([]);
  });

  it('reuses a finished matching baseline, starts on the confirmed sum only, and reads completed without writing it', async () => {
    const { evalRun } = await prepareEvalRun({ ...STEP, trialsPerCase: 1, concurrency: 2, budgetUsd: 1 }, scope);
    await startEvalRun({ evalRunId: evalRun.id, confirmedBudgetUsd: 1 }, scope);
    await finishKickedTrials(new Set());
    expect((await getEvalRun({ evalRunId: evalRun.id }, scope)).evalRun.status).toBe('completed');

    const prepared = await prepareComparison({ ...STEP, variants: [VARIANT], trialsPerCase: 1, concurrency: 2, budgetUsdPerRun: 1 }, scope);
    expect(prepared.comparison).toMatchObject({ baselineEvalRunId: evalRun.id, baselineReused: true, budgetUsd: 1 });
    const comparisonId = prepared.comparison.id;

    await expect(startComparison({ comparisonId }, scope)).rejects.toBeInstanceOf(ValidationError);
    await expect(startComparison({ comparisonId, confirmedBudgetUsd: 2 }, scope)).rejects.toBeInstanceOf(ValidationError);
    await startComparison({ comparisonId, confirmedBudgetUsd: 1 }, scope);
    await finishKickedTrials(new Set([prepared.variants[0]!.evalRun.id]));

    const finished = await getComparison({ comparisonId }, scope);
    expect(finished.comparison.status).toBe('completed');
    expect(finished.baseline.evalRun.spentUsd).toBeCloseTo(0.2, 10);
    // Both cases are won; with a split, dev and holdout are read apart and the prompt-free Variant reads every case.
    expect(finished.variants[0]!.calls.map((call) => [call.scope, call.wins, call.losses, call.call])).toEqual([
      ['all', 2, 0, 'too_few_cases'],
      ['dev', 1, 0, 'too_few_cases'],
      ['holdout', 1, 0, 'too_few_cases'],
    ]);
    expect(finished.variants[0]!).toMatchObject({ recommendationScope: 'all', scoredTrials: 2, meanAgentCostUsd: 0.1 });
    expect((await listComparisons(STEP, scope)).comparisons.map((comparison) => comparison.status)).toEqual(['completed']);
    expect((await fixture.evaluationRepo.getComparison(comparisonId))?.status).toBe('running');
    await expect(cancelComparison({ comparisonId }, scope)).rejects.toThrow(/already completed/);
    expect((await listEvalRuns(STEP, scope)).evalRuns.map((run) => run.id)).toEqual([evalRun.id]);
  });

  it('cancels a Comparison whose run cannot be prepared, with the runs it already prepared', async () => {
    const createEvalRun = fixture.evaluationRepo.createEvalRun.bind(fixture.evaluationRepo);
    let calls = 0;
    vi.spyOn(fixture.evaluationRepo, 'createEvalRun').mockImplementation(async (run, trials) => {
      calls += 1;
      if (calls === 2) throw new Error('database went away');
      await createEvalRun(run, trials);
    });

    await expect(prepareComparison({ ...STEP, variants: [VARIANT], trialsPerCase: 1, concurrency: 1, budgetUsdPerRun: 1 }, scope)).rejects.toThrow(/database went away/);
    const [comparison] = (await listComparisons(STEP, scope)).comparisons;
    expect(comparison?.status).toBe('cancelled');
    expect((await fixture.evaluationRepo.listEvalRunsOfComparison(comparison!.id)).map((run) => run.status)).toEqual(['cancelled']);
  });

  it('cancels a Comparison whose run cannot start, rather than leave it half-started', async () => {
    const prepared = await prepareComparison({ ...STEP, variants: [VARIANT], trialsPerCase: 1, concurrency: 1, budgetUsdPerRun: 1 }, scope);
    await fixture.modelRegistryRepo.upsert(registryEntry(VARIANT.model, { retiredAt: '2026-11-01T00:00:00Z' }));

    await expect(startComparison({ comparisonId: prepared.comparison.id, confirmedBudgetUsd: 2 }, scope)).rejects.toThrow(/retired/);
    const after = await getComparison({ comparisonId: prepared.comparison.id }, scope);
    expect(after.comparison.status).toBe('cancelled');
    expect([after.baseline, ...after.variants].map((run) => run.evalRun.status)).toEqual(['cancelled', 'cancelled']);
  });

  it('cancels a prepared Comparison and every run it prepared', async () => {
    const prepared = await prepareComparison({ ...STEP, variants: [VARIANT], trialsPerCase: 1, concurrency: 1, budgetUsdPerRun: 1 }, scope);
    const cancelled = await cancelComparison({ comparisonId: prepared.comparison.id }, scope);

    expect(cancelled.comparison.status).toBe('cancelled');
    expect([cancelled.baseline, ...cancelled.variants].map((run) => run.evalRun.status)).toEqual(['cancelled', 'cancelled']);
    await expect(startComparison({ comparisonId: prepared.comparison.id, confirmedBudgetUsd: 2 }, scope)).rejects.toBeInstanceOf(ConflictError);
  });
});
