import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WorkflowEngine } from '@mediforce/workflow-engine';
import { AGENT_EVAL_STEP_ID, type EvaluationSubject } from '@mediforce/platform-core';
import {
  buildAgentOutputEnvelope,
  buildAgentRun,
  buildStepExecution,
  buildWorkflowDefinition,
} from '@mediforce/platform-core/testing';
import { ConflictError } from '../../../errors';
import { noopRunKicker, type NoopRunKicker } from '../../../runtime/run-kicker';
import type { CallerScope } from '../../../repositories/index';
import { userCaller } from '../../../repositories/__tests__/create-test-scope';
import { setAcceptanceCriteria } from '../acceptance-criteria';
import { addEvaluatorVersion, createEvaluator } from '../evaluators';
import { createEvalCase } from '../eval-cases';
import { saveEvalDataset } from '../eval-datasets';
import { advanceEvalRunOfInstance, cancelEvalRun, prepareEvalRun, startEvalRun } from '../eval-runs';
import { getStepQualification, getWorkflowValidation, listAgentValidations, signStepQualification } from '../step-qualification';
import { evaluationFixture, NAMESPACE, seedSchemaEvaluator, STEP, WORKFLOW, type EvaluationFixture } from './fixture';

describe('Step Qualification (ADR-0023 D5, D10, D11)', () => {
  let fixture: EvaluationFixture;
  let kicker: NoopRunKicker;
  let scope: CallerScope;
  let previousAllowLocal: string | undefined;
  // grades-present fails every trial: the strict floor misses on it, the lenient one is met.
  const strict = { minPassRate: 0.9 };
  const lenient = { minPassRate: 0 };

  afterEach(() => {
    if (previousAllowLocal === undefined) delete process.env.ALLOW_LOCAL_AGENTS;
    else process.env.ALLOW_LOCAL_AGENTS = previousAllowLocal;
  });

  beforeEach(async () => {
    previousAllowLocal = process.env.ALLOW_LOCAL_AGENTS;
    process.env.ALLOW_LOCAL_AGENTS = 'true';
    fixture = await evaluationFixture();
    kicker = noopRunKicker();
    scope = withEngine(fixture.scope());

    await setAcceptanceCriteria({ ...STEP, criteria: strict, origin: 'user' }, scope);
    await createEvaluator({ ...STEP, name: 'findings-present', rule: 'The result lists findings.', check: { kind: 'schema', schema: { required: ['findings'] } }, origin: 'user' }, scope);
    await seedSchemaEvaluator(scope, { name: 'grades-present', rule: 'The result lists grades.', required: ['grades'] });
    for (const name of ['Grade 5 sepsis', 'Grade 4 neutropenia']) {
      await createEvalCase({
        ...STEP,
        name,
        input: { triggerPayload: { studyId: 'CDISCPILOT01' }, previousStepOutputs: { 'extract-aes': { events: [{ term: name }] } } },
        workspaceSeedCommit: null,
        expectation: 'positive',
        expectedOutput: null, comparison: 'exact', agreementInstructions: null, evaluatorIds: null,
        split: 'dev',
        containsProductionData: false,
        origin: 'user',
      }, scope);
    }
    await saveEvalDataset(STEP, scope);
  });

  function withEngine(built: CallerScope): CallerScope {
    Object.assign(built.system, {
      engine: new WorkflowEngine(fixture.processRepo, fixture.instanceRepo, fixture.auditRepo),
      runKicker: kicker,
    });
    return built;
  }

  /** Runs every trial of a fresh Eval Run to a scored result with findings — but the first `failing`, which end without an Agent Run. */
  async function finishedRun(failing = 0, definitionVersion?: number, subject: EvaluationSubject = STEP): Promise<string> {
    // Each run is created a millisecond after the last, so "newest" is never a tie.
    await new Promise((resolve) => setTimeout(resolve, 2));
    const kicksBefore = kicker.kicks.length;
    const stepId = subject.kind === 'agent' ? AGENT_EVAL_STEP_ID : STEP.stepId;
    const { evalRun } = await prepareEvalRun({
      ...subject, definitionVersion, trialsPerCase: 1, concurrency: 4, budgetUsd: 5,
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
      await fixture.instanceRepo.addStepExecution(instanceId, buildStepExecution({ instanceId, stepId, startedAt }));
      await fixture.agentRunRepo.create(buildAgentRun({
        processInstanceId: instanceId, stepId, startedAt, envelope: buildAgentOutputEnvelope({ result: { findings: ['sepsis: 5'] } }),
      }));
      await fixture.instanceRepo.update(instanceId, { status: 'completed', currentStepId: null });
      await advanceEvalRunOfInstance(scope, instanceId);
    }
    return evalRun.id;
  }

  const justification = 'grades-present is new; a reviewer reads every grade until it passes.';

  it('is not qualified until a verdict is overwritten to passed, then qualified for the Fingerprint it signed — with no Evaluation Brief', async () => {
    const before = await getStepQualification(STEP, scope);
    expect(before).toMatchObject({ status: 'not_qualified', qualification: null, definitionVersion: 1, changed: [] });

    const evalRunId = await finishedRun();
    const { qualification } = await signStepQualification({ evalRunId, decision: 'overwritten', justification }, scope);

    expect(qualification).toMatchObject({
      evalRunId,
      definitionVersion: 1,
      acceptanceCriteria: strict,
      decision: 'overwritten',
      deviations: [{ justification }],
      signature: {
        signerId: 'author-1',
        signerName: 'author-1',
        reauthentication: 'session',
        meaning: 'Overwritten: I reviewed this Eval Run and overwrite its verdict: the Step configuration as it ran in it passed validation.',
      },
    });
    expect(qualification.verdicts.map((verdict) => [verdict.status, verdict.reason])).toEqual([['missed', 'grades-present passed 0 of 2 trials (0%, needs 90%)']]);
    expect(qualification.fingerprint.hash).toBe(before.fingerprint.hash);

    const after = await getStepQualification(STEP, scope);
    expect(after).toMatchObject({ status: 'qualified', changed: [], evaluatorsChanged: [] });
    expect(after.history).toHaveLength(1);

    const [event] = await fixture.auditRepo.getByEntity('step_qualification', qualification.id);
    expect(event).toMatchObject({ action: 'step_qualification.signed' });
  });

  it('goes stale when the step changes, naming what changed, and flags Evaluators changed since', async () => {
    const evalRunId = await finishedRun();
    await signStepQualification({ evalRunId, decision: 'overwritten', justification }, scope);

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
          agent: { prompt: 'Grade each AE.', model: 'openai/gpt-5' },
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

  it('refuses a workflow version for an agent, which is read as it is now', async () => {
    await expect(getStepQualification({ namespace: NAMESPACE, agentId: 'ae-grader', definitionVersion: 1 }, fixture.scope()))
      .rejects.toThrow('has no workflow version to pick');
  });

  it('takes a justification only to overwrite the verdict; confirming a missed verdict qualifies nothing', async () => {
    const missedRunId = await finishedRun();
    await expect(signStepQualification({ evalRunId: missedRunId, decision: 'overwritten' }, scope))
      .rejects.toThrow(/give a written justification/);
    await expect(signStepQualification({ evalRunId: missedRunId, decision: 'confirmed', justification: 'Just in case.' }, scope))
      .rejects.toThrow(/Confirming the verdict records no deviation/);

    const { qualification } = await signStepQualification({ evalRunId: missedRunId, decision: 'confirmed' }, scope);
    expect(qualification).toMatchObject({ decision: 'confirmed', deviations: [] });
    expect(qualification.signature.meaning).toContain('failed validation');
    expect(await getStepQualification(STEP, scope)).toMatchObject({ status: 'not_qualified', qualification: { id: qualification.id } });
    expect((await getStepQualification(STEP, scope)).validation).toMatchObject({ status: 'failed', evalRunId: missedRunId });
    await expect(signStepQualification({ evalRunId: missedRunId, decision: 'confirmed' }, scope))
      .rejects.toThrow(/already signed/);
  });

  it('qualifies a run that met its criteria when the verdict is confirmed, and fails it when overwritten', async () => {
    await setAcceptanceCriteria({ ...STEP, criteria: lenient, origin: 'user' }, scope);
    const metRunId = await finishedRun();
    const confirmed = await signStepQualification({ evalRunId: metRunId, decision: 'confirmed' }, scope);
    expect(confirmed.qualification.signature.meaning).toContain('agree with its verdict');
    expect((await getStepQualification(STEP, scope)).status).toBe('qualified');

    const overwrittenRunId = await finishedRun();
    await signStepQualification({ evalRunId: overwrittenRunId, decision: 'overwritten', justification: 'A reviewer found a Grade 5 miscoded.' }, scope);
    const { validation } = await getStepQualification(STEP, scope);
    expect(validation).toMatchObject({ status: 'failed', evalRunId: overwrittenRunId });
    expect(validation.reason).toContain('A reviewer found a Grade 5 miscoded.');
  });

  it('records a run whose criteria could not be judged as failed when confirmed', async () => {
    await setAcceptanceCriteria({ ...STEP, criteria: lenient, origin: 'user' }, scope);
    const evalRunId = await finishedRun(1);

    const { qualification } = await signStepQualification({ evalRunId, decision: 'confirmed' }, scope);
    expect(qualification.verdicts.map((verdict) => verdict.status)).toEqual(['not_evaluable']);
    expect((await getStepQualification(STEP, scope)).validation.status).toBe('failed');
  });

  it('signs from the session, asks for no password, and refuses an API key', async () => {
    const evalRunId = await finishedRun();
    const signing = { evalRunId, decision: 'overwritten' as const, justification };

    await expect(signStepQualification(signing, withEngine(fixture.scope({ kind: 'apiKey', isSystemActor: true }))))
      .rejects.toThrow(/signed by a person/);
    const { qualification } = await signStepQualification(signing, scope);
    expect(qualification.signature.reauthentication).toBe('session');
  });

  it('signs only a finished run', async () => {
    const { evalRun } = await prepareEvalRun({ ...STEP, trialsPerCase: 1, concurrency: 1, budgetUsd: 5 }, scope);
    await expect(signStepQualification({ evalRunId: evalRun.id, decision: 'confirmed' }, scope))
      .rejects.toBeInstanceOf(ConflictError);
  });

  it('does not sign a cancelled run', async () => {
    const { evalRun } = await prepareEvalRun({ ...STEP, trialsPerCase: 1, concurrency: 1, budgetUsd: 5 }, scope);
    await cancelEvalRun({ evalRunId: evalRun.id }, scope);
    await expect(signStepQualification({ evalRunId: evalRun.id, decision: 'confirmed' }, scope))
      .rejects.toThrow(/cancelled/);
  });
  describe('batch agent validation statuses (#1553)', () => {
    it('reads every evaluable agent\'s status in one call, leaving out agents that cannot be evaluated', async () => {
      const agent = await fixture.agentDefinitionRepo.getById('ae-grader');
      await fixture.agentDefinitionRepo.upsert('ae-grader', { ...agent!, runtimeId: 'claude-code-agent' });
      await fixture.agentDefinitionRepo.upsert('not-evaluable', { ...agent!, name: 'Not evaluable' });

      const { statuses } = await listAgentValidations({ namespace: NAMESPACE }, scope);
      expect(statuses).toEqual({ 'ae-grader': 'not_verified' });

      const direct = await getStepQualification({ namespace: NAMESPACE, agentId: 'ae-grader' }, scope);
      expect(statuses['ae-grader']).toBe(direct.validation.status);
    });

    it('leaves out an evaluable agent from another namespace the caller cannot see', async () => {
      const agent = await fixture.agentDefinitionRepo.getById('ae-grader');
      await fixture.agentDefinitionRepo.upsert('ae-grader', { ...agent!, runtimeId: 'claude-code-agent' });
      await fixture.agentDefinitionRepo.upsert('other-workspace-agent', { ...agent!, namespace: 'pharma-b' });

      const { statuses } = await listAgentValidations({ namespace: 'pharma-b' }, scope);
      expect(statuses).toEqual({});
    });
  });

  describe('validation status — the newest finished Eval Run of the version, judged on its criteria', () => {
    const aCase = {
      ...STEP,
      name: 'Grade 3 anaemia',
      input: { triggerPayload: { studyId: 'CDISCPILOT01' }, previousStepOutputs: { 'extract-aes': { events: [{ term: 'Anaemia' }] } } },
      workspaceSeedCommit: null,
      expectedOutput: null, comparison: 'exact' as const, agreementInstructions: null, evaluatorIds: null,
      split: 'dev' as const,
      containsProductionData: false,
      origin: 'user' as const,
    };

    async function passedRun(): Promise<string> {
      await setAcceptanceCriteria({ ...STEP, criteria: lenient, origin: 'user' }, scope);
      const evalRunId = await finishedRun();
      expect((await getStepQualification(STEP, scope)).validation).toMatchObject({ status: 'awaiting_approval', evalRunId, runVerdict: 'passed', runInProgress: false });
      await signStepQualification({ evalRunId, decision: 'confirmed' }, scope);
      expect((await getStepQualification(STEP, scope)).validation).toMatchObject({ status: 'passed', evalRunId, runInProgress: false });
      return evalRunId;
    }

    it('is not verified until an Eval Run of the version finishes', async () => {
      expect((await getStepQualification(STEP, scope)).validation).toMatchObject({ status: 'not_verified', evalRunId: null, runInProgress: false });
    });

    it('waits for a person after a finished run, then passes or fails as they confirm or overwrite its verdict', async () => {
      await passedRun();
      await setAcceptanceCriteria({ ...STEP, criteria: strict, origin: 'user' }, scope);
      const evalRunId = await finishedRun();
      const waiting = (await getStepQualification(STEP, scope)).validation;
      expect(waiting).toMatchObject({ status: 'awaiting_approval', evalRunId, runVerdict: 'missed' });
      expect(waiting.reason).toMatch(/^Eval Run [0-9a-f]{8} missed: grades-present/);

      await signStepQualification({ evalRunId, decision: 'confirmed' }, scope);
      const { validation } = await getStepQualification(STEP, scope);
      expect(validation).toMatchObject({ status: 'failed', evalRunId });
      expect(validation.reason).toContain('grades-present');
    });

    it('resets to not verified when an Evaluator changes', async () => {
      await passedRun();
      const [findings] = await fixture.evaluationRepo.listEvaluators(STEP);
      await addEvaluatorVersion({ evaluatorId: findings!.id, rule: 'The result lists every finding.', origin: 'user' }, scope);
      const { validation } = await getStepQualification(STEP, scope);
      expect(validation.status).toBe('not_verified');
      expect(validation.reason).toContain("'findings-present' now v2");
    });

    it('resets to not verified when an Eval Case is added or archived', async () => {
      await passedRun();
      const added = await createEvalCase({ ...aCase, expectation: 'positive' }, scope);
      expect((await getStepQualification(STEP, scope)).validation).toMatchObject({ status: 'not_verified', reason: expect.stringContaining('Eval Cases') });
      await fixture.evaluationRepo.setCaseArchived(added.evalCase.id, true);
      expect((await getStepQualification(STEP, scope)).validation.status).toBe('passed');
      const [kept] = (await fixture.evaluationRepo.listCases(STEP)).filter((evalCase) => evalCase.archived === false);
      await fixture.evaluationRepo.setCaseArchived(kept!.id, true);
      expect((await getStepQualification(STEP, scope)).validation.status).toBe('not_verified');
    });

    it('resets to not verified when the Acceptance Criteria change', async () => {
      await passedRun();
      await setAcceptanceCriteria({ ...STEP, criteria: { minPassRate: 0.5 }, origin: 'user' }, scope);
      expect((await getStepQualification(STEP, scope)).validation).toMatchObject({ status: 'not_verified', reason: expect.stringContaining('Acceptance Criteria') });
    });

    it('is tied to the workflow version: a new version is not verified until it is run', async () => {
      await passedRun();
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
      expect((await getStepQualification(STEP, scope)).validation).toMatchObject({ status: 'not_verified', evalRunId: null });
      expect((await getStepQualification({ ...STEP, definitionVersion: 1 }, scope)).validation.status).toBe('passed');
    });

    it('rolls each live workflow version up across its agent steps; a run prepared for an older version verifies that version', async () => {
      await setAcceptanceCriteria({ ...STEP, criteria: lenient, origin: 'user' }, scope);
      await fixture.processRepo.saveWorkflowDefinition(buildWorkflowDefinition({
        name: WORKFLOW,
        namespace: NAMESPACE,
        version: 2,
        steps: [
          { id: 'extract-aes', name: 'Extract AEs', type: 'creation', executor: 'script', script: { runtime: 'python', inlineScript: 'print(1)' } },
          { id: 'grade-aes', name: 'Grade AEs', type: 'creation', executor: 'agent', agentId: 'ae-grader', agent: { prompt: 'Grade each AE by its CTCAE grade.' } },
          { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
        ],
        transitions: [{ from: 'extract-aes', to: 'grade-aes' }, { from: 'grade-aes', to: 'done' }],
      }));
      const workflow = { namespace: NAMESPACE, workflowName: WORKFLOW };
      expect(await getWorkflowValidation(workflow, scope)).toMatchObject({
        versions: [
          { definitionVersion: 2, status: 'not_verified', steps: [{ stepId: 'grade-aes', stepName: 'Grade AEs', validation: { status: 'not_verified', evalRunId: null } }] },
          { definitionVersion: 1, status: 'not_verified' },
        ],
      });

      const evalRunId = await finishedRun(0, 1);
      expect((await getWorkflowValidation(workflow, scope)).versions[1]).toMatchObject({ definitionVersion: 1, status: 'awaiting_approval' });
      await signStepQualification({ evalRunId, decision: 'confirmed' }, scope);
      expect(await getWorkflowValidation(workflow, scope)).toMatchObject({
        versions: [
          { definitionVersion: 2, status: 'not_verified' },
          { definitionVersion: 1, status: 'passed', steps: [{ stepId: 'grade-aes', validation: { status: 'passed', evalRunId } }] },
        ],
      });

      await setAcceptanceCriteria({ ...STEP, criteria: strict, origin: 'user' }, scope);
      const newestRunId = await finishedRun(0, 2);
      await signStepQualification({ evalRunId: newestRunId, decision: 'confirmed' }, scope);
      const [newest] = (await getWorkflowValidation(workflow, scope)).versions;
      expect(newest).toMatchObject({ definitionVersion: 2, status: 'failed' });

      await fixture.processRepo.setVersionArchived(NAMESPACE, WORKFLOW, 1, true);
      expect((await getWorkflowValidation(workflow, scope)).versions.map((version) => version.definitionVersion)).toEqual([2]);
    });

    it('leaves a version not verified while its agent step declares MCP servers inline', async () => {
      await fixture.processRepo.saveWorkflowDefinition(buildWorkflowDefinition({
        name: WORKFLOW,
        namespace: NAMESPACE,
        version: 2,
        steps: [
          { id: 'grade-aes', name: 'Grade AEs', type: 'creation', executor: 'agent', agent: { prompt: 'Grade.', mcpServers: [{ name: 'edc', command: 'edc-mcp', args: [] }] } },
          { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
        ],
        transitions: [{ from: 'grade-aes', to: 'done' }],
      }));
      const [inline] = (await getWorkflowValidation({ namespace: NAMESPACE, workflowName: WORKFLOW }, scope)).versions;
      expect(inline).toMatchObject({
        definitionVersion: 2,
        status: 'not_verified',
        steps: [{ stepId: 'grade-aes', validation: { status: 'not_verified', evalRunId: null, reason: expect.stringContaining('declares MCP servers inline (edc)') } }],
      });
    });

    it('says when a run is under way', async () => {
      const { evalRun } = await prepareEvalRun({ ...STEP, trialsPerCase: 1, concurrency: 1, budgetUsd: 5 }, scope);
      await startEvalRun({ evalRunId: evalRun.id, confirmedBudgetUsd: 5 }, scope);
      expect((await getStepQualification(STEP, scope)).validation).toMatchObject({ status: 'not_verified', runInProgress: true });
    });

    describe('a step that runs a validated Agent as it is', () => {
      const AGENT = { kind: 'agent', namespace: NAMESPACE, workflowName: null, stepId: null, agentId: 'ae-grader' } as const;
      const workflow = { namespace: NAMESPACE, workflowName: WORKFLOW };

      beforeEach(async () => {
        const agent = await fixture.agentDefinitionRepo.getById('ae-grader');
        await fixture.agentDefinitionRepo.upsert('ae-grader', { ...agent!, runtimeId: 'claude-code-agent' });
        await setAcceptanceCriteria({ ...AGENT, criteria: lenient, origin: 'user' }, scope);
        await createEvaluator({ ...AGENT, name: 'findings-present', rule: 'The result lists findings.', check: { kind: 'schema', schema: { required: ['findings'] } }, origin: 'user' }, scope);
        await createEvalCase({
          ...AGENT,
          name: 'Grade 5 sepsis',
          input: { triggerPayload: { events: [{ term: 'Sepsis' }] }, previousStepOutputs: {} },
          workspaceSeedCommit: null,
          expectation: 'positive',
          expectedOutput: null, comparison: 'exact', agreementInstructions: null, evaluatorIds: null,
          split: 'dev',
          containsProductionData: false,
          origin: 'user',
        }, scope);
        await saveEvalDataset(AGENT, scope);
        await signStepQualification({ evalRunId: await finishedRun(0, undefined, AGENT), decision: 'confirmed' }, scope);
        await fixture.processRepo.saveWorkflowDefinition(buildWorkflowDefinition({
          name: WORKFLOW,
          namespace: NAMESPACE,
          version: 2,
          steps: [
            { id: 'extract-aes', name: 'Extract AEs', type: 'creation', executor: 'script', script: { runtime: 'python', inlineScript: 'print(1)' } },
            { id: 'grade-aes', name: 'Grade AEs', type: 'creation', executor: 'agent', agentId: 'ae-grader', plugin: 'claude-code-agent', autonomyLevel: 'L4', agent: { timeoutMinutes: 30 } },
            { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
          ],
          transitions: [{ from: 'extract-aes', to: 'grade-aes' }, { from: 'grade-aes', to: 'done' }],
        }));
      });

      it('passes on the Agent\'s validation, so a workflow of such steps is verified; a step that adds a prompt is not', async () => {
        expect((await getStepQualification(STEP, scope)).validation).toMatchObject({
          status: 'passed',
          reason: expect.stringContaining('Runs agent \'AE grader\' v1 as it was validated'),
          inheritedFromAgent: { agentId: 'ae-grader', name: 'AE grader', version: 1 },
        });
        expect(await getWorkflowValidation(workflow, scope)).toMatchObject({
          versions: [
            { definitionVersion: 2, status: 'passed', steps: [{ stepId: 'grade-aes', validation: { status: 'passed' } }] },
            { definitionVersion: 1, status: 'not_verified', steps: [{ stepId: 'grade-aes', validation: { status: 'not_verified' } }] },
          ],
        });
        expect((await getWorkflowValidation(workflow, scope)).versions[1]!.steps[0]!.validation).not.toHaveProperty('inheritedFromAgent');
      });

      it('stops passing once the Agent changes after its validation', async () => {
        const agent = await fixture.agentDefinitionRepo.getById('ae-grader');
        await fixture.agentDefinitionRepo.upsert('ae-grader', { ...agent!, systemPrompt: 'You grade adverse events by CTCAE v6.' });
        expect((await getWorkflowValidation(workflow, scope)).versions[0]).toMatchObject({ definitionVersion: 2, status: 'not_verified' });
      });

      it('passes only in the Agent\'s own workspace, where its MCP servers resolve as its trials did', async () => {
        const agent = await fixture.agentDefinitionRepo.getById('ae-grader');
        await fixture.agentDefinitionRepo.upsert('ae-grader', { ...agent!, visibility: 'public' });
        const definition = await fixture.processRepo.getWorkflowDefinition(NAMESPACE, WORKFLOW, 2);
        await fixture.processRepo.saveWorkflowDefinition({ ...definition!, namespace: 'pharma-b', version: 1 });
        const bothWorkspaces = withEngine(fixture.scope(userCaller('author-1', [NAMESPACE, 'pharma-b'])));

        expect((await getWorkflowValidation({ namespace: 'pharma-b', workflowName: WORKFLOW }, bothWorkspaces)).versions[0]).toMatchObject({ status: 'not_verified' });
        expect((await getWorkflowValidation(workflow, bothWorkspaces)).versions[0]).toMatchObject({ definitionVersion: 2, status: 'passed' });
      });

      it('keeps the step\'s own verdict when one was read', async () => {
        await setAcceptanceCriteria({ ...STEP, criteria: strict, origin: 'user' }, scope);
        await signStepQualification({ evalRunId: await finishedRun(), decision: 'confirmed' }, scope);
        expect((await getStepQualification(STEP, scope)).validation.status).toBe('failed');
      });
    });
  });
});
