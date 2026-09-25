import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WorkflowEngine } from '@mediforce/workflow-engine';
import { buildAgentOutputEnvelope, buildAgentRun, buildStepExecution } from '@mediforce/platform-core/testing';
import { noopRunKicker, type NoopRunKicker } from '../../../runtime/run-kicker';
import { ConflictError, ValidationError } from '../../../errors';
import type { CallerScope } from '../../../repositories/index';
import { createEvaluator } from '../evaluators';
import { createEvalCase } from '../eval-cases';
import { freezeEvalDataset } from '../eval-datasets';
import { listStepAgentRuns } from '../step-agent-runs';
import { advanceEvalRunOfInstance, cancelEvalRun, getEvalRun, prepareEvalRun, startEvalRun } from '../eval-runs';
import { setEvaluationBrief } from '../briefs';
import { setAcceptanceCriteria } from '../acceptance-criteria';
import { evaluationFixture, GRADED_RUN, STEP, UNGRADED_RUN, type EvaluationFixture } from './fixture';

describe('Eval Runs (ADR-0023 D4, D10)', () => {
  let fixture: EvaluationFixture;
  let kicker: NoopRunKicker;
  let scope: CallerScope;
  let previousAllowLocal: string | undefined;

  afterEach(() => {
    vi.unstubAllGlobals();
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

    await createEvaluator({ ...STEP, name: 'findings-present', rule: 'The result lists findings.', severity: 'critical', check: { kind: 'schema', schema: { required: ['findings'] } }, origin: 'user' }, scope);
    await createEvaluator({ ...STEP, name: 'fatal-flagged', rule: 'A fatal AE is flagged.', severity: 'major', check: { kind: 'code', runtime: 'python', source: 'print(1)' }, origin: 'assistant' }, scope);
    for (const name of ['Grade 5 sepsis', 'Grade 4 neutropenia']) {
      await createEvalCase({
        ...STEP,
        name,
        input: { triggerPayload: { studyId: 'CDISCPILOT01' }, previousStepOutputs: { 'extract-aes': { events: [{ term: name }] } } },
        workspaceSeedCommit: 'a1b2c3d4',
        expectation: 'positive',
        notes: null,
        split: 'dev',
        containsProductionData: false,
        origin: 'user',
      }, scope);
    }
    await freezeEvalDataset(STEP, scope);
  });

  /** Plays the auto-runner: the trial's agent step ran and produced `result` at `costUsd`. */
  async function finishTrial(instanceId: string, result: Record<string, unknown>, costUsd: number) {
    const startedAt = new Date().toISOString();
    await fixture.instanceRepo.addStepExecution(instanceId, buildStepExecution({
      instanceId,
      stepId: 'grade-aes',
      startedAt,
      agentOutput: {
        confidence: 0.9, confidence_rationale: null, reasoning: null, model: 'anthropic/claude-sonnet-4',
        duration_ms: 4200, gitMetadata: null, deliverableFile: null, presentation: null,
        tokenUsage: { inputTokens: 1000, outputTokens: 200 },
        estimatedCostUsd: costUsd,
      },
    }));
    await fixture.agentRunRepo.create(buildAgentRun({
      processInstanceId: instanceId, stepId: 'grade-aes', startedAt, envelope: buildAgentOutputEnvelope({ result }),
    }));
    await fixture.instanceRepo.update(instanceId, { status: 'completed', currentStepId: null });
    await advanceEvalRunOfInstance(scope, instanceId);
  }

  it('freezes the Evaluators with whether they count, denies MCP by default, and needs a budget without an estimate', async () => {
    await expect(prepareEvalRun({ ...STEP, challengers: [], trialsPerCase: 2, concurrency: 2 }, scope)).rejects.toThrow(/set budgetUsd/);

    const { evalRun, trials, report } = await prepareEvalRun({ ...STEP, challengers: [], trialsPerCase: 2, concurrency: 2, budgetUsd: 5 }, scope);

    expect(evalRun).toMatchObject({ status: 'prepared', trialsPerCase: 2, budgetUsd: 5, definitionVersion: 1 });
    expect(evalRun.evaluators.map((evaluator) => [evaluator.name, evaluator.counted, evaluator.reason])).toEqual([
      ['fatal-flagged', false, 'source not approved'],
      ['findings-present', true, undefined],
    ]);
    expect(evalRun.mcpPolicy).toEqual({ edc: { mode: 'deny' }, email: { mode: 'deny' } });
    expect(evalRun.estimate).toMatchObject({ perTrialUsd: null, totalUsd: null, basis: 'unknown', sampleSize: 0 });
    expect(trials).toHaveLength(4);
    expect(report.trials).toMatchObject({ total: 4, inProgress: 4 });
  });

  it('runs the champion and each challenger over every case, freezing the criteria and Brief in force', async () => {
    await setEvaluationBrief({ ...STEP, text: 'Grades AEs for the DSMB.', origin: 'user' }, scope);
    await setAcceptanceCriteria({ ...STEP, criteria: { critical: { minPassRate: 0.9 } }, origin: 'user' }, scope);

    const { evalRun, trials } = await prepareEvalRun({
      ...STEP, trialsPerCase: 2, concurrency: 2, budgetUsd: 5,
      challengers: [
        { label: 'GPT-5', patch: { model: 'openai/gpt-5' } },
        { label: 'No email', patch: { mcpRestrictions: { email: { disable: true } } } },
      ],
    }, scope);

    expect(evalRun.variants.map((variant) => [variant.id, variant.label])).toEqual([
      ['champion', 'Current step'], ['challenger-1', 'GPT-5'], ['challenger-2', 'No email'],
    ]);
    const [champion, gpt, noEmail] = evalRun.variants;
    expect(gpt!.fingerprint!.hash).not.toBe(champion!.fingerprint!.hash);
    expect(noEmail!.fingerprint!.components.mcpServers).not.toBe(champion!.fingerprint!.components.mcpServers);
    expect(evalRun).toMatchObject({ acceptanceCriteria: { critical: { minPassRate: 0.9 } }, briefVersion: 1 });
    expect(trials).toHaveLength(2 * 3 * 2);
    expect(new Set(trials.map((trial) => trial.variantId))).toEqual(new Set(['champion', 'challenger-1', 'challenger-2']));
    expect(evalRun.estimate.variants?.map((variant) => variant.variantId)).toEqual(['champion', 'challenger-1', 'challenger-2']);
  });

  it('refuses a challenger that changes nothing, runs the champion again, or does not apply', async () => {
    const prepare = (patch: Record<string, unknown>) => prepareEvalRun({
      ...STEP, trialsPerCase: 1, concurrency: 1, budgetUsd: 5, challengers: [{ label: 'Challenger', patch }],
    }, scope);

    await expect(prepare({})).rejects.toThrow(/changes nothing/);
    // The agent's own model: the same step the champion runs.
    await expect(prepare({ model: 'anthropic/claude-sonnet-4' })).rejects.toThrow(/runs the same step as 'Current step'/);
    await expect(prepare({ skillCommit: 'abcdef1' })).rejects.toThrow(/has none/);
    await expect(prepare({ mcpRestrictions: { slack: { disable: true } } })).rejects.toThrow(/does not bind: slack/);
    expect(await fixture.evaluationRepo.listEvalRuns(STEP)).toEqual([]);
  });

  it('leaves out the cases a variant\'s few-shot examples came from, and refuses holdout ones (D12)', async () => {
    const cases = await fixture.evaluationRepo.listCases(STEP);
    const caseId = (name: string) => cases.find((evalCase) => evalCase.name === name)!.id;
    const example = (fromCase: string) => ({ input: 'Sepsis, fatal', output: '{"grade": 5}', caseId: caseId(fromCase) });

    const { evalRun, trials } = await prepareEvalRun({
      ...STEP, trialsPerCase: 1, concurrency: 1, budgetUsd: 5,
      challengers: [{ label: 'Few-shot', patch: { examples: [example('Grade 5 sepsis')] } }],
    }, scope);
    expect(evalRun.caseIds).toEqual([caseId('Grade 4 neutropenia')]);
    expect(evalRun.exampleCaseIds).toEqual([caseId('Grade 5 sepsis')]);
    expect(trials.map((trial) => trial.caseId)).toEqual([caseId('Grade 4 neutropenia'), caseId('Grade 4 neutropenia')]);

    const { evalCase: holdout } = await createEvalCase({
      ...STEP, name: 'Grade 3 rash', input: { triggerPayload: {}, previousStepOutputs: {} }, workspaceSeedCommit: null,
      expectation: 'positive', notes: null, split: 'holdout', containsProductionData: false, origin: 'user',
    }, scope);
    await expect(prepareEvalRun({
      ...STEP, trialsPerCase: 1, concurrency: 1, budgetUsd: 5,
      challengers: [{ label: 'Leaky', patch: { examples: [{ input: 'Rash', output: '{"grade": 3}', caseId: holdout.id }] } }],
    }, scope)).rejects.toThrow(/Challenger 'Leaky': .*holdout cases are never offered as examples/);

    // The champion's own examples count too: with both cases used as examples, nothing is left to score.
    const [definition] = await fixture.processRepo.listWorkflowVersions(STEP.namespace, STEP.workflowName);
    await fixture.processRepo.saveWorkflowDefinition({
      ...definition!,
      version: definition!.version + 1,
      steps: definition!.steps.map((step) => step.id === STEP.stepId
        ? { ...step, agent: { ...step.agent, examples: [example('Grade 5 sepsis')] } }
        : step),
    });
    await expect(prepareEvalRun({
      ...STEP, trialsPerCase: 1, concurrency: 1, budgetUsd: 5,
      challengers: [{ label: 'Few-shot', patch: { examples: [example('Grade 4 neutropenia')] } }],
    }, scope)).rejects.toThrow(/no case left to score/);
  });

  it('refuses to start without the person confirming the budget', async () => {
    const { evalRun } = await prepareEvalRun({ ...STEP, challengers: [], trialsPerCase: 1, concurrency: 1, budgetUsd: 5 }, scope);

    await expect(startEvalRun({ evalRunId: evalRun.id }, scope)).rejects.toBeInstanceOf(ValidationError);
    await expect(startEvalRun({ evalRunId: evalRun.id, confirmedBudgetUsd: 4 }, scope)).rejects.toBeInstanceOf(ValidationError);
    expect((await getEvalRun({ evalRunId: evalRun.id }, scope)).evalRun.status).toBe('prepared');
    expect(kicker.kicks).toEqual([]);
  });

  it('runs every trial as a single-step run, scores it, and reports the Scores', async () => {
    const { evalRun } = await prepareEvalRun({ ...STEP, challengers: [], trialsPerCase: 2, concurrency: 2, budgetUsd: 5 }, scope);
    const started = await startEvalRun({ evalRunId: evalRun.id, confirmedBudgetUsd: 5 }, scope);

    expect(started.evalRun.status).toBe('running');
    expect(kicker.kicks).toHaveLength(2);
    const firstTrial = await fixture.instanceRepo.getById(kicker.kicks[0]!.instanceId);
    expect(firstTrial).toMatchObject({
      status: 'running',
      currentStepId: 'grade-aes',
      evalRunId: evalRun.id,
      workspaceStartCommit: 'a1b2c3d4',
      triggerPayload: { studyId: 'CDISCPILOT01' },
    });

    // Three trials produce findings, one does not.
    const results = [{ findings: ['sepsis: 5'] }, { findings: [] }, { summary: 'no findings' }, { findings: ['neutropenia: 4'] }];
    for (let index = 0; index < results.length; index++) {
      await finishTrial(kicker.kicks[index]!.instanceId, results[index]!, 0.25);
    }

    const { evalRun: finished, trials, report } = await getEvalRun({ evalRunId: evalRun.id }, scope);
    expect(finished.status).toBe('completed');
    expect(finished.spentUsd).toBeCloseTo(1, 10);
    expect(trials.every((trial) => trial.status === 'scored')).toBe(true);

    const [champion] = report.variants;
    const findings = champion!.evaluators.find((evaluator) => evaluator.name === 'findings-present')!;
    expect(findings).toMatchObject({ passes: 3, failures: 1, errors: 0, passRate: 0.75, counted: true });
    expect(findings.wilsonLower).toBeCloseTo(0.3006, 3);
    expect(findings.passAtK! + findings.passHatK!).toBeGreaterThan(0);
    expect(report).toMatchObject({ costUsd: 1, inputTokens: 4000, outputTokens: 800 });
    expect(champion).toMatchObject({ meanCostUsd: 0.25, meanDurationMs: 4200 });

    // The code check writes no result.json: every trial is an error for it, never a failure.
    const code = champion!.evaluators.find((evaluator) => evaluator.name === 'fatal-flagged')!;
    expect(code).toMatchObject({ passes: 0, failures: 0, errors: 4, passRate: null, counted: false });

    const scores = await fixture.scoreRepo.list({ name: 'findings-present', limit: 50 });
    expect(scores).toHaveLength(4);
    expect(scores[0]).toMatchObject({ source: 'deterministic', metadata: { evalRunId: evalRun.id, evaluatorVersion: 1, counted: true } });
  });

  it('stops starting trials once spend reaches the budget', async () => {
    const { evalRun } = await prepareEvalRun({ ...STEP, challengers: [], trialsPerCase: 2, concurrency: 1, budgetUsd: 1 }, scope);
    await startEvalRun({ evalRunId: evalRun.id, confirmedBudgetUsd: 1 }, scope);

    await finishTrial(kicker.kicks[0]!.instanceId, { findings: [] }, 0.6);
    await finishTrial(kicker.kicks[1]!.instanceId, { findings: [] }, 0.6);

    const { evalRun: stopped, report } = await getEvalRun({ evalRunId: evalRun.id }, scope);
    expect(kicker.kicks).toHaveLength(2);
    expect(stopped.status).toBe('budget_exceeded');
    expect(report.trials).toMatchObject({ scored: 2, skipped: 2, inProgress: 0 });
  });

  it('cancels: pending trials are skipped and a cancelled run cannot be cancelled again', async () => {
    const { evalRun } = await prepareEvalRun({ ...STEP, challengers: [], trialsPerCase: 1, concurrency: 1, budgetUsd: 5 }, scope);
    const { evalRun: cancelled, report } = await cancelEvalRun({ evalRunId: evalRun.id }, scope);

    expect(cancelled.status).toBe('cancelled');
    expect(report.trials.skipped).toBe(2);
    await expect(cancelEvalRun({ evalRunId: evalRun.id }, scope)).rejects.toBeInstanceOf(ConflictError);
  });

  it('still scores and charges a trial that was running when the run was cancelled', async () => {
    const { evalRun } = await prepareEvalRun({ ...STEP, challengers: [], trialsPerCase: 2, concurrency: 1, budgetUsd: 5 }, scope);
    await startEvalRun({ evalRunId: evalRun.id, confirmedBudgetUsd: 5 }, scope);
    await cancelEvalRun({ evalRunId: evalRun.id }, scope);
    expect(await fixture.evaluationRepo.listEvalRunIdsToDrive()).toEqual([evalRun.id]);

    await finishTrial(kicker.kicks[0]!.instanceId, { findings: [] }, 0.25);

    const { evalRun: cancelled, report } = await getEvalRun({ evalRunId: evalRun.id }, scope);
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.spentUsd).toBeCloseTo(0.25, 10);
    expect(report.trials).toMatchObject({ scored: 1, skipped: 3, inProgress: 0 });
    expect(await fixture.evaluationRepo.listEvalRunIdsToDrive()).toEqual([]);
    expect(kicker.kicks).toHaveLength(1);
  });

  /** Adds an LLM judge Evaluator whose every call spends 4000 tokens in and 500 out, priced as `prices` says. */
  async function withJudge(prices: ReadonlyArray<{ id: string; pricing: { input: number; output: number } }>) {
    await createEvaluator({
      ...STEP, name: 'grades-present', rule: 'Every AE carries a grade.', severity: 'major', origin: 'user',
      check: { kind: 'llm_judge', model: 'anthropic/claude-haiku-4.5', rubric: 'Every AE carries a grade.', choices: [{ label: 'graded', value: 1 }, { label: 'ungraded', value: 0 }] },
    }, scope);
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"reasoning": "Graded.", "choice": "graded"}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 4000, completion_tokens: 500 },
    }))));
    Object.assign(scope, {
      workspaceSecrets: { getSecrets: async () => ({ OPENROUTER_API_KEY: 'sk-test' }) },
      models: { list: async () => prices },
    });
  }

  it('charges each LLM judge call to its trial and to the run\'s spend, and keeps it on the Score', async () => {
    await withJudge([{ id: 'anthropic/claude-haiku-4.5', pricing: { input: 0.000001, output: 0.000005 } }]);
    const { evalRun } = await prepareEvalRun({ ...STEP, challengers: [], trialsPerCase: 1, concurrency: 2, budgetUsd: 5 }, scope);
    await startEvalRun({ evalRunId: evalRun.id, confirmedBudgetUsd: 5 }, scope);

    for (const kick of kicker.kicks) await finishTrial(kick.instanceId, { findings: [] }, 0.25);

    // 4000 × $0.000001 + 500 × $0.000005 = $0.0065 per judge call.
    const { evalRun: finished, trials, report } = await getEvalRun({ evalRunId: evalRun.id }, scope);
    expect(trials).toHaveLength(2);
    for (const trial of trials) expect(trial.costUsd).toBeCloseTo(0.2565, 10);
    expect(finished.spentUsd).toBeCloseTo(0.513, 10);
    expect(report.costUsd).toBeCloseTo(0.513, 10);
    const [judgeScore] = await fixture.scoreRepo.list({ name: 'grades-present', limit: 50 });
    expect(judgeScore?.metadata?.judgeCostUsd).toBeCloseTo(0.0065, 10);
  });

  it('says so on the trial when the judge\'s model has no registry price', async () => {
    await withJudge([]);
    const { evalRun } = await prepareEvalRun({ ...STEP, challengers: [], trialsPerCase: 1, concurrency: 1, budgetUsd: 5 }, scope);
    await startEvalRun({ evalRunId: evalRun.id, confirmedBudgetUsd: 5 }, scope);

    await finishTrial(kicker.kicks[0]!.instanceId, { findings: [] }, 0.25);

    const [trial] = (await getEvalRun({ evalRunId: evalRun.id }, scope)).trials.filter((candidate) => candidate.status === 'scored');
    expect(trial?.costUsd).toBeCloseTo(0.25, 10);
    expect(trial?.error).toContain("grades-present: judge model 'anthropic/claude-haiku-4.5' has no registry price");
  });

  it('keeps trial Agent Runs out of the step\'s production runs', async () => {
    const { evalRun } = await prepareEvalRun({ ...STEP, challengers: [], trialsPerCase: 1, concurrency: 1, budgetUsd: 5 }, scope);
    await startEvalRun({ evalRunId: evalRun.id, confirmedBudgetUsd: 5 }, scope);
    await finishTrial(kicker.kicks[0]!.instanceId, { findings: [] }, 0.1);

    const { runs } = await listStepAgentRuns({ ...STEP, limit: 20 }, scope);
    expect(runs.map((run) => run.id).sort()).toEqual([GRADED_RUN, UNGRADED_RUN].sort());
  });
});
