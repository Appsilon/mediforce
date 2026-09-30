import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { EvaluatorCheck, EvaluatorVersion } from '@mediforce/platform-core';
import { scoreProductionRun, hasProductionEvaluators } from '../production-evaluators';
import { loadEvaluationSubject } from '../evaluation-subject';
import { evaluationFixture, GRADED_RUN, STEP, UNGRADED_RUN, type EvaluationFixture } from '../../__tests__/fixture';

const runCodeCheck = vi.hoisted(() => vi.fn());
vi.mock('@mediforce/agent-runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@mediforce/agent-runtime')>()),
  runCodeCheck,
}));

const findings: EvaluatorCheck = { kind: 'schema', schema: { required: ['findings'] } };
const judge: EvaluatorCheck = {
  kind: 'llm_judge',
  model: 'anthropic/claude-haiku-4.5',
  rubric: 'Every AE carries a grade.',
  choices: [{ label: 'graded', value: 1 }, { label: 'ungraded', value: 0 }],
};
const code: EvaluatorCheck = { kind: 'code', runtime: 'python', source: 'print(1)' };

async function addEvaluator(
  fixture: EvaluationFixture,
  name: string,
  check: EvaluatorCheck,
  options: { severity?: 'critical' | 'major'; runInProduction?: boolean; approved?: boolean } = {},
) {
  const id = randomUUID();
  const now = '2026-09-23T08:00:00.000Z';
  const version: EvaluatorVersion = {
    evaluatorId: id, version: 1, rule: `${name} rule`, severity: options.severity ?? 'critical', check, origin: 'user',
    sourceApproval: options.approved === true ? { approvedBy: 'reviewer-1', approvedAt: now } : null,
    calibration: null, createdBy: 'author-1', createdAt: now,
  };
  await fixture.evaluationRepo.createEvaluator(
    { ...STEP, id, name, archived: false, runInProduction: options.runInProduction ?? true, createdBy: 'author-1', createdAt: now },
    version,
  );
  return id;
}

describe('production Evaluators (ADR-0023 D13)', () => {
  let fixture: EvaluationFixture;
  beforeEach(async () => {
    fixture = await evaluationFixture();
    runCodeCheck.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  async function score(agentRunId: string) {
    const scope = fixture.scope();
    return scoreProductionRun(scope, STEP, await loadEvaluationSubject(scope, agentRunId, STEP));
  }

  it('fails the gate on a failing critical schema Evaluator and records a production Score', async () => {
    const id = await addEvaluator(fixture, 'findings-present', findings);

    const { verdict } = await score(UNGRADED_RUN);

    expect(verdict.failure).toContain("Evaluator 'findings-present' v1 failed");
    const [written] = await fixture.scoreRepo.list({ agentRunId: UNGRADED_RUN, limit: 100 });
    expect(written).toMatchObject({
      name: 'findings-present', value: 0, source: 'deterministic', evaluatorId: id,
      metadata: { production: true, evaluatorVersion: 1, counted: true },
    });
    expect(written?.metadata).not.toHaveProperty('evalRunId');
  });

  it('passes a conforming result and still records the Score', async () => {
    await addEvaluator(fixture, 'findings-present', findings);
    const { verdict } = await score(GRADED_RUN);
    expect(verdict).toEqual({ failure: null, errors: [] });
    expect((await fixture.scoreRepo.list({ agentRunId: GRADED_RUN, limit: 100 }))[0]).toMatchObject({ value: 1 });
  });

  it('records a failing major Evaluator as a Score without failing the gate', async () => {
    await addEvaluator(fixture, 'findings-present', findings, { severity: 'major' });
    const { verdict } = await score(UNGRADED_RUN);
    expect(verdict.failure).toBeNull();
    expect(await fixture.scoreRepo.list({ agentRunId: UNGRADED_RUN, limit: 100 })).toHaveLength(1);
  });

  it('reports a check that cannot run as an error, never a failure, and writes no Score', async () => {
    await addEvaluator(fixture, 'grade-5-flagged', code, { approved: true });
    runCodeCheck.mockRejectedValue(new Error('sandbox unavailable'));

    const { verdict } = await score(UNGRADED_RUN);

    expect(verdict).toEqual({ failure: null, errors: ['grade-5-flagged: sandbox unavailable'] });
    expect(await fixture.scoreRepo.list({ agentRunId: UNGRADED_RUN, limit: 100 })).toEqual([]);
  });

  it('skips Evaluators that are not flagged, not counted or archived', async () => {
    await addEvaluator(fixture, 'not-flagged', findings, { runInProduction: false });
    await addEvaluator(fixture, 'unapproved-code', code);
    const archivedId = await addEvaluator(fixture, 'archived-one', findings);
    await fixture.evaluationRepo.setEvaluatorArchived(archivedId, true);

    const { verdict, judges } = await score(UNGRADED_RUN);

    expect(verdict).toEqual({ failure: null, errors: [] });
    expect(judges).toEqual([]);
    expect(runCodeCheck).not.toHaveBeenCalled();
    expect(await fixture.scoreRepo.list({ agentRunId: UNGRADED_RUN, limit: 100 })).toEqual([]);
  });

  it('runs an llm_judge asynchronously and only writes its Score', async () => {
    const id = await addEvaluator(fixture, 'grades-present', judge, { runInProduction: true });
    await fixture.evaluationRepo.setCalibration(id, 1, {
      agreement: 0.9, kappa: 0.8, labelCount: 12, failureLabelCount: 3, calibratedAt: '2026-09-23T09:00:00.000Z',
    } as Parameters<typeof fixture.evaluationRepo.setCalibration>[2]);
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"reasoning": "Ungraded.", "choice": "ungraded"}' }, finish_reason: 'stop' }],
    }))));
    const scope = fixture.scope();
    Object.assign(scope, { workspaceSecrets: { getSecrets: async () => ({ OPENROUTER_API_KEY: 'sk-test' }) } });

    const { verdict, judges } = await scoreProductionRun(scope, STEP, await loadEvaluationSubject(scope, UNGRADED_RUN, STEP));

    expect(verdict.failure).toBeNull();
    expect(judges).toHaveLength(1);
    await Promise.all(judges);
    expect((await fixture.scoreRepo.list({ agentRunId: UNGRADED_RUN, limit: 100 }))[0]).toMatchObject({
      name: 'grades-present', source: 'llm_judge', value: 0, metadata: { production: true },
    });
  });

  it('never fails the step because an llm_judge could not run', async () => {
    const id = await addEvaluator(fixture, 'grades-present', judge);
    await fixture.evaluationRepo.setCalibration(id, 1, {
      agreement: 0.9, kappa: 0.8, labelCount: 12, failureLabelCount: 3, calibratedAt: '2026-09-23T09:00:00.000Z',
    } as Parameters<typeof fixture.evaluationRepo.setCalibration>[2]);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { verdict, judges } = await score(UNGRADED_RUN);
    await Promise.all(judges);

    expect(verdict.failure).toBeNull();
    expect(errorLog).toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it('knows whether a step has any production Evaluator at all', async () => {
    expect(await hasProductionEvaluators(fixture.scope(), STEP)).toBe(false);
    await addEvaluator(fixture, 'findings-present', findings);
    expect(await hasProductionEvaluators(fixture.scope(), STEP)).toBe(true);
  });
});
