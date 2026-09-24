import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { InMemoryEvaluationRepository } from '@mediforce/platform-core';
import type {
  EvalCase,
  EvaluatedStep,
  EvaluationRepository,
  Evaluator,
  EvaluatorVersion,
} from '@mediforce/platform-core';
import { PostgresEvaluationRepository } from '../repositories/evaluation-repository';
import * as schema from '../schema/index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', 'migrations');

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipPg = !DATABASE_URL;

const step: EvaluatedStep = { namespace: 'ws-1', workflowName: 'ae-grading', stepId: 'grade-aes' };
const otherStep: EvaluatedStep = { ...step, stepId: 'extract-aes' };

function buildEvaluator(overrides: Partial<Evaluator> = {}): Evaluator {
  return {
    ...step,
    id: randomUUID(),
    name: 'grade-present',
    archived: false,
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
    severity: 'critical',
    check: { kind: 'code', runtime: 'python', source: 'import json\nprint(json.dumps({"passed": True}))' },
    origin: 'user',
    sourceApproval: null,
    calibration: null,
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
    notes: 'Reviewer: grade 5 was reported as grade 4.',
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

      expect((await repo.listBriefs(step)).map((brief) => brief.version)).toEqual([2, 1]);
      await expect(repo.appendBrief({ ...base, version: 2, text: 'x', createdAt: '2026-09-23T10:00:00.000Z' })).rejects.toThrow();
    });

    it('round-trips an Evaluator with its versions, approval and calibration', async () => {
      const evaluator = buildEvaluator();
      const first = buildVersion(evaluator.id);
      await repo.createEvaluator(evaluator, first);
      const second = await repo.appendEvaluatorVersion(buildVersion(evaluator.id, {
        version: 2,
        severity: 'major',
        check: {
          kind: 'llm_judge',
          model: 'anthropic/claude-sonnet-4',
          rubric: 'Is the grade justified by the source record?',
          choices: [{ label: 'justified', value: 1 }, { label: 'unjustified', value: 0 }],
        },
        origin: 'assistant',
        createdAt: '2026-09-23T09:00:00.000Z',
      }));
      const approval = { approvedBy: 'reviewer-1', approvedAt: '2026-09-23T10:00:00.000Z' };
      const calibration = { agreement: 0.9, kappa: 0.74, labelCount: 10, failureLabelCount: 2, calibratedAt: '2026-09-23T11:00:00.000Z' };
      await repo.setSourceApproval(evaluator.id, 1, approval);
      await repo.setCalibration(evaluator.id, 2, calibration);

      expect(await repo.getEvaluator(evaluator.id)).toEqual(evaluator);
      expect(await repo.listEvaluatorVersions(evaluator.id)).toEqual([
        { ...first, sourceApproval: approval },
        { ...second, calibration },
      ]);
      await expect(repo.appendEvaluatorVersion(buildVersion(evaluator.id, { version: 2 }))).rejects.toThrow();
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

      expect((await repo.listEvaluators(step)).map((row) => [row.name, row.archived]))
        .toEqual([['alpha', false], ['zeta', true]]);
      expect(await repo.getEvaluator(randomUUID())).toBeNull();
    });

    it('round-trips Eval Cases, newest first, and archives them', async () => {
      const older = buildCase({ createdAt: '2026-09-23T08:00:00.000Z' });
      const newer = buildCase({
        createdAt: '2026-09-23T09:00:00.000Z',
        source: 'manual',
        sourceAgentRunId: null,
        origin: 'assistant',
        workspaceSeedCommit: null,
        notes: null,
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

      expect(await repo.listCases(step)).toEqual([synthesized, newer, { ...older, archived: true }]);
      expect(await repo.getCase(newer.id)).toEqual(newer);
      expect(await repo.listCases(otherStep)).toEqual([]);
    });

    it('freezes Dataset versions, newest first, unique per step', async () => {
      const caseIds = [randomUUID(), randomUUID()];
      const base = { ...step, containsProductionData: true, createdBy: 'author-1', createdAt: '2026-09-23T08:00:00.000Z' };
      const first = await repo.appendDatasetVersion({ ...base, id: randomUUID(), version: 1, caseIds });
      const second = await repo.appendDatasetVersion({ ...base, id: randomUUID(), version: 2, caseIds: [caseIds[0]!] });

      expect(await repo.listDatasetVersions(step)).toEqual([second, first]);
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
        datasetVersionId: dataset.id,
        caseIds: dataset.caseIds,
        trialsPerCase: 2,
        concurrency: 2,
        evaluators: [{ evaluatorId: randomUUID(), name: 'findings-present', version: 1, kind: 'schema' as const, severity: 'critical' as const, counted: true }],
        mcpPolicy: { edc: { mode: 'deny' as const } },
        estimate: { perTrialUsd: 0.25, totalUsd: 0.5, basis: 'history' as const, sampleSize: 4 },
        budgetUsd: 1,
        spentUsd: 0,
        status: 'prepared' as const,
        createdBy: 'author-1',
        createdAt: '2026-09-23T08:00:00.000Z',
        startedAt: null,
        completedAt: null,
      };
      const trials = [0, 1].map((trialIndex) => ({
        id: randomUUID(), evalRunId: run.id, caseId, trialIndex, status: 'pending' as const,
        processInstanceId: null, agentRunId: null, costUsd: null, inputTokens: null, outputTokens: null,
        durationMs: null, error: null, startedAt: null, scoringStartedAt: null, scoringAttempts: 0, completedAt: null,
      }));
      await repo.createEvalRun(run, trials);

      expect(await repo.getEvalRun(run.id)).toEqual(run);
      expect(await repo.listEvalRuns(step)).toEqual([run]);
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
    });

    it('replaces a step\'s MCP eval policy', async () => {
      expect(await repo.getMcpPolicy(step)).toBeNull();
      await repo.putMcpPolicy({ ...step, servers: { edc: { mode: 'deny' } }, updatedBy: 'author-1', updatedAt: '2026-09-23T08:00:00.000Z' });
      const replaced = { ...step, servers: { edc: { mode: 'live' as const, denyTools: ['write_record'] } }, updatedBy: 'author-2', updatedAt: '2026-09-23T09:00:00.000Z' };
      await repo.putMcpPolicy(replaced);

      expect(await repo.getMcpPolicy(step)).toEqual(replaced);
      expect(await repo.getMcpPolicy(otherStep)).toBeNull();
    });
  });
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
        `"${schemaName}"."eval_runs", "${schemaName}"."eval_trials"`,
    );
    return new PostgresEvaluationRepository(drizzle(testClient, { schema }));
  });
});
