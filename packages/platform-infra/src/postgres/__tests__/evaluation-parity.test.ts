import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { InMemoryEvaluationRepository, STEP_FINGERPRINT_COMPONENTS, evaluationSubjectOf, type StepFingerprint } from '@mediforce/platform-core';
import type {
  EvalCase,
  EvalRun,
  EvaluationOwner,
  EvaluationSubject,
  EvaluationRepository,
  Evaluator,
  EvaluatorVersion,
  StepQualification,
} from '@mediforce/platform-core';
import { PostgresEvaluationRepository } from '../repositories/evaluation-repository';
import * as schema from '../schema/index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', 'migrations');

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipPg = !DATABASE_URL;

const step: EvaluationOwner = { namespace: 'ws-1', workflowName: 'ae-grading', stepId: 'grade-aes', agentId: null };
const otherStep: EvaluationOwner = { ...step, stepId: 'extract-aes' };
const agent: EvaluationOwner = { namespace: 'ws-1', workflowName: null, stepId: null, agentId: 'ae-grader' };

function subject(owner: EvaluationOwner): EvaluationSubject {
  return evaluationSubjectOf(owner)!;
}

function fingerprint(digit: string): StepFingerprint {
  return {
    hash: digit.repeat(64),
    components: Object.fromEntries(STEP_FINGERPRINT_COMPONENTS.map((component) => [component, digit.repeat(64)])) as StepFingerprint['components'],
  };
}

function buildEvaluator(overrides: Partial<Evaluator> = {}): Evaluator {
  return {
    ...step,
    id: randomUUID(),
    name: 'grade-present',
    archived: false,
    runInProduction: false,
    onError: 'ignore',
    createdBy: 'author-1',
    createdAt: '2026-09-23T08:00:00.000Z',
    ...overrides,
  };
}

function buildVersion(evaluatorId: string, overrides: Partial<EvaluatorVersion> = {}): EvaluatorVersion {
  return {
    evaluatorId,
    version: 1,
    rule: 'Every adverse event carries a CTCAE grade.',
    check: { kind: 'code', runtime: 'python', source: 'import json\nprint(json.dumps({"passed": True}))' },
    origin: 'user',
    sourceApproval: null,
    createdBy: 'author-1',
    createdAt: '2026-09-23T08:00:00.000Z',
    ...overrides,
  };
}

function buildCase(overrides: Partial<EvalCase> = {}): EvalCase {
  return {
    ...step,
    id: randomUUID(),
    name: 'Grade 5 event (death) must be flagged',
    input: {
      triggerPayload: { studyId: 'CDISCPILOT01' },
      previousStepOutputs: { 'extract-aes': { events: [{ term: 'Sepsis', outcome: 'fatal' }] } },
    },
    workspaceSeedCommit: 'a1b2c3d4e5f6',
    expectation: 'negative',
    expectedOutput: { events: [{ term: 'Sepsis', grade: 4 }] },
    comparison: 'agreement',
    agreementInstructions: 'The grade decides; wording does not.',
    evaluatorIds: [randomUUID()],
    source: 'production',
    sourceAgentRunId: randomUUID(),
    perturbation: null,
    origin: 'user',
    split: 'dev',
    containsProductionData: true,
    archived: false,
    createdBy: 'author-1',
    createdAt: '2026-09-23T08:00:00.000Z',
    ...overrides,
  };
}

function contract(name: string, factory: () => Promise<EvaluationRepository>) {
  describe(`${name} — EvaluationRepository contract`, () => {
    let repo: EvaluationRepository;

    beforeEach(async () => {
      repo = await factory();
    });

    it('keeps every Brief version, newest first, per step', async () => {
      const base = { ...step, origin: 'user' as const, createdBy: 'author-1' };
      await repo.appendBrief({ ...base, version: 1, text: 'Grades AEs for the DSMB.', createdAt: '2026-09-23T08:00:00.000Z' });
      await repo.appendBrief({ ...base, version: 2, text: 'Grades AEs; a missed grade 5 is critical.', createdAt: '2026-09-23T09:00:00.000Z' });
      await repo.appendBrief({ ...base, ...otherStep, version: 1, text: 'Extracts AEs.', createdAt: '2026-09-23T09:00:00.000Z' });

      expect((await repo.listBriefs(subject(step))).map((brief) => brief.version)).toEqual([2, 1]);
      await expect(repo.appendBrief({ ...base, version: 2, text: 'x', createdAt: '2026-09-23T10:00:00.000Z' })).rejects.toThrow();
    });

    it('round-trips an Evaluator with its versions and approval', async () => {
      const evaluator = buildEvaluator();
      const first = buildVersion(evaluator.id);
      await repo.createEvaluator(evaluator, first);
      const second = await repo.appendEvaluatorVersion(buildVersion(evaluator.id, {
        version: 2,
        check: {
          kind: 'llm_judge',
          model: 'anthropic/claude-sonnet-4',
          rubric: 'Is the grade justified by the source record?',
          minConfidence: 0.7,
        },
        origin: 'assistant',
        createdAt: '2026-09-23T09:00:00.000Z',
      }));
      const approval = { approvedBy: 'reviewer-1', approvedAt: '2026-09-23T10:00:00.000Z' };
      await repo.setSourceApproval(evaluator.id, 1, approval);

      expect(await repo.getEvaluator(evaluator.id)).toEqual(evaluator);
      expect(await repo.listEvaluatorVersions(evaluator.id)).toEqual([
        { ...first, sourceApproval: approval },
        second,
      ]);
      await expect(repo.appendEvaluatorVersion(buildVersion(evaluator.id, { version: 2 }))).rejects.toThrow();
    });

    it('reads a judge version stored with choices, before minConfidence, at the default floor', async () => {
      const evaluator = buildEvaluator();
      const legacyCheck = {
        kind: 'llm_judge',
        model: 'anthropic/claude-sonnet-4',
        rubric: 'Is the grade justified by the source record?',
        choices: [{ label: 'justified', value: 1 }, { label: 'unjustified', value: 0 }],
      } as unknown as EvaluatorVersion['check'];
      await repo.createEvaluator(evaluator, buildVersion(evaluator.id, { check: legacyCheck }));

      const [version] = await repo.listEvaluatorVersions(evaluator.id);
      expect(version!.check).toEqual({
        kind: 'llm_judge', model: 'anthropic/claude-sonnet-4', rubric: 'Is the grade justified by the source record?', minConfidence: 0.8,
      });
    });

    it('lists a step\'s Evaluators by name, refuses a duplicate name, archives', async () => {
      const zeta = buildEvaluator({ name: 'zeta' });
      const alpha = buildEvaluator({ name: 'alpha' });
      await repo.createEvaluator(zeta, buildVersion(zeta.id));
      await repo.createEvaluator(alpha, buildVersion(alpha.id));
      const elsewhere = buildEvaluator({ ...otherStep, name: 'alpha' });
      await repo.createEvaluator(elsewhere, buildVersion(elsewhere.id));

      await expect(repo.createEvaluator(buildEvaluator({ name: 'alpha' }), buildVersion(randomUUID()))).rejects.toThrow();
      await repo.setEvaluatorArchived(zeta.id, true);

      expect((await repo.listEvaluators(subject(step))).map((row) => [row.name, row.archived]))
        .toEqual([['alpha', false], ['zeta', true]]);
      expect(await repo.getEvaluator(randomUUID())).toBeNull();
    });

    it('stores an Evaluator\'s production settings and changes them', async () => {
      const flagged = buildEvaluator({ name: 'flagged', runInProduction: true });
      const plain = buildEvaluator({ name: 'plain' });
      await repo.createEvaluator(flagged, buildVersion(flagged.id));
      await repo.createEvaluator(plain, buildVersion(plain.id));

      await repo.setEvaluatorProduction(flagged.id, { runInProduction: false, onError: 'ignore' });
      await repo.setEvaluatorProduction(plain.id, { runInProduction: true, onError: 'escalate' });

      expect((await repo.listEvaluators(subject(step))).map((row) => [row.name, row.runInProduction, row.onError]))
        .toEqual([['flagged', false, 'ignore'], ['plain', true, 'escalate']]);
    });

    it('round-trips Eval Cases, newest first, and archives them', async () => {
      const older = buildCase({ createdAt: '2026-09-23T08:00:00.000Z' });
      const newer = buildCase({
        createdAt: '2026-09-23T09:00:00.000Z',
        source: 'manual',
        sourceAgentRunId: null,
        origin: 'assistant',
        workspaceSeedCommit: null,
        expectedOutput: null,
        comparison: 'exact',
        agreementInstructions: null,
        evaluatorIds: null,
        expectation: 'positive',
        split: 'holdout',
        containsProductionData: false,
        input: { triggerPayload: {}, previousStepOutputs: {}, previousRun: { lastGrade: 3 } },
      });
      const synthesized = buildCase({
        createdAt: '2026-09-23T10:00:00.000Z',
        source: 'synthesized',
        perturbation: { kind: 'renamed_columns', description: 'AETERM renamed to AE_TERM in ae.csv' },
      });
      await repo.createCase(older);
      await repo.createCase(newer);
      await repo.createCase(synthesized);
      await repo.setCaseArchived(older.id, true);

      expect(await repo.listCases(subject(step))).toEqual([synthesized, newer, { ...older, archived: true }]);
      expect(await repo.getCase(newer.id)).toEqual(newer);
      expect(await repo.listCases(subject(otherStep))).toEqual([]);
    });

    it('saves Dataset versions, newest first, unique per step', async () => {
      const caseIds = [randomUUID(), randomUUID()];
      const base = { ...step, containsProductionData: true, createdBy: 'author-1', createdAt: '2026-09-23T08:00:00.000Z' };
      const first = await repo.appendDatasetVersion({ ...base, id: randomUUID(), version: 1, caseIds });
      const second = await repo.appendDatasetVersion({ ...base, id: randomUUID(), version: 2, caseIds: [caseIds[0]!] });

      expect(await repo.listDatasetVersions(subject(step))).toEqual([second, first]);
      expect(await repo.getDatasetVersion(first.id)).toEqual(first);
      await expect(repo.appendDatasetVersion({ ...base, id: randomUUID(), version: 2, caseIds })).rejects.toThrow();
    });

    it('stores an Eval Run with its trials and moves both only from the expected status', async () => {
      const dataset = await repo.appendDatasetVersion({
        ...step, id: randomUUID(), version: 1, caseIds: [randomUUID()], containsProductionData: false,
        createdBy: 'author-1', createdAt: '2026-09-23T08:00:00.000Z',
      });
      const caseId = dataset.caseIds[0]!;
      const run = {
        ...step,
        id: randomUUID(),
        definitionVersion: 3,
        agentVersion: null,
        suiteAgentId: null,
        datasetVersionId: dataset.id,
        caseIds: dataset.caseIds,
        trialsPerCase: 2,
        concurrency: 2,
        evaluators: [{ evaluatorId: randomUUID(), name: 'findings-present', version: 1, kind: 'schema' as const, counted: true }],
        fingerprint: fingerprint('a'),
        acceptanceCriteria: { minPassRate: 0.9, minPassHatK: 0.8 },
        mcpPolicy: { edc: { mode: 'deny' as const } },
        env: { OPENROUTER_API_KEY: '{{OPENROUTER_API_KEY}}' },
        estimate: { perTrialUsd: 0.25, totalUsd: 0.5, basis: 'history' as const, sampleSize: 4 },
        budgetUsd: 1,
        spentUsd: 0,
        status: 'prepared' as const,
        createdBy: 'author-1',
        createdAt: '2026-09-23T08:00:00.000Z',
        startedAt: null,
        completedAt: null,
        acceptance: null,
      };
      const trials = [0, 1].map((trialIndex) => ({
        id: randomUUID(), evalRunId: run.id, caseId, trialIndex, status: 'pending' as const,
        processInstanceId: null, agentRunId: null, costUsd: null, inputTokens: null, outputTokens: null,
        durationMs: null, confidence: null, error: null, startedAt: null, scoringStartedAt: null, scoringAttempts: 0, completedAt: null, mcpReplayMisses: [], erroredJudgeCalls: {},
      }));
      await repo.createEvalRun(run, trials);

      expect(await repo.getEvalRun(run.id)).toEqual(run);
      expect(await repo.listEvalRuns(subject(step))).toEqual([run]);
      expect(await repo.transitionEvalRun(run.id, 'running', { status: 'completed' })).toBe(false);
      expect(await repo.transitionEvalRun(run.id, 'prepared', { status: 'running', startedAt: '2026-09-23T09:00:00.000Z' })).toBe(true);
      expect(await repo.listEvalRunIdsToDrive()).toEqual([run.id]);
      await repo.addEvalRunSpend(run.id, 0.25);
      await repo.addEvalRunSpend(run.id, 0.125);
      expect((await repo.getEvalRun(run.id))?.spentUsd).toBeCloseTo(0.375, 10);

      const [first] = trials;
      const claimed = await repo.transitionTrial(first!.id, 'pending', {
        status: 'running', processInstanceId: 'trial-instance-1', startedAt: '2026-09-23T09:00:00.000Z',
      });
      expect(claimed).toBe(true);
      expect(await repo.transitionTrial(first!.id, 'pending', { status: 'running' })).toBe(false);
      expect(await repo.getTrialByInstanceId('trial-instance-1')).toMatchObject({ id: first!.id, status: 'running' });
      expect((await repo.listTrials(run.id)).map((trial) => [trial.trialIndex, trial.status])).toEqual([[0, 'running'], [1, 'pending']]);

      // A cancelled run is still driven while a trial of it is in flight.
      await repo.transitionEvalRun(run.id, 'running', { status: 'cancelled' });
      expect(await repo.listEvalRunIdsToDrive()).toEqual([run.id]);

      await repo.transitionTrial(first!.id, 'running', { status: 'scoring', scoringStartedAt: '2026-09-23T09:10:00.000Z', scoringAttempts: 1 });
      expect(await repo.renewScoringClaim(first!.id, '2026-09-23T09:05:00.000Z', '2026-09-23T09:30:00.000Z')).toBe(false);
      expect(await repo.renewScoringClaim(first!.id, '2026-09-23T09:20:00.000Z', '2026-09-23T09:30:00.000Z')).toBe(true);
      expect(await repo.renewScoringClaim(first!.id, '2026-09-23T09:20:00.000Z', '2026-09-23T09:31:00.000Z')).toBe(false);
      expect((await repo.listTrials(run.id))[0]).toMatchObject({ scoringStartedAt: '2026-09-23T09:30:00.000Z', scoringAttempts: 2 });

      await repo.transitionTrial(first!.id, 'scoring', { status: 'scored' });
      expect(await repo.listEvalRunIdsToDrive()).toEqual([]);

      await repo.setEvalRunAcceptance(run.id, { status: 'missed', reason: 'findings-present: pass rate 50% < 90%' });
      expect((await repo.getEvalRun(run.id))?.acceptance).toEqual({ status: 'missed', reason: 'findings-present: pass rate 50% < 90%' });
    });

    it('orders trials by case, then trial index, and keeps a trial\'s confidence', async () => {
      const dataset = await repo.appendDatasetVersion({
        ...step, id: randomUUID(), version: 1, caseIds: [randomUUID()], containsProductionData: false,
        createdBy: 'author-1', createdAt: '2026-09-23T08:00:00.000Z',
      });
      const run = storedRun(dataset.id, dataset.caseIds);
      const caseIds = [dataset.caseIds[0]!, randomUUID()].sort().reverse();
      const trials = caseIds.flatMap((caseId) => [1, 0].map((trialIndex) => ({
        id: randomUUID(), evalRunId: run.id, caseId, trialIndex, status: 'pending' as const,
        processInstanceId: null, agentRunId: null, costUsd: null, inputTokens: null, outputTokens: null,
        durationMs: null, confidence: null, error: null, startedAt: null, scoringStartedAt: null, scoringAttempts: 0, completedAt: null, mcpReplayMisses: [], erroredJudgeCalls: {},
      })));
      await repo.createEvalRun(run, trials);
      await repo.transitionTrial(trials[0]!.id, 'pending', { status: 'skipped', confidence: 0.75 });

      const listed = await repo.listTrials(run.id);
      expect(listed.map((trial) => [trial.caseId, trial.trialIndex])).toEqual([
        [caseIds[1], 0], [caseIds[1], 1], [caseIds[0], 0], [caseIds[0], 1],
      ]);
      expect(listed.find((trial) => trial.id === trials[0]!.id)?.confidence).toBe(0.75);
    });

    it('versions a step\'s Acceptance Criteria, newest first', async () => {
      const base = { ...step, origin: 'user' as const, createdBy: 'author-1', createdAt: '2026-09-23T08:00:00.000Z' };
      const first = await repo.appendAcceptanceCriteria({ ...base, version: 1, criteria: { minPassRate: 0.9 } });
      const second = await repo.appendAcceptanceCriteria({
        ...base, version: 2, origin: 'assistant', criteria: { minPassRate: 0.95, minPassHatK: 0.9 },
      });

      expect(await repo.listAcceptanceCriteria(subject(step))).toEqual([second, first]);
      expect(await repo.listAcceptanceCriteria(subject(otherStep))).toEqual([]);
      await expect(repo.appendAcceptanceCriteria({ ...base, version: 2, criteria: { minPassRate: 0.8 } })).rejects.toThrow();
    });

    it('keeps signed Step Qualifications, newest first', async () => {
      const dataset = await repo.appendDatasetVersion({
        ...step, id: randomUUID(), version: 1, caseIds: [randomUUID()], containsProductionData: false,
        createdBy: 'author-1', createdAt: '2026-09-23T08:00:00.000Z',
      });
      const run = storedRun(dataset.id, dataset.caseIds);
      const otherRun = storedRun(dataset.id, dataset.caseIds);
      await repo.createEvalRun(run, []);
      await repo.createEvalRun(otherRun, []);
      const qualification = (signedAt: string, evalRunId = run.id): StepQualification => ({
        ...step,
        id: randomUUID(),
        evalRunId,
        definitionVersion: 3,
        agentVersion: null,
        fingerprint: fingerprint('a'),
        evaluators: run.evaluators,
        mcpPolicy: run.mcpPolicy,
        acceptanceCriteria: { minPassRate: 0.9 },
        verdicts: [{ criterion: { minPassRate: 0.9 }, status: 'missed', evaluators: [], reason: 'findings-present: pass rate 80% < 90%' }],
        decision: 'overwritten',
        deviations: [{ justification: 'Every miss was a formatting slip a reviewer catches.' }],
        signature: { signerId: 'author-1', signerName: 'Ada Author', meaning: 'Approval', signedAt, reauthentication: 'password' },
      });
      const older = await repo.createQualification(qualification('2026-09-23T10:00:00.000Z'));
      const newer = await repo.createQualification(qualification('2026-09-23T11:00:00.000Z', otherRun.id));
      await expect(repo.createQualification(qualification('2026-09-23T12:00:00.000Z'))).rejects.toThrow();

      expect(await repo.listQualifications(subject(step))).toEqual([newer, older]);
      expect(await repo.listQualifications(subject(otherStep))).toEqual([]);
    });

    it('replaces a step\'s MCP eval policy', async () => {
      expect(await repo.getMcpPolicy(subject(step))).toBeNull();
      await repo.putMcpPolicy({ ...step, servers: { edc: { mode: 'deny' } }, env: {}, updatedBy: 'author-1', updatedAt: '2026-09-23T08:00:00.000Z' });
      const replaced = { ...step, servers: { edc: { mode: 'live' as const, denyTools: ['write_record'] } }, env: { OPENROUTER_API_KEY: '{{OPENROUTER_API_KEY}}' }, updatedBy: 'author-2', updatedAt: '2026-09-23T09:00:00.000Z' };
      await repo.putMcpPolicy(replaced);

      expect(await repo.getMcpPolicy(subject(step))).toEqual(replaced);
      expect(await repo.getMcpPolicy(subject(otherStep))).toBeNull();
    });

    it('keeps every MCP recording, oldest first, by case and server — the newest few on request — and a trial\'s replay misses', async () => {
      const dataset = await repo.appendDatasetVersion({
        ...step, id: randomUUID(), version: 1, caseIds: [randomUUID()], containsProductionData: false,
        createdBy: 'author-1', createdAt: '2026-09-23T08:00:00.000Z',
      });
      const caseId = dataset.caseIds[0]!;
      const run = storedRun(dataset.id, dataset.caseIds);
      const trialId = randomUUID();
      await repo.createEvalRun(run, [{
        id: trialId, evalRunId: run.id, caseId, trialIndex: 0, status: 'scoring',
        processInstanceId: null, agentRunId: null, costUsd: null, inputTokens: null, outputTokens: null,
        durationMs: null, confidence: null, error: null, startedAt: null, scoringStartedAt: null, scoringAttempts: 0, completedAt: null, mcpReplayMisses: [], erroredJudgeCalls: {},
      }]);
      const recording = (server: string, recordedAt: string, text: string) => ({
        ...step, id: randomUUID(), caseId, server, evalRunId: run.id, trialId, recordedAt,
        tape: { tools: [{ name: 'read_record' }], calls: [{ tool: 'read_record', arguments: { subject: '1001' }, result: { content: [{ type: 'text', text }] } }] },
      });
      const newer = recording('edc', '2026-09-23T09:00:00.000Z', 'new');
      const older = recording('edc', '2026-09-23T08:00:00.000Z', 'old');
      const other = recording('meddra', '2026-09-23T08:30:00.000Z', 'term');
      for (const row of [newer, older, other]) await repo.appendMcpRecording(row);

      expect(await repo.listMcpRecordings(subject(step), { caseId, server: 'edc' })).toEqual([older, newer]);
      expect(await repo.listMcpRecordings(subject(step))).toEqual([older, other, newer]);
      expect(await repo.listMcpRecordings(subject(otherStep))).toEqual([]);
      expect(await repo.listMcpRecordings(subject(step), { caseId, server: 'edc', limit: 1 })).toEqual([newer]);
      const recorded = await repo.listMcpRecordedCases(subject(step));
      expect(recorded.sort((left, right) => left.server.localeCompare(right.server)))
        .toEqual([{ server: 'edc', caseId }, { server: 'meddra', caseId }]);
      expect(await repo.listMcpRecordedCases(subject(otherStep))).toEqual([]);
      expect(await repo.listMcpRecordedCases(subject(step), { evalRunId: run.id })).toHaveLength(2);
      expect(await repo.listMcpRecordedCases(subject(step), { evalRunId: randomUUID() })).toEqual([]);

      const miss = { server: 'edc', tool: 'read_record', arguments: { subject: '9999' } };
      await repo.transitionTrial(trialId, 'scoring', { status: 'scored', mcpReplayMisses: [miss] });
      expect((await repo.listTrials(run.id))[0]?.mcpReplayMisses).toEqual([miss]);
    });

    it('keeps an Agent\'s Evaluation apart from a Step\'s in the same workspace', async () => {
      const stepEvaluator = buildEvaluator({ name: 'grade-present' });
      const agentEvaluator = buildEvaluator({ ...agent, name: 'grade-present' });
      await repo.createEvaluator(stepEvaluator, buildVersion(stepEvaluator.id));
      await repo.createEvaluator(agentEvaluator, buildVersion(agentEvaluator.id));
      const agentCase = buildCase({ ...agent, source: 'manual', sourceAgentRunId: null });
      await repo.createCase(buildCase());
      await repo.createCase(agentCase);
      const base = { origin: 'user' as const, createdBy: 'author-1', createdAt: '2026-09-23T08:00:00.000Z' };
      await repo.appendAcceptanceCriteria({ ...step, ...base, version: 1, criteria: { minPassRate: 1 } });
      await repo.appendAcceptanceCriteria({ ...agent, ...base, version: 1, criteria: { minPassRate: 0.8 } });
      const dataset = await repo.appendDatasetVersion({
        ...agent, id: randomUUID(), version: 1, caseIds: [agentCase.id], containsProductionData: false,
        createdBy: 'author-1', createdAt: '2026-09-23T08:00:00.000Z',
      });
      const run: EvalRun = { ...storedRun(dataset.id, [agentCase.id]), ...agent, definitionVersion: null, agentVersion: 2 };
      await repo.createEvalRun(run, []);

      expect(await repo.listEvaluators(subject(agent))).toEqual([agentEvaluator]);
      expect(await repo.listEvaluators(subject(step))).toEqual([stepEvaluator]);
      expect(await repo.listCases(subject(agent))).toEqual([agentCase]);
      expect((await repo.listAcceptanceCriteria(subject(agent))).map((row) => row.criteria)).toEqual([{ minPassRate: 0.8 }]);
      expect(await repo.listEvalRuns(subject(agent))).toEqual([run]);
      expect(await repo.listEvalRuns(subject(step))).toEqual([]);
      expect(await repo.getEvalRun(run.id)).toEqual(run);
    });
  });
}

function storedRun(datasetVersionId: string, caseIds: string[]): EvalRun {
  return {
    ...step,
    id: randomUUID(),
    definitionVersion: 3,
    agentVersion: null,
    suiteAgentId: null,
    datasetVersionId,
    caseIds,
    trialsPerCase: 2,
    concurrency: 2,
    evaluators: [{ evaluatorId: randomUUID(), name: 'findings-present', version: 1, kind: 'schema', counted: true }],
    fingerprint: fingerprint('a'),
    acceptanceCriteria: null,
    mcpPolicy: {},
    env: {},
    estimate: { perTrialUsd: null, totalUsd: null, basis: 'unknown', sampleSize: 0 },
    budgetUsd: 1,
    spentUsd: 0,
    status: 'prepared',
    createdBy: 'author-1',
    createdAt: '2026-09-23T08:00:00.000Z',
    startedAt: null,
    completedAt: null,
    acceptance: null,
  };
}

contract('InMemoryEvaluationRepository', async () => new InMemoryEvaluationRepository());

describe.skipIf(skipPg)('PostgresEvaluationRepository (parity)', () => {
  const schemaName = `evaluation_${randomBytes(8).toString('hex')}`;
  let adminClient: ReturnType<typeof postgres>;
  let testClient: ReturnType<typeof postgres>;

  beforeAll(async () => {
    adminClient = postgres(DATABASE_URL!, { max: 1, onnotice: () => {} });
    await adminClient.unsafe(`CREATE SCHEMA "${schemaName}"`);
    testClient = postgres(DATABASE_URL!, {
      max: 4,
      onnotice: () => {},
      connection: { search_path: schemaName },
    });
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      await testClient.unsafe(readFileSync(join(MIGRATIONS_DIR, file), 'utf-8'));
    }
    await testClient.unsafe(
      `INSERT INTO "${schemaName}"."workspaces" (handle, type, display_name) VALUES ('ws-1', 'organization', 'ws-1')`,
    );
  });

  afterAll(async () => {
    if (testClient) await testClient.end();
    if (adminClient) {
      await adminClient.unsafe(`DROP SCHEMA "${schemaName}" CASCADE`);
      await adminClient.end();
    }
  });

  contract('PostgresEvaluationRepository', async () => {
    await testClient.unsafe(
      `TRUNCATE TABLE "${schemaName}"."evaluation_briefs", "${schemaName}"."evaluators", "${schemaName}"."evaluator_versions", ` +
        `"${schemaName}"."eval_cases", "${schemaName}"."eval_dataset_versions", "${schemaName}"."mcp_eval_policies", ` +
        `"${schemaName}"."eval_runs", "${schemaName}"."eval_trials", "${schemaName}"."eval_acceptance_criteria", ` +
        `"${schemaName}"."step_qualifications", "${schemaName}"."eval_mcp_recordings"`,
    );
    return new PostgresEvaluationRepository(drizzle(testClient, { schema }));
  });

  it('refuses a row that names an agent and part of a step: exactly one owner', async () => {
    const insert = (workflowName: string, stepId: string, agentId: string) => testClient.unsafe(
      `INSERT INTO "${schemaName}"."mcp_eval_policies" (workspace, workflow_name, step_id, agent_id, servers, updated_by) VALUES ('ws-1', $1, $2, $3, '{}', 'u-1')`,
      [workflowName, stepId, agentId],
    );
    await expect(insert('ae-grading', '', 'ae-grader')).rejects.toThrow(/mcp_eval_policies_owner_check/);
    await expect(insert('', 'grade-aes', 'ae-grader')).rejects.toThrow(/mcp_eval_policies_owner_check/);
    await expect(insert('', '', '')).rejects.toThrow(/mcp_eval_policies_owner_check/);
    await expect(insert('', '', 'ae-grader')).resolves.toBeDefined();
  });
});
