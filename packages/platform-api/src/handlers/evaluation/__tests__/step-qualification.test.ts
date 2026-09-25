import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { hash } from 'bcryptjs';
import { WorkflowEngine } from '@mediforce/workflow-engine';
import {
  InMemoryCredentialsRepository,
  buildAgentOutputEnvelope,
  buildAgentRun,
  buildStepExecution,
  buildWorkflowDefinition,
} from '@mediforce/platform-core/testing';
import { ConflictError, ForbiddenError, PreconditionFailedError, ValidationError } from '../../../errors';
import { noopRunKicker, type NoopRunKicker } from '../../../runtime/run-kicker';
import type { CallerScope } from '../../../repositories/index';
import { setEvaluationBrief } from '../briefs';
import { setAcceptanceCriteria } from '../acceptance-criteria';
import { addEvaluatorVersion, createEvaluator } from '../evaluators';
import { createEvalCase } from '../eval-cases';
import { freezeEvalDataset } from '../eval-datasets';
import { advanceEvalRunOfInstance, cancelEvalRun, prepareEvalRun, startEvalRun } from '../eval-runs';
import { getStepQualification, signStepQualification } from '../step-qualification';
import { evaluationFixture, NAMESPACE, STEP, WORKFLOW, type EvaluationFixture } from './fixture';

const PASSWORD = 'correct horse battery';

describe('Step Qualification (ADR-0023 D5, D10, D11)', () => {
  let fixture: EvaluationFixture;
  let kicker: NoopRunKicker;
  let credentials: InMemoryCredentialsRepository;
  let scope: CallerScope;
  let previousAllowLocal: string | undefined;

  afterEach(() => {
    if (previousAllowLocal === undefined) delete process.env.ALLOW_LOCAL_AGENTS;
    else process.env.ALLOW_LOCAL_AGENTS = previousAllowLocal;
  });

  beforeEach(async () => {
    previousAllowLocal = process.env.ALLOW_LOCAL_AGENTS;
    process.env.ALLOW_LOCAL_AGENTS = 'true';
    fixture = await evaluationFixture();
    kicker = noopRunKicker();
    credentials = new InMemoryCredentialsRepository();
    await credentials.setPasswordHash('author-1', await hash(PASSWORD, 4));
    scope = withEngine(fixture.scope(undefined, { credentialsRepo: credentials }));

    await setEvaluationBrief({ ...STEP, text: 'Grades AEs for the DSMB; a missed grade 5 is critical.', origin: 'user' }, scope);
    await setAcceptanceCriteria({ ...STEP, criteria: { critical: { minPassRate: 0.1 }, major: { minPassRate: 0.9 } }, origin: 'user' }, scope);
    await createEvaluator({ ...STEP, name: 'findings-present', rule: 'The result lists findings.', severity: 'critical', check: { kind: 'schema', schema: { required: ['findings'] } }, origin: 'user' }, scope);
    for (const name of ['Grade 5 sepsis', 'Grade 4 neutropenia']) {
      await createEvalCase({
        ...STEP,
        name,
        input: { triggerPayload: { studyId: 'CDISCPILOT01' }, previousStepOutputs: { 'extract-aes': { events: [{ term: name }] } } },
        workspaceSeedCommit: null,
        expectation: 'positive',
        notes: null,
        split: 'dev',
        containsProductionData: false,
        origin: 'user',
      }, scope);
    }
    await freezeEvalDataset(STEP, scope);
  });

  function withEngine(built: CallerScope): CallerScope {
    Object.assign(built.system, {
      engine: new WorkflowEngine(fixture.processRepo, fixture.instanceRepo, fixture.auditRepo),
      runKicker: kicker,
    });
    return built;
  }

  /** Runs every trial of a fresh Eval Run to a scored result with findings — but the first `failing`, which end without an Agent Run. */
  async function finishedRun(failing = 0): Promise<string> {
    const kicksBefore = kicker.kicks.length;
    const { evalRun } = await prepareEvalRun({
      ...STEP, trialsPerCase: 1, concurrency: 4, budgetUsd: 5,
      challengers: [{ label: 'GPT-5', patch: { model: 'openai/gpt-5' } }],
    }, scope);
    await startEvalRun({ evalRunId: evalRun.id, confirmedBudgetUsd: 5 }, scope);
    const kicked = kicker.kicks.slice(kicksBefore);
    for (const [index, { instanceId }] of kicked.entries()) {
      if (index < failing) {
        await fixture.instanceRepo.update(instanceId, { status: 'failed', currentStepId: null, error: 'Container exited 137' });
        await advanceEvalRunOfInstance(scope, instanceId);
        continue;
      }
      const startedAt = new Date().toISOString();
      await fixture.instanceRepo.addStepExecution(instanceId, buildStepExecution({ instanceId, stepId: 'grade-aes', startedAt }));
      await fixture.agentRunRepo.create(buildAgentRun({
        processInstanceId: instanceId, stepId: 'grade-aes', startedAt, envelope: buildAgentOutputEnvelope({ result: { findings: ['sepsis: 5'] } }),
      }));
      await fixture.instanceRepo.update(instanceId, { status: 'completed', currentStepId: null });
      await advanceEvalRunOfInstance(scope, instanceId);
    }
    return evalRun.id;
  }

  const majorDeviation = { severity: 'major' as const, justification: 'No major check counts yet; a reviewer reads every grade until one does.' };

  it('is not qualified until signed, then qualified for the Fingerprint it signed', async () => {
    const before = await getStepQualification(STEP, scope);
    expect(before).toMatchObject({ status: 'not_qualified', qualification: null, definitionVersion: 1, changed: [] });

    const evalRunId = await finishedRun();
    const { qualification } = await signStepQualification({ evalRunId, variantId: 'champion', deviations: [majorDeviation], password: PASSWORD }, scope);

    expect(qualification).toMatchObject({
      evalRunId,
      variantId: 'champion',
      definitionVersion: 1,
      briefVersion: 1,
      acceptanceCriteria: { critical: { minPassRate: 0.1 }, major: { minPassRate: 0.9 } },
      deviations: [majorDeviation],
      signature: {
        signerId: 'author-1',
        signerName: 'author-1',
        reauthentication: 'password',
        meaning: 'Approved: I reviewed this Eval Run and qualify this Step configuration for its context of use as stated in Evaluation Brief v1.',
      },
    });
    expect(qualification.verdicts.map((verdict) => [verdict.severity, verdict.status])).toEqual([['critical', 'met'], ['major', 'not_evaluable']]);
    expect(qualification.fingerprint.hash).toBe(before.fingerprint.hash);

    const after = await getStepQualification(STEP, scope);
    expect(after).toMatchObject({ status: 'qualified', changed: [], evaluatorsChanged: [] });
    expect(after.history).toHaveLength(1);

    const [event] = await fixture.auditRepo.getByEntity('step_qualification', qualification.id);
    expect(event).toMatchObject({ action: 'step_qualification.signed' });
    expect(JSON.stringify(event)).not.toContain(PASSWORD);
  });

  it('goes stale when the step changes, naming what changed, and flags Evaluators changed since', async () => {
    const evalRunId = await finishedRun();
    await signStepQualification({ evalRunId, variantId: 'champion', deviations: [majorDeviation], password: PASSWORD }, scope);

    const [findings] = await fixture.evaluationRepo.listEvaluators(STEP);
    await addEvaluatorVersion({ evaluatorId: findings!.id, rule: 'The result lists every finding.', origin: 'user' }, scope);
    await fixture.processRepo.saveWorkflowDefinition(buildWorkflowDefinition({
      name: WORKFLOW,
      namespace: NAMESPACE,
      version: 2,
      steps: [
        { id: 'extract-aes', name: 'Extract AEs', type: 'creation', executor: 'script', script: { runtime: 'python', inlineScript: 'print(1)' } },
        {
          id: 'grade-aes', name: 'Grade AEs (renamed)', type: 'creation', executor: 'agent', agentId: 'ae-grader', autonomyLevel: 'L4',
          agent: { prompt: 'Grade each AE.', model: 'openai/gpt-5', confidenceThreshold: 0.8 },
        },
        { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
      ],
      transitions: [{ from: 'extract-aes', to: 'grade-aes' }, { from: 'grade-aes', to: 'done' }],
    }));

    const stale = await getStepQualification(STEP, scope);
    expect(stale).toMatchObject({ status: 'stale', definitionVersion: 2, changed: ['model'] });
    expect(stale.evaluatorsChanged).toEqual(["'findings-present' now v2, qualified with v1"]);
    // A run of the version it was signed for still ran a qualified step.
    expect(await getStepQualification({ ...STEP, definitionVersion: 1 }, scope)).toMatchObject({ status: 'qualified' });
  });

  it('qualifies a challenger for the step it patched: once the step matches it, it is qualified', async () => {
    const evalRunId = await finishedRun();
    await signStepQualification({ evalRunId, variantId: 'challenger-1', deviations: [majorDeviation], password: PASSWORD }, scope);
    expect((await getStepQualification(STEP, scope)).status).toBe('stale');

    await fixture.processRepo.saveWorkflowDefinition(buildWorkflowDefinition({
      name: WORKFLOW,
      namespace: NAMESPACE,
      version: 2,
      steps: [
        { id: 'extract-aes', name: 'Extract AEs', type: 'creation', executor: 'script', script: { runtime: 'python', inlineScript: 'print(1)' } },
        { id: 'grade-aes', name: 'Grade AEs', type: 'creation', executor: 'agent', agentId: 'ae-grader', agent: { prompt: 'Grade each AE.', model: 'openai/gpt-5' } },
        { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
      ],
      transitions: [{ from: 'extract-aes', to: 'grade-aes' }, { from: 'grade-aes', to: 'done' }],
    }));
    expect(await getStepQualification(STEP, scope)).toMatchObject({ status: 'qualified', qualification: { variantId: 'challenger-1' } });
  });

  it('needs a justification for each criterion missed or not judged, and none for one that was met', async () => {
    const evalRunId = await finishedRun();
    await expect(signStepQualification({ evalRunId, variantId: 'champion', deviations: [], password: PASSWORD }, scope))
      .rejects.toThrow(/major criterion was not judged/);
    await expect(signStepQualification({
      evalRunId, variantId: 'champion', password: PASSWORD,
      deviations: [majorDeviation, { severity: 'critical', justification: 'Just in case.' }],
    }, scope)).rejects.toThrow(/critical criterion was met/);
    expect((await getStepQualification(STEP, scope)).status).toBe('not_qualified');
  });

  it('needs a justification for a criterion the scored trials met while some trial failed', async () => {
    const evalRunId = await finishedRun(1);
    const [failed] = (await scope.evaluation.listTrials(evalRunId)).filter((trial) => trial.status === 'failed');
    const signing = { evalRunId, variantId: failed!.variantId, password: PASSWORD };

    await expect(signStepQualification({ ...signing, deviations: [majorDeviation] }, scope))
      .rejects.toThrow(/critical criterion was not judged \(1 of 2 trials failed or were skipped/);
    const criticalDeviation = { severity: 'critical' as const, justification: 'The one trial lost to an OOM kill is re-run in the next Eval Run.' };
    const { qualification } = await signStepQualification({ ...signing, deviations: [majorDeviation, criticalDeviation] }, scope);
    expect(qualification.verdicts.map((verdict) => verdict.status)).toEqual(['not_evaluable', 'not_evaluable']);
  });

  it('asks the signer for their password again, and refuses an API key', async () => {
    const evalRunId = await finishedRun();
    const signing = { evalRunId, variantId: 'champion', deviations: [majorDeviation] };

    await expect(signStepQualification(signing, scope)).rejects.toBeInstanceOf(ValidationError);
    await expect(signStepQualification({ ...signing, password: 'wrong' }, scope)).rejects.toBeInstanceOf(ForbiddenError);
    const refusals = (await fixture.auditRepo.getByEntity('eval_run', evalRunId))
      .filter((event) => event.action === 'step_qualification.signature_refused');
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatchObject({ actorId: 'author-1' });
    expect(JSON.stringify(refusals[0])).not.toContain('wrong');
    await expect(signStepQualification({ ...signing, password: PASSWORD }, withEngine(fixture.scope({ kind: 'apiKey', isSystemActor: true }))))
      .rejects.toThrow(/signed by a person/);

    const withoutPassword = withEngine(fixture.scope(undefined, { credentialsRepo: new InMemoryCredentialsRepository() }));
    await expect(signStepQualification(signing, withoutPassword)).rejects.toBeInstanceOf(PreconditionFailedError);

    const sessionOnly = withEngine(fixture.scope(undefined, { passwordAuthEnabled: false }));
    const { qualification } = await signStepQualification(signing, sessionOnly);
    expect(qualification.signature.reauthentication).toBe('session');
  });

  it('signs only a finished run with criteria and a Brief frozen into it', async () => {
    const { evalRun } = await prepareEvalRun({ ...STEP, challengers: [], trialsPerCase: 1, concurrency: 1, budgetUsd: 5 }, scope);
    await expect(signStepQualification({ evalRunId: evalRun.id, variantId: 'champion', deviations: [], password: PASSWORD }, scope))
      .rejects.toBeInstanceOf(ConflictError);
  });

  it('does not sign a cancelled run', async () => {
    const { evalRun } = await prepareEvalRun({ ...STEP, challengers: [], trialsPerCase: 1, concurrency: 1, budgetUsd: 5 }, scope);
    await cancelEvalRun({ evalRunId: evalRun.id }, scope);
    await expect(signStepQualification({ evalRunId: evalRun.id, variantId: 'champion', deviations: [majorDeviation], password: PASSWORD }, scope))
      .rejects.toThrow(/cancelled/);
  });
});
