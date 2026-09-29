import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runGepaJob, type GepaJobOutcome } from '@mediforce/agent-runtime';
import type { EvalOptimisation, EvalTrial } from '@mediforce/platform-core';
import { buildAgentOutputEnvelope, buildAgentRun, buildStepExecution } from '@mediforce/platform-core/testing';
import { NotFoundError } from '../../../errors';
import type { CallerScope } from '../../../repositories/index';
import { userCaller } from '../../../repositories/__tests__/create-test-scope';
import { createEvalCase } from '../eval-cases';
import { freezeEvalDataset } from '../eval-datasets';
import { advanceEvalRunOfInstance, getEvalRun, prepareEvalRun } from '../eval-runs';
import { failStaleOptimisations, getOptimisation, listOptimisations, startOptimisation } from '../optimisations';
import { STEP, evaluationFixture, type EvaluationFixture } from './fixture';
import { evalScenario, finishEvalRun, type EvalScenario } from './finished-eval-run';

vi.mock('@mediforce/agent-runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@mediforce/agent-runtime')>()),
  runGepaJob: vi.fn(),
}));

const REFLECTION_MODEL = 'anthropic/claude-sonnet-4';
const FIXED_PROMPT = 'Grade each AE by CTCAE v5 and list them under findings.';
const WORSE_PROMPT = 'Summarise the AEs.';

describe('GEPA optimisations (ADR-0023 D15)', () => {
  let fixture: EvaluationFixture;
  let scenario: EvalScenario;
  let scope: CallerScope;
  let holdoutCaseId: string;
  let sourceRunId: string;
  let previousAllowLocal: string | undefined;

  function jobReturns(outcome: Partial<GepaJobOutcome>) {
    vi.mocked(runGepaJob).mockResolvedValue({
      candidates: [],
      usage: [{ promptTokens: 10_000, completionTokens: 1000 }],
      error: null,
      ...outcome,
    });
  }

  /** Until the optimisation leaves `proposing` and, when it evaluates, its Eval Run has kicked its trials. */
  async function settled(optimisationId: string): Promise<EvalOptimisation> {
    let settledOptimisation: EvalOptimisation | null = null;
    await vi.waitFor(async () => {
      const optimisation = await fixture.evaluationRepo.getOptimisation(optimisationId);
      expect(optimisation?.status).not.toBe('proposing');
      if (optimisation?.status === 'evaluating') {
        expect((await fixture.evaluationRepo.getEvalRun(optimisation.evalRunId!))?.status).toBe('running');
      }
      settledOptimisation = optimisation;
    });
    return settledOptimisation!;
  }

  /** Finishes every trial the run kicker starts, with the result `resultOf` gives it, until none is left. */
  async function finishKickedTrials(resultOf: (trial: EvalTrial) => Record<string, unknown>) {
    const finished = new Set<string>();
    for (;;) {
      const next = scenario.kicker.kicks.find((kick) => finished.has(kick.instanceId) === false);
      if (next === undefined) return;
      finished.add(next.instanceId);
      const instance = await fixture.instanceRepo.getById(next.instanceId);
      if (instance?.status === 'completed') continue;
      const trial = (await fixture.evaluationRepo.getTrialByInstanceId(next.instanceId))!;
      const startedAt = new Date().toISOString();
      await fixture.instanceRepo.addStepExecution(next.instanceId, buildStepExecution({
        instanceId: next.instanceId, stepId: 'grade-aes', startedAt,
        agentOutput: {
          confidence: 0.9, confidence_rationale: null, reasoning: null, model: REFLECTION_MODEL,
          duration_ms: 1000, gitMetadata: null, deliverableFile: null, presentation: null,
          tokenUsage: { inputTokens: 1000, outputTokens: 200 }, estimatedCostUsd: 0.1,
        },
      }));
      await fixture.agentRunRepo.create(buildAgentRun({
        processInstanceId: next.instanceId, stepId: 'grade-aes', startedAt, envelope: buildAgentOutputEnvelope({ result: resultOf(trial) }),
      }));
      await fixture.instanceRepo.update(next.instanceId, { status: 'completed', currentStepId: null });
      await advanceEvalRunOfInstance(scope, next.instanceId);
    }
  }

  beforeEach(async () => {
    vi.mocked(runGepaJob).mockReset();
    previousAllowLocal = process.env.ALLOW_LOCAL_AGENTS;
    process.env.ALLOW_LOCAL_AGENTS = 'true';
    fixture = await evaluationFixture();
    scenario = await evalScenario(fixture);
    scope = scenario.scope;
    Object.assign(scope, {
      workspaceSecrets: { getSecrets: async () => ({ OPENROUTER_API_KEY: 'sk-test' }) },
      // $3 per million input tokens, $15 per million output: the job's 10k + 1k tokens cost $0.045.
      models: { list: async () => [{ id: REFLECTION_MODEL, pricing: { input: 0.000003, output: 0.000015 } }] },
    });
    // The champion fails on neutropenia, so there is something to reflect on.
    sourceRunId = await finishEvalRun(fixture, scenario, { trialsPerCase: 1, budgetUsd: 5, challengers: [] },
      (trial) => trial.caseId === scenario.caseIds['Grade 4 neutropenia'] ? { summary: 'no findings' } : { findings: ['graded'] });
    // A holdout case joins the newest Dataset: the candidates are checked on it, the job never sees it.
    const { evalCase } = await createEvalCase({
      ...STEP, name: 'Grade 3 anaemia',
      input: { triggerPayload: { studyId: 'CDISCPILOT01' }, previousStepOutputs: { 'extract-aes': { events: [{ term: 'Anaemia' }] } } },
      workspaceSeedCommit: null, expectation: 'positive', notes: null, split: 'holdout', containsProductionData: false, origin: 'user',
    }, scope);
    holdoutCaseId = evalCase.id;
    await freezeEvalDataset(STEP, scope);
  });

  afterEach(() => {
    if (previousAllowLocal === undefined) delete process.env.ALLOW_LOCAL_AGENTS;
    else process.env.ALLOW_LOCAL_AGENTS = previousAllowLocal;
  });

  it('reflects on the dev trials, runs the new prompts as challengers over dev and holdout, and ranks them', async () => {
    jobReturns({
      candidates: [
        { prompt: WORSE_PROMPT, reflectedOn: 2 },
        { prompt: `  ${FIXED_PROMPT}\n`, reflectedOn: 2 },
        { prompt: FIXED_PROMPT, reflectedOn: 2 },
        { prompt: 'Grade each AE.', reflectedOn: 2 },
      ],
    });

    const started = await startOptimisation({ ...STEP, evalRunId: sourceRunId, budgetUsd: 3, candidates: 3, trialsPerCase: 1 }, scope);
    expect(started.optimisation).toMatchObject({ status: 'proposing', sourceVariantId: 'champion', budgetUsd: 3, reflectionModel: REFLECTION_MODEL });

    // The job reads the dev trials — the failing one first — never the holdout case.
    const [{ input }] = vi.mocked(runGepaJob).mock.calls[0]!;
    expect(input).toMatchObject({ reflectionModel: REFLECTION_MODEL, currentPrompt: 'Grade each AE.', candidates: 3 });
    expect(input.records).toHaveLength(2);
    expect(input.records[0]!.Feedback).toContain('FAIL findings-present (critical): The result lists findings.');
    expect(input.records[0]!.Inputs).toContain('Grade 4 neutropenia');
    expect(input.records[1]!.Feedback).toContain('PASS findings-present');
    expect(JSON.stringify(input.records)).not.toContain('Anaemia');

    const evaluating = await settled(started.optimisation.id);
    // The copy of FIXED_PROMPT and the unchanged prompt are dropped.
    expect(evaluating.jobCostUsd).toBeCloseTo(0.045, 10);
    expect(evaluating).toMatchObject({
      status: 'evaluating',
      candidates: [
        { variantId: 'challenger-1', label: 'GEPA candidate 1', prompt: WORSE_PROMPT },
        { variantId: 'challenger-2', label: 'GEPA candidate 2', prompt: FIXED_PROMPT },
      ],
    });
    const { evalRun } = await getEvalRun({ evalRunId: evaluating.evalRunId! }, scope);
    expect(evalRun.budgetUsd).toBe(2.95);
    expect(evalRun.caseIds).toContain(holdoutCaseId);
    expect(evalRun.variants.map((variant) => variant.patch)).toEqual([{}, { prompt: WORSE_PROMPT }, { prompt: FIXED_PROMPT }]);

    // The step as it is fails neutropenia again; the fixed prompt passes everywhere; the worse one nowhere.
    await finishKickedTrials((trial) => {
      if (trial.variantId === 'challenger-2') return { findings: ['graded'] };
      if (trial.variantId === 'challenger-1') return { summary: 'AEs summarised' };
      return trial.caseId === scenario.caseIds['Grade 4 neutropenia'] ? { summary: 'no findings' } : { findings: ['graded'] };
    });

    const result = await getOptimisation({ optimisationId: started.optimisation.id }, scope);
    expect(result.evalRun?.status).toBe('completed');
    expect(result.spentUsd).toBeCloseTo(0.045 + 0.9, 10);
    expect(result.baseline).toMatchObject({
      variantId: 'champion', prompt: null,
      dev: { cases: 2, graded: 2, passes: 1, passRate: 0.5 },
      holdout: { cases: 1, graded: 1, passes: 1, passRate: 1 },
    });
    expect(result.ranking.map(({ rank, variantId, dev, holdout }) => ({ rank, variantId, dev: dev.passRate, holdout: holdout.passRate }))).toEqual([
      { rank: 1, variantId: 'challenger-2', dev: 1, holdout: 1 },
      { rank: 2, variantId: 'challenger-1', dev: 0, holdout: 0 },
    ]);
    expect((await listOptimisations(STEP, scope)).optimisations.map((row) => row.id)).toEqual([started.optimisation.id]);
    const actions = (await fixture.auditRepo.getByEntity('eval_optimisation', started.optimisation.id)).map((event) => event.action);
    expect(actions).toEqual(expect.arrayContaining(['eval_optimisation.started', 'eval_optimisation.proposed']));
  });

  it('keeps each candidate on the reflected variant\'s patch', async () => {
    const withChallenger = await finishEvalRun(fixture, scenario, {
      trialsPerCase: 1, budgetUsd: 5, challengers: [{ label: 'GPT-5', patch: { model: 'openai/gpt-5', prompt: 'Grade.' } }],
    }, () => ({ summary: 'none' }));
    jobReturns({ candidates: [{ prompt: FIXED_PROMPT, reflectedOn: 2 }] });

    const started = await startOptimisation({ ...STEP, evalRunId: withChallenger, variantId: 'challenger-1', budgetUsd: 3, candidates: 1, trialsPerCase: 1 }, scope);

    expect(vi.mocked(runGepaJob).mock.calls[0]![0].input.currentPrompt).toBe('Grade.');
    const evaluating = await settled(started.optimisation.id);
    const { evalRun } = await getEvalRun({ evalRunId: evaluating.evalRunId! }, scope);
    expect(evalRun.variants[1]!.patch).toEqual({ model: 'openai/gpt-5', prompt: FIXED_PROMPT });
  });

  it('fails with what the job spent when it proposes nothing new, errors, or leaves no budget', async () => {
    jobReturns({ candidates: [{ prompt: 'Grade each AE.', reflectedOn: 2 }] });
    const unchanged = await startOptimisation({ ...STEP, evalRunId: sourceRunId, budgetUsd: 3, candidates: 1, trialsPerCase: 1 }, scope);
    const unchangedFailed = await settled(unchanged.optimisation.id);
    expect(unchangedFailed).toMatchObject({ status: 'failed', evalRunId: null, error: 'The job proposed no prompt that differs from the current one' });
    expect(unchangedFailed.jobCostUsd).toBeCloseTo(0.045, 10);

    jobReturns({ error: 'the reflection model answered HTTP 500: upstream down' });
    const errored = await startOptimisation({ ...STEP, evalRunId: sourceRunId, budgetUsd: 3, candidates: 1, trialsPerCase: 1 }, scope);
    expect(await settled(errored.optimisation.id)).toMatchObject({ status: 'failed', error: 'the reflection model answered HTTP 500: upstream down' });

    jobReturns({ candidates: [{ prompt: FIXED_PROMPT, reflectedOn: 2 }] });
    const broke = await startOptimisation({ ...STEP, evalRunId: sourceRunId, budgetUsd: 0.05, candidates: 1, trialsPerCase: 1 }, scope);
    const failed = await settled(broke.optimisation.id);
    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('The job spent $0.0450 of the $0.05 budget');

    vi.mocked(runGepaJob).mockRejectedValue(new Error('the GEPA job wrote no result'));
    const crashed = await startOptimisation({ ...STEP, evalRunId: sourceRunId, budgetUsd: 3, candidates: 1, trialsPerCase: 1 }, scope);
    expect(await settled(crashed.optimisation.id)).toMatchObject({ status: 'failed', jobCostUsd: null, error: 'the GEPA job wrote no result' });
  });

  it('refuses what it cannot hold to the budget or reflect on', async () => {
    const start = (overrides: Record<string, unknown>) =>
      startOptimisation({ ...STEP, evalRunId: sourceRunId, budgetUsd: 3, candidates: 3, trialsPerCase: 1, ...overrides }, scope);

    await expect(start({ reflectionModel: 'acme/unpriced' })).rejects.toThrow(/no price for 'acme\/unpriced'/);
    await expect(start({ variantId: 'challenger-9' })).rejects.toThrow(NotFoundError);
    await expect(start({ evalRunId: '00000000-0000-4000-8000-000000000000' })).rejects.toThrow(NotFoundError);
    const { evalRun: prepared } = await prepareEvalRun({ ...STEP, challengers: [], trialsPerCase: 1, concurrency: 1, budgetUsd: 1 }, scope);
    await expect(start({ evalRunId: prepared.id })).rejects.toThrow(/is prepared; optimise from a finished run/);
    await expect(startOptimisation(
      { ...STEP, evalRunId: sourceRunId, budgetUsd: 3, candidates: 3, trialsPerCase: 1 },
      fixture.scope(userCaller('outsider-1', ['pharma-b'])),
    )).rejects.toThrow(NotFoundError);
    Object.assign(scope, { workspaceSecrets: { getSecrets: async () => ({}) } });
    await expect(start({})).rejects.toThrow(/OPENROUTER_API_KEY not configured/);
    expect(runGepaJob).not.toHaveBeenCalled();
  });

  it('fails an optimisation whose job outlived its timeout', async () => {
    const stale: EvalOptimisation = {
      ...STEP,
      id: '11111111-1111-4111-8111-111111111111',
      sourceEvalRunId: sourceRunId,
      sourceVariantId: 'champion',
      basePatch: {},
      reflectionModel: REFLECTION_MODEL,
      candidateCount: 3,
      trialsPerCase: 1,
      budgetUsd: 3,
      jobCostUsd: null,
      candidates: [],
      evalRunId: null,
      status: 'proposing',
      error: null,
      createdBy: 'author-1',
      createdAt: new Date(Date.now() - 60 * 60_000).toISOString(),
    };
    const fresh = { ...stale, id: '22222222-2222-4222-8222-222222222222', createdAt: new Date().toISOString() };
    await fixture.evaluationRepo.createOptimisation(stale);
    await fixture.evaluationRepo.createOptimisation(fresh);

    await failStaleOptimisations(fixture.scope({ kind: 'apiKey', isSystemActor: true }));

    expect(await fixture.evaluationRepo.getOptimisation(stale.id)).toMatchObject({ status: 'failed', error: expect.stringContaining('did not finish') });
    expect((await fixture.evaluationRepo.getOptimisation(fresh.id))?.status).toBe('proposing');
  });
});
